// The seeded PRNG and deal codes. These are a wire format — codes get shared and
// bookmarked — so the tests pin exact output, not just "it looks random".

import { describe, expect, it } from "vitest";
import { encodeSeed, mulberry32, parseSeed, randomSeed } from "./rng";
import { buildDeck, shuffle } from "./cards";
import { Game } from "./game";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const take = (seed: number): number[] => {
      const r = mulberry32(seed);
      return Array.from({ length: 10 }, () => r());
    };
    expect(take(12345)).toEqual(take(12345));
  });

  it("gives different streams for different seeds", () => {
    const first = (seed: number): number => mulberry32(seed)();
    expect(first(1)).not.toBe(first(2));
  });

  it("stays within [0, 1)", () => {
    const r = mulberry32(42);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("handles seed 0 without degenerating", () => {
    const r = mulberry32(0);
    const vals = Array.from({ length: 5 }, () => r());
    expect(new Set(vals).size).toBe(5);
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("spreads roughly evenly across quarters", () => {
    const r = mulberry32(7);
    const buckets = [0, 0, 0, 0];
    for (let i = 0; i < 40000; i++) buckets[Math.floor(r() * 4)]++;
    for (const b of buckets) expect(b).toBeGreaterThan(9000);
  });

  it("produces a stable, pinned stream — changing this breaks every shared code", () => {
    const r = mulberry32(1);
    const first3 = [r(), r(), r()].map((v) => Math.floor(v * 1e9));
    expect(first3).toMatchInlineSnapshot(`
      [
        627073940,
        2735721,
        527447039,
      ]
    `);
  });
});

describe("encodeSeed / parseSeed", () => {
  it("round-trips across the whole 32-bit range", () => {
    for (const s of [0, 1, 42, 1000, 0xffff, 0x7fffffff, 0xfffffffe, 0xffffffff]) {
      expect(parseSeed(encodeSeed(s))).toBe(s);
    }
  });

  it("round-trips random seeds", () => {
    for (let i = 0; i < 500; i++) {
      const s = randomSeed();
      expect(parseSeed(encodeSeed(s))).toBe(s);
    }
  });

  it("encodes compactly and in upper case", () => {
    expect(encodeSeed(0)).toBe("0");
    expect(encodeSeed(0xffffffff)).toBe("1Z141Z3");
    expect(encodeSeed(0xffffffff).length).toBeLessThanOrEqual(7);
  });

  it("is case-insensitive and tolerates surrounding space", () => {
    expect(parseSeed("1z141z3")).toBe(0xffffffff);
    expect(parseSeed("  ABC  ")).toBe(parseSeed("abc"));
  });

  it("rejects a value one past the 32-bit ceiling", () => {
    expect(parseSeed("1Z141Z4")).toBeNull(); // exactly 2^32
    expect(parseSeed("ZZZZZZZ")).toBeNull();
  });

  it.each(["", "  ", "!", "abc!", "12345678", "-1", "1.5", "1 2", null, undefined, 42])(
    "rejects %p",
    (v) => {
      expect(parseSeed(v as string)).toBeNull();
    },
  );

  it("accepts every base36 digit, letters included", () => {
    // Not a hex prefix: in base36 'x' is just the digit 33, so "0x10" is a real
    // deal code. Worth stating, since it looks like it should be rejected.
    expect(parseSeed("0x10")).toBe(42804);
    expect(parseSeed("zzzzz")).toBe(60466175);
  });
});

describe("randomSeed", () => {
  it("stays inside the 32-bit range", () => {
    for (let i = 0; i < 1000; i++) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("rarely repeats", () => {
    const seen = new Set(Array.from({ length: 1000 }, randomSeed));
    expect(seen.size).toBeGreaterThan(990);
  });
});

describe("seeded deals", () => {
  it("shuffle is reproducible from a generator", () => {
    const a = shuffle(buildDeck(), mulberry32(99)).map((c) => c.id);
    const b = shuffle(buildDeck(), mulberry32(99)).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it("shuffle still defaults to Math.random", () => {
    const runs = new Set(
      Array.from({ length: 5 }, () => shuffle(buildDeck()).map((c) => c.id).join()),
    );
    expect(runs.size).toBeGreaterThan(1);
  });

  it("the same seed deals the identical board", () => {
    const a = new Game(1, 4242).serialize();
    const b = new Game(1, 4242).serialize();
    expect(a).toEqual(b);
    expect(a.seed).toBe(4242);
  });

  it("different seeds deal different boards", () => {
    expect(new Game(1, 1).serialize().tableau).not.toEqual(new Game(1, 2).serialize().tableau);
  });

  it("restartDeal reproduces the layout and resets progress", () => {
    const g = new Game(1, 777);
    const dealt = g.serialize();
    g.drawFromStock();
    g.drawFromStock();
    expect(g.moves).toBe(2);
    g.restartDeal();
    expect(g.serialize()).toEqual(dealt);
    expect(g.moves).toBe(0);
    expect(g.score).toBe(0);
    expect(g.canUndo()).toBe(false);
    expect(g.canRedo()).toBe(false);
  });

  it("restartDeal keeps the seed stable across repeats", () => {
    const g = new Game(3, 31337);
    for (let i = 0; i < 3; i++) g.restartDeal();
    expect(g.seed).toBe(31337);
    expect(g.serialize()).toEqual(new Game(3, 31337).serialize());
  });

  it("a bare deal() picks a new seed", () => {
    const g = new Game(1, 5);
    g.deal();
    expect(g.seed).not.toBe(5);
  });

  it("survives a save/restore round trip", () => {
    const g = new Game(3, 8675309);
    g.drawFromStock();
    const g2 = new Game(1);
    g2.restore(g.serialize());
    expect(g2.seed).toBe(8675309);
    g2.restartDeal();
    expect(g2.serialize().tableau).toEqual(new Game(3, 8675309).serialize().tableau);
  });

  it("deals a legal board for a wide range of seeds", () => {
    for (const seed of [0, 1, 2, 0xffffffff, 123456789]) {
      const g = new Game(1, seed);
      expect(g.tableau.flat()).toHaveLength(28);
      expect(g.stock).toHaveLength(24);
      expect(new Set([...g.tableau.flat(), ...g.stock].map((c) => c.id)).size).toBe(52);
    }
  });
});
