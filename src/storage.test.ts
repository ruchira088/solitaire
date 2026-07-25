// The localStorage layer. Two things make this fiddly to test, and both are
// deliberate behaviours worth pinning down:
//
//  1. `writable` is module-level state, latched off after the first failed write.
//     A test that exercises the unavailable-storage path would poison every later
//     test in the file, so each case loads a fresh copy of the module.
//  2. There is no `localStorage` under the node environment, which is exactly the
//     "storage unavailable" case — so the happy path has to install a stub first.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Game, GameState } from "./game";

type Store = typeof import("./storage");

/** Load a pristine copy of storage.ts, so the `writable` latch starts clean. */
async function freshStorage(): Promise<Store> {
  vi.resetModules();
  return import("./storage");
}

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

function install(storage: unknown): void {
  vi.stubGlobal("localStorage", storage);
}

const sample = (): GameState => new Game(3).serialize();

/** The schema version storage.ts currently writes, read back from a real save so a
 *  future bump can't quietly turn these into version-rejection tests. */
function currentVersion(store: Store, mem: MemoryStorage): number {
  store.saveGame(sample(), 0);
  const v = JSON.parse(mem.getItem("solitaire-game")!).v as number;
  store.clearGame();
  return v;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("with working storage", () => {
  let mem: MemoryStorage;
  let store: Store;

  beforeEach(async () => {
    mem = new MemoryStorage();
    install(mem);
    store = await freshStorage();
  });

  it("saves and reloads an in-progress game", async () => {
    const state = sample();
    store.saveGame(state, 83_210);
    const back = store.loadGame()!;
    expect(back).not.toBeNull();
    expect(back.state).toEqual(state);
    expect(back.elapsed).toBe(83_210);
  });

  it("rounds the elapsed time to whole milliseconds", async () => {
    store.saveGame(sample(), 1234.987);
    expect(store.loadGame()!.elapsed).toBe(1235);
  });

  it("returns null when nothing is saved", () => {
    expect(store.loadGame()).toBeNull();
  });

  it("clearGame removes the save", () => {
    store.saveGame(sample(), 0);
    expect(store.loadGame()).not.toBeNull();
    store.clearGame();
    expect(store.loadGame()).toBeNull();
  });

  it("round-trips arbitrary settings", () => {
    expect(store.readItem("solitaire-theme")).toBeNull();
    store.writeItem("solitaire-theme", "light");
    expect(store.readItem("solitaire-theme")).toBe("light");
  });

  it("drops and deletes an unparseable save", () => {
    mem.setItem("solitaire-game", "{not json");
    expect(store.loadGame()).toBeNull();
    expect(mem.getItem("solitaire-game")).toBeNull();
  });

  it("drops and deletes a save from a different schema version", () => {
    const stale = currentVersion(store, mem) - 1;
    mem.setItem(
      "solitaire-game",
      JSON.stringify({ v: stale, elapsed: 0, state: sample() }),
    );
    expect(store.loadGame()).toBeNull();
    expect(mem.getItem("solitaire-game")).toBeNull();
  });

  it("drops a structurally valid envelope holding an invalid state", () => {
    mem.setItem(
      "solitaire-game",
      JSON.stringify({ v: currentVersion(store, mem), elapsed: 0, state: { drawCount: 3 } }),
    );
    expect(store.loadGame()).toBeNull();
    expect(mem.getItem("solitaire-game")).toBeNull();
  });

  it.each([
    ["a bare string", '"hello"'],
    ["null", "null"],
    ["an array", "[1,2,3]"],
    ["a number", "42"],
  ])("drops and deletes %s", (_label, raw) => {
    mem.setItem("solitaire-game", raw);
    expect(store.loadGame()).toBeNull();
    expect(mem.getItem("solitaire-game")).toBeNull();
  });

  it.each([-5, NaN, Infinity, "83", null, undefined])(
    "coerces an elapsed of %p to 0",
    (elapsed) => {
      const v = currentVersion(store, mem);
      mem.setItem("solitaire-game", JSON.stringify({ v, elapsed, state: sample() }));
      expect(store.loadGame()!.elapsed).toBe(0);
    },
  );
});

describe("with localStorage that always throws", () => {
  let store: Store;
  let calls: number;

  beforeEach(async () => {
    calls = 0;
    const thrower = (): never => {
      calls++;
      throw new Error("storage disabled");
    };
    install({ getItem: thrower, setItem: thrower, removeItem: thrower, clear: thrower });
    store = await freshStorage();
  });

  it("reads as null rather than throwing", () => {
    expect(store.readItem("solitaire-theme")).toBeNull();
    expect(store.loadGame()).toBeNull();
  });

  it("swallows writes", () => {
    expect(() => store.writeItem("solitaire-theme", "light")).not.toThrow();
    expect(() => store.saveGame(sample(), 0)).not.toThrow();
  });

  it("swallows clearGame", () => {
    expect(() => store.clearGame()).not.toThrow();
  });

  it("latches off after the first failed write and stops retrying", () => {
    store.writeItem("a", "1");
    const afterFirst = calls;
    for (let i = 0; i < 20; i++) store.writeItem("b", String(i));
    expect(calls).toBe(afterFirst); // no further attempts
  });

  it("still lets clearGame through, since it bypasses the latch", () => {
    store.writeItem("a", "1"); // trip the latch
    const before = calls;
    store.clearGame();
    expect(calls).toBeGreaterThan(before);
  });
});

describe("with no localStorage at all", () => {
  it("behaves as if storage were unavailable", async () => {
    install(undefined);
    const store = await freshStorage();
    expect(store.readItem("solitaire-theme")).toBeNull();
    expect(store.loadGame()).toBeNull();
    expect(() => store.saveGame(sample(), 0)).not.toThrow();
    expect(() => store.clearGame()).not.toThrow();
  });
});
