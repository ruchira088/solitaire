// Responsive board geometry. Pure, and the phone-portrait branch plus the
// offset-compression path are easy to regress without noticing on a desktop screen.

import { describe, expect, it } from "vitest";
import { columnOffsets, computeLayout, Layout } from "./layout";

const DESKTOP = () => computeLayout(1400, 900);
const PHONE = () => computeLayout(390, 844);

const faceUp = (n: number) => Array.from({ length: n }, () => ({ faceUp: true }));
const faceDown = (n: number) => Array.from({ length: n }, () => ({ faceUp: false }));

describe("computeLayout — desktop", () => {
  it("gives 7 tableau slots and 4 foundations", () => {
    const l = DESKTOP();
    expect(l.tableau).toHaveLength(7);
    expect(l.foundations).toHaveLength(4);
    expect(l.fanX).toBe(false);
  });

  it("keeps the card aspect ratio", () => {
    const l = DESKTOP();
    expect(l.cardH / l.cardW).toBeCloseTo(1.4, 5);
  });

  it("lays the tableau out left to right at a single y", () => {
    const l = DESKTOP();
    const xs = l.tableau.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(l.tableau.map((p) => p.y)).size).toBe(1);
  });

  it("puts the stock and waste above the tableau", () => {
    const l = DESKTOP();
    expect(l.stock.y).toBeLessThan(l.tableau[0].y);
    expect(l.waste.x).toBeGreaterThan(l.stock.x);
  });

  it("adds one column per spare stack, to the right of the tableau", () => {
    const two = computeLayout(1400, 900, 2);
    expect(two.spares).toHaveLength(2);
    expect(two.spares[0].x).toBeGreaterThan(two.tableau[6].x);
    expect(two.spares[1].x).toBeGreaterThan(two.spares[0].x);
  });

  it("spreads the tableau across most of the width", () => {
    // Height caps the card size at every ordinary landscape aspect, so the
    // leftover width has to go into the gutters — otherwise the board is a small
    // huddle of cards mid-screen with empty felt either side.
    for (const [w, h] of [[1280, 720], [1900, 790], [845, 415], [1400, 900]]) {
      const l = computeLayout(w, h);
      const row = l.tableau[6].x + l.cardW - l.tableau[0].x;
      expect(row / w, `${w}x${h}`).toBeGreaterThan(0.55);
    }
  });

  it("narrows the cards when width is the binding constraint", () => {
    // At ordinary desktop aspect ratios the card size is capped by *height*, so
    // extra spare columns cost nothing. On a tall, narrow window width binds and
    // the 9 columns really do share it out.
    const none = computeLayout(700, 1400, 0);
    const two = computeLayout(700, 1400, 2);
    expect(two.cardW).toBeLessThan(none.cardW);
  });
});

describe("computeLayout — phone portrait", () => {
  it("transposes to the vertical board", () => {
    const l = PHONE();
    expect(l.fanX).toBe(true);
    expect(l.tableau).toHaveLength(7);
    expect(l.foundations).toHaveLength(4);
  });

  it("lists the tableau top to bottom at a single x", () => {
    const l = PHONE();
    const ys = l.tableau.map((p) => p.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(l.tableau.map((p) => p.x)).size).toBe(1);
  });

  it("anchors the foundations down the left edge", () => {
    const l = PHONE();
    expect(new Set(l.foundations.map((p) => p.x)).size).toBe(1);
    expect(l.foundations[0].x).toBeLessThan(l.tableau[0].x);
  });

  it("stays on the vertical board only while narrow and taller than wide", () => {
    expect(computeLayout(519, 900).fanX).toBe(true);
    expect(computeLayout(520, 900).fanX).toBe(false); // wide enough for columns
    expect(computeLayout(480, 400).fanX).toBe(false); // landscape
  });

  it("adds a row per spare stack", () => {
    const l = computeLayout(390, 844, 2);
    expect(l.spares).toHaveLength(2);
    expect(l.spares[0].y).toBeGreaterThan(l.tableau[6].y);
  });
});

