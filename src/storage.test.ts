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

  it("starts with an empty record", () => {
    expect(store.loadStats()).toEqual({
      played: 0,
      won: 0,
      streak: 0,
      bestStreak: 0,
      bestScore: 0,
      fastestMs: 0,
      fewestMoves: 0,
      totalMs: 0,
      pending: false,
      dailyWins: 0,
      dailyStreak: 0,
      bestDailyStreak: 0,
      lastDailyWin: "",
      dailyWonDays: [],
    });
  });

  /** One whole game, from first move to win. */
  const playAndWin = (s: Store, score: number, elapsedMs = 60_000, moves = 100): void => {
    s.recordGameStart();
    s.recordWin({ score, elapsedMs, moves });
  };

  it("counts a game from its first move, not from the deal", () => {
    expect(store.loadStats().played).toBe(0);
    store.recordGameStart();
    expect(store.loadStats()).toMatchObject({ played: 1, won: 0, pending: true });
  });

  it("records a win against the game it belongs to", () => {
    store.recordGameStart();
    const { stats, isRecord } = store.recordWin({ score: 940, elapsedMs: 402_000, moves: 118 });
    expect(isRecord).toBe(true);
    expect(stats).toMatchObject({
      played: 1,
      won: 1,
      streak: 1,
      bestStreak: 1,
      bestScore: 940,
      fastestMs: 402_000,
      fewestMoves: 118,
      totalMs: 402_000,
      pending: false,
    });
  });

  it("keeps the best score, fastest time and fewest moves independently", () => {
    playAndWin(store, 940, 402_000, 118);
    playAndWin(store, 500, 120_000, 200); // quicker, worse score, more moves
    expect(store.loadStats()).toMatchObject({
      bestScore: 940,
      fastestMs: 120_000,
      fewestMoves: 118,
      totalMs: 522_000,
      won: 2,
    });
  });

  it("only calls a strictly higher score a record", () => {
    playAndWin(store, 940);
    store.recordGameStart();
    expect(store.recordWin({ score: 940, elapsedMs: 1, moves: 1 }).isRecord).toBe(false);
    store.recordGameStart();
    expect(store.recordWin({ score: 941, elapsedMs: 1, moves: 1 }).isRecord).toBe(true);
  });

  it("builds a streak over consecutive wins and remembers the best run", () => {
    playAndWin(store, 100);
    playAndWin(store, 100);
    expect(store.loadStats()).toMatchObject({ streak: 2, bestStreak: 2 });
    store.recordGameStart();
    store.recordAbandon(30_000); // gave up on the third
    expect(store.loadStats()).toMatchObject({ streak: 0, bestStreak: 2, played: 3, won: 2 });
    playAndWin(store, 100);
    expect(store.loadStats()).toMatchObject({ streak: 1, bestStreak: 2 });
  });

  it("banks the time of a game given up on, and counts it as played", () => {
    store.recordGameStart();
    store.recordAbandon(45_000);
    expect(store.loadStats()).toMatchObject({ played: 1, won: 0, totalMs: 45_000, pending: false });
  });

  it("ignores an abandon with no game under way", () => {
    expect(store.recordAbandon(45_000)).toMatchObject({ played: 0, totalMs: 0 });
  });

  it("breaks the streak when a game was left unfinished in an earlier session", () => {
    playAndWin(store, 100);
    store.recordGameStart(); // left pending, e.g. the tab was closed
    store.recordGameStart(); // ...and a fresh game started later
    expect(store.loadStats()).toMatchObject({ streak: 0, played: 3 });
  });

  it("counts a win with no recorded start, so the win rate can't exceed 100%", () => {
    const { stats } = store.recordWin({ score: 10, elapsedMs: 1000, moves: 5 });
    expect(stats).toMatchObject({ played: 1, won: 1 });
  });

  it("inherits a best score saved before stats existed", () => {
    mem.setItem("solitaire-best", "1200");
    expect(store.loadStats().bestScore).toBe(1200);
    // ...and beating it is measured against the inherited value.
    store.recordGameStart();
    expect(store.recordWin({ score: 900, elapsedMs: 1, moves: 1 }).isRecord).toBe(false);
  });

  it("resets everything, including the pre-stats best score", () => {
    mem.setItem("solitaire-best", "1200");
    playAndWin(store, 1500);
    store.resetStats();
    expect(store.loadStats()).toMatchObject({ played: 0, won: 0, bestScore: 0, totalMs: 0 });
  });

  it.each([
    ["not JSON", "{nope"],
    ["an array", "[1,2,3]"],
    ["a bare number", "42"],
    ["null", "null"],
    ["a future schema", JSON.stringify({ v: 99, played: 5, won: 5 })],
  ])("reads %s as an empty record", (_label, raw) => {
    mem.setItem("solitaire-stats", raw);
    expect(store.loadStats()).toMatchObject({ played: 0, won: 0, bestScore: 0 });
  });

  it("sanitises individual fields without dropping the rest", () => {
    mem.setItem(
      "solitaire-stats",
      JSON.stringify({ v: 1, played: 10, won: 99, streak: -2, bestScore: 12.5, totalMs: 5000 }),
    );
    expect(store.loadStats()).toMatchObject({
      played: 10,
      won: 10, // clamped: a hand-edited record can't win more games than it played
      streak: 0,
      bestScore: 0,
      totalMs: 5000,
    });
  });

  // ---- The daily deal ------------------------------------------------------

  /** Win the daily for `day`, as one whole game. */
  const winDaily = (day: string, score = 100): void => {
    store.recordGameStart();
    store.recordWin({ score, elapsedMs: 60_000, moves: 100, daily: { key: day, extendsStreak: true } });
  };

  it("leaves the daily fields alone for an ordinary win", () => {
    playAndWin(store, 500);
    expect(store.loadStats()).toMatchObject({
      won: 1,
      dailyWins: 0,
      dailyStreak: 0,
      lastDailyWin: "",
    });
  });

  it("records a daily win and starts the streak at 1", () => {
    winDaily("2026-08-10");
    expect(store.loadStats()).toMatchObject({
      won: 1,
      dailyWins: 1,
      dailyStreak: 1,
      bestDailyStreak: 1,
      lastDailyWin: "2026-08-10",
    });
  });

  it("extends the streak across consecutive days", () => {
    winDaily("2026-08-10");
    winDaily("2026-08-11");
    winDaily("2026-08-12");
    expect(store.loadStats()).toMatchObject({
      dailyWins: 3,
      dailyStreak: 3,
      bestDailyStreak: 3,
      lastDailyWin: "2026-08-12",
    });
  });

  it("carries the streak over a month and a year boundary", () => {
    winDaily("2026-08-31");
    winDaily("2026-09-01");
    expect(store.loadStats().dailyStreak).toBe(2);
    winDaily("2026-12-31");
    winDaily("2027-01-01");
    expect(store.loadStats()).toMatchObject({ dailyStreak: 2, bestDailyStreak: 2 });
  });

  it("starts a new run after a missed day, keeping the best", () => {
    winDaily("2026-08-10");
    winDaily("2026-08-11");
    winDaily("2026-08-14"); // two days skipped
    expect(store.loadStats()).toMatchObject({
      dailyWins: 3,
      dailyStreak: 1,
      bestDailyStreak: 2,
    });
  });

  it("counts a day once, however many times it's replayed and re-won", () => {
    winDaily("2026-08-10");
    winDaily("2026-08-10");
    winDaily("2026-08-10");
    expect(store.loadStats()).toMatchObject({
      won: 3, // three real wins...
      dailyWins: 1, // ...of one day's deal
      dailyStreak: 1,
    });
  });

  it("ignores a malformed daily key rather than recording a phantom day", () => {
    store.recordGameStart();
    store.recordWin({ score: 100, elapsedMs: 1, moves: 1, daily: { key: "10 August", extendsStreak: true } });
    expect(store.loadStats()).toMatchObject({ won: 1, dailyWins: 0, lastDailyWin: "" });
  });

  it("clamps dailyWins to the number of games won", () => {
    mem.setItem("solitaire-stats", JSON.stringify({ v: 1, played: 3, won: 2, dailyWins: 99 }));
    expect(store.loadStats().dailyWins).toBe(2);
  });

  it.each([["2026-8-1"], [""], ["nope"], [42], [null]])(
    "reads a stored lastDailyWin of %p as never",
    (v) => {
      mem.setItem("solitaire-stats", JSON.stringify({ v: 1, lastDailyWin: v, dailyStreak: 5 }));
      expect(store.loadStats().lastDailyWin).toBe("");
    },
  );

  // ---- the archive --------------------------------------------------------

  /** Win an archived day: it should tick that day off without touching the run. */
  const winArchived = (day: string): void => {
    store.recordGameStart();
    store.recordWin({ score: 100, elapsedMs: 60_000, moves: 100, daily: { key: day, extendsStreak: false } });
  };

  it("remembers which days were won", () => {
    winDaily("2026-08-10");
    winArchived("2026-08-02");
    expect(store.loadStats().dailyWonDays).toEqual(["2026-08-10", "2026-08-02"]);
    expect(store.hasWonDaily(store.loadStats(), "2026-08-02")).toBe(true);
    expect(store.hasWonDaily(store.loadStats(), "2026-08-03")).toBe(false);
  });

  it("counts an archived win in the total, but not in the streak", () => {
    winDaily("2026-08-10"); // streak 1
    winArchived("2026-07-01");
    winArchived("2026-07-02"); // consecutive, but back-filled
    const s = store.loadStats();
    expect(s.dailyWins).toBe(3);
    expect(s.dailyStreak).toBe(1); // untouched by the back-fill
    expect(s.lastDailyWin).toBe("2026-08-10"); // still the real last daily
    expect(s.dailyWonDays).toContain("2026-07-02");
  });

  it("cannot resurrect a lapsed streak by back-filling the gap", () => {
    winDaily("2026-08-01");
    winDaily("2026-08-05"); // gap; a new run starts at 1
    expect(store.loadStats().dailyStreak).toBe(1);
    for (const d of ["2026-08-02", "2026-08-03", "2026-08-04"]) winArchived(d);
    expect(store.loadStats().dailyStreak).toBe(1); // filling the hole changes nothing
  });

  it("ticks a day once however many times it is replayed", () => {
    winArchived("2026-08-02");
    winArchived("2026-08-02");
    const s = store.loadStats();
    expect(s.dailyWins).toBe(1);
    expect(s.dailyWonDays).toEqual(["2026-08-02"]);
  });

  it("keeps the won-days list newest first and free of junk", () => {
    mem.setItem("solitaire-stats", JSON.stringify({
      v: 1, played: 5, won: 5,
      dailyWonDays: ["2026-08-02", "nope", "2026-08-10", 42, "2026-08-02", null],
    }));
    expect(store.loadStats().dailyWonDays).toEqual(["2026-08-10", "2026-08-02"]);
  });

  it("caps the won-days list so it can't grow without bound", () => {
    const many = Array.from({ length: 500 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 1));
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    mem.setItem("solitaire-stats", JSON.stringify({ v: 1, played: 500, won: 500, dailyWonDays: many }));
    const kept = store.loadStats().dailyWonDays;
    expect(kept).toHaveLength(400);
    expect(kept[0]).toBe(many[many.length - 1]); // newest survives
  });

  it("resets the daily record along with everything else", () => {
    winDaily("2026-08-10");
    store.resetStats();
    expect(store.loadStats()).toMatchObject({
      dailyWins: 0,
      dailyStreak: 0,
      bestDailyStreak: 0,
      lastDailyWin: "",
      dailyWonDays: [],
    });
  });

  describe("currentDailyStreak", () => {
    /** The stored run, as left by winning `day`. */
    const after = (day: string, run: number): ReturnType<Store["loadStats"]> => {
      for (let i = run; i > 0; i--) {
        const d = new Date(`${day}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - (i - 1));
        winDaily(d.toISOString().slice(0, 10));
      }
      return store.loadStats();
    };

    it("is 0 before any daily has been won", () => {
      expect(store.currentDailyStreak(store.loadStats(), "2026-08-10")).toBe(0);
    });

    it("stands while today's is already won", () => {
      const s = after("2026-08-10", 3);
      expect(s.dailyStreak).toBe(3);
      expect(store.currentDailyStreak(s, "2026-08-10")).toBe(3);
    });

    it("stands the day after, with today's deal still there to extend it", () => {
      const s = after("2026-08-10", 3);
      expect(store.currentDailyStreak(s, "2026-08-11")).toBe(3);
    });

    it("has lapsed by the day after that", () => {
      const s = after("2026-08-10", 3);
      expect(store.currentDailyStreak(s, "2026-08-12")).toBe(0);
      expect(store.currentDailyStreak(s, "2027-01-01")).toBe(0);
      // ...though the record of it survives, and a new run starts at 1.
      expect(s.bestDailyStreak).toBe(3);
    });

    it("reads a clock that has gone backwards as lapsed rather than negative", () => {
      const s = after("2026-08-10", 2);
      expect(store.currentDailyStreak(s, "2026-08-01")).toBe(0);
    });

    it("is unaffected by daylight saving, where a local day isn't 24 hours", () => {
      // 2026-03-29 is the European spring-forward (a 23-hour local day) and
      // 2026-10-25 the autumn one (25 hours). Both must still read as one day apart.
      winDaily("2026-03-28");
      winDaily("2026-03-29");
      expect(store.loadStats().dailyStreak).toBe(2);
      winDaily("2026-10-25");
      winDaily("2026-10-26");
      expect(store.loadStats().dailyStreak).toBe(2);
    });
  });
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

  it("still reports the win as a record when the stats can't be stored", () => {
    // The player did just win; a dead storage layer shouldn't tell them otherwise.
    const { stats, isRecord } = store.recordWin({ score: 940, elapsedMs: 1000, moves: 20 });
    expect(isRecord).toBe(true);
    expect(stats).toMatchObject({ won: 1, bestScore: 940 });
  });

  it("swallows resetStats", () => {
    expect(() => store.resetStats()).not.toThrow();
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
