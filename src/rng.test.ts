// The seeded PRNG and deal codes. These are a wire format — codes get shared and
// bookmarked — so the tests pin exact output, not just "it looks random".

import { describe, expect, it } from "vitest";
import {
  dailyDayForSeed,
  dailyKey,
  dailySeed,
  encodeSeed,
  isDailyKey,
  mulberry32,
  parseSeed,
  randomSeed,
  recentDailyKeys,
  shiftDailyKey,
} from "./rng";
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

describe("dailyKey", () => {
  it("formats as YYYY-MM-DD with both parts padded", () => {
    expect(dailyKey(new Date(2026, 7, 10))).toBe("2026-08-10");
    expect(dailyKey(new Date(2026, 0, 1))).toBe("2026-01-01");
    expect(dailyKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("reads the local date, not UTC", () => {
    // 23:30 local on the 10th is already the 11th in UTC for anything east of the
    // meridian. The player's own day is what "today's deal" means, so this is the
    // local components — the assertion holds in whatever zone the tests run in.
    const d = new Date(2026, 7, 10, 23, 30);
    expect(dailyKey(d)).toBe("2026-08-10");
  });

  it("accepts what it produces", () => {
    expect(isDailyKey(dailyKey(new Date(2026, 7, 10)))).toBe(true);
  });

  it.each(["", "2026-8-10", "2026/08/10", "20260810", "not a date", null, undefined, 42, {}])(
    "rejects %p as a key",
    (v) => {
      expect(isDailyKey(v)).toBe(false);
    },
  );
});

describe("dailySeed", () => {
  it("pins the date-to-board mapping — changing this rewrites recorded streaks", () => {
    const seeds = ["2026-08-10", "2026-08-11", "2026-01-01", "2030-12-31"].map(dailySeed);
    expect(seeds).toMatchInlineSnapshot(`
      [
        1830916629,
        638710691,
        2231550793,
        1607914341,
      ]
    `);
  });

  it("is stable for a given day", () => {
    expect(dailySeed("2026-08-10")).toBe(dailySeed("2026-08-10"));
  });

  it("stays inside the 32-bit range", () => {
    for (let y = 2024; y < 2035; y++) {
      for (let m = 1; m <= 12; m++) {
        const s = dailySeed(`${y}-${String(m).padStart(2, "0")}-15`);
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(0xffffffff);
      }
    }
  });

  it("gives consecutive days unrelated boards", () => {
    // The point of hashing the date rather than seeding with it: neighbouring days
    // differ by one low digit, and the boards must not resemble each other.
    const a = new Game(1, dailySeed("2026-08-10")).serialize().tableau;
    const b = new Game(1, dailySeed("2026-08-11")).serialize().tableau;
    expect(a).not.toEqual(b);
  });

  it("collides rarely across a decade of days", () => {
    const seeds = new Set<number>();
    let days = 0;
    for (const d = new Date(2026, 0, 1); d.getFullYear() < 2036; d.setDate(d.getDate() + 1)) {
      seeds.add(dailySeed(dailyKey(d)));
      days++;
    }
    expect(days).toBeGreaterThan(3600);
    expect(seeds.size).toBe(days); // no two days share a board
  });

  it("round-trips through a shareable deal code, like any other deal", () => {
    const s = dailySeed("2026-08-10");
    expect(parseSeed(encodeSeed(s))).toBe(s);
  });
});

describe("the daily archive", () => {
  it("steps back and forward a day at a time", () => {
    expect(shiftDailyKey("2026-08-11", -1)).toBe("2026-08-10");
    expect(shiftDailyKey("2026-08-11", 1)).toBe("2026-08-12");
    expect(shiftDailyKey("2026-08-11", 0)).toBe("2026-08-11");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(shiftDailyKey("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDailyKey("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDailyKey("2028-03-01", -1)).toBe("2028-02-29"); // 2028 is a leap year
    expect(shiftDailyKey("2027-03-01", -1)).toBe("2027-02-28");
  });

  it("is unaffected by daylight saving, where a local day isn't 24 hours", () => {
    // European spring-forward (23h) and autumn-back (25h).
    expect(shiftDailyKey("2026-03-30", -1)).toBe("2026-03-29");
    expect(shiftDailyKey("2026-10-26", -1)).toBe("2026-10-25");
  });

  it("lists the recent days newest first, today included", () => {
    expect(recentDailyKeys("2026-08-11", 4)).toEqual([
      "2026-08-11", "2026-08-10", "2026-08-09", "2026-08-08",
    ]);
    expect(recentDailyKeys("2026-08-11", 0)).toEqual([]);
  });

  it("recognises which day a board came from, by its seed alone", () => {
    for (const key of ["2026-08-11", "2026-08-04", "2026-07-20"]) {
      expect(dailyDayForSeed(dailySeed(key), "2026-08-11", 28)).toBe(key);
    }
  });

  it("says a board is not a daily when it isn't one", () => {
    expect(dailyDayForSeed(12345, "2026-08-11", 28)).toBeNull();
  });

  it("won't claim a day older than the window it was asked to search", () => {
    const old = shiftDailyKey("2026-08-11", -60);
    expect(dailyDayForSeed(dailySeed(old), "2026-08-11", 28)).toBeNull();
    expect(dailyDayForSeed(dailySeed(old), "2026-08-11", 90)).toBe(old);
  });

  it("won't claim a future day", () => {
    const tomorrow = shiftDailyKey("2026-08-11", 1);
    expect(dailyDayForSeed(dailySeed(tomorrow), "2026-08-11", 28)).toBeNull();
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