describe("computeLayout — compact landscape", () => {
  it("moves spares to their own bottom row instead of extra columns", () => {
    const l = computeLayout(480, 400, 2);
    expect(l.fanX).toBe(false);
    expect(l.spares).toHaveLength(2);
    // A bottom row, not columns to the right of the tableau.
    expect(l.spares[0].y).toBeGreaterThan(l.tableau[0].y);
    expect(l.fanLimit).toBeLessThan(l.height);
  });
});

describe("computeLayout — invariants across sizes", () => {
  const sizes: [number, number][] = [
    [320, 568], [375, 667], [390, 844], [480, 400], [520, 900],
    [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440],
  ];

  it.each(sizes)("keeps every pile on the board at %ix%i", (w, h) => {
    for (const spares of [0, 3]) {
      const l = computeLayout(w, h, spares);
      const piles = [l.stock, l.waste, ...l.foundations, ...l.tableau, ...l.spares];
      for (const p of piles) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + l.cardW).toBeLessThanOrEqual(w + 0.5);
        expect(p.y + l.cardH).toBeLessThanOrEqual(h + 0.5);
      }
    }
  });

  it.each(sizes)("produces positive, finite card metrics at %ix%i", (w, h) => {
    const l = computeLayout(w, h);
    for (const v of [l.cardW, l.cardH, l.radius, l.faceDownStep, l.faceUpStep]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it("never overlaps adjacent tableau columns", () => {
    for (const [w, h] of sizes) {
      const l = computeLayout(w, h);
      if (l.fanX) continue;
      for (let i = 1; i < 7; i++) {
        expect(l.tableau[i].x, `${w}x${h} col ${i}`).toBeGreaterThanOrEqual(
          l.tableau[i - 1].x + l.cardW,
        );
      }
    }
  });
});

describe("columnOffsets", () => {
  const l: Layout = DESKTOP();

  it("returns one offset per card, starting at zero", () => {
    const o = columnOffsets(faceUp(4), l);
    expect(o).toHaveLength(4);
    expect(o[0]).toBe(0);
  });

  it("handles an empty pile and a single card", () => {
    expect(columnOffsets([], l)).toEqual([]);
    expect(columnOffsets(faceUp(1), l)).toEqual([0]);
  });

  it("steps face-down cards more tightly than face-up ones", () => {
    const down = columnOffsets(faceDown(3), l);
    const up = columnOffsets(faceUp(3), l);
    expect(down[1]).toBeLessThan(up[1]);
    expect(down[1]).toBeCloseTo(l.faceDownStep, 5);
    expect(up[1]).toBeCloseTo(l.faceUpStep, 5);
  });

  it("increases monotonically", () => {
    const o = columnOffsets([...faceDown(4), ...faceUp(6)], l);
    for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1]);
  });

  it("sizes the cards so an ordinary column needs no compression", () => {
    // What the fan reserve in computeLayout buys: 6 face-down cards plus a
    // 4-card run always fan at full step. Anything deeper is compressed, which
    // is the trade for cards that aren't tiny.
    for (const [w, h] of [[1280, 720], [1400, 900], [1920, 1080], [845, 415]]) {
      const l = computeLayout(w, h);
      const o = columnOffsets([...faceDown(6), ...faceUp(4)], l);
      expect(o[1], `${w}x${h}`).toBeCloseTo(l.faceDownStep, 5);
      expect(o[o.length - 1] + l.cardH, `${w}x${h}`).toBeLessThanOrEqual(l.fanLimit + 0.5);
    }
  });

  it("compresses a deep pile to stay inside the fan limit", () => {
    const deep = [...faceDown(6), ...faceUp(14)];
    const o = columnOffsets(deep, l);
    const last = o[o.length - 1];
    expect(last + l.cardH).toBeLessThanOrEqual(l.fanLimit + 0.5);
    // and compression really happened
    expect(o[1]).toBeLessThan(l.faceDownStep);
  });

  it("leaves a pile that already fits uncompressed", () => {
    const o = columnOffsets(faceUp(3), l);
    expect(o[1]).toBeCloseTo(l.faceUpStep, 5);
  });

  it("respects a caller-supplied base and limit", () => {
    const tight = columnOffsets(faceUp(10), l, l.tableau[0].y, l.tableau[0].y + l.cardH * 2);
    const last = tight[tight.length - 1];
    expect(last + l.cardH).toBeLessThanOrEqual(l.cardH * 2 + 0.5);
  });
});
