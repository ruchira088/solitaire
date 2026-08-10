// The keyboard cursor. Same convention as game.test.ts: boards are built by hand and
// applied with restore(), so each case states exactly the position it cares about.

import { describe, expect, it } from "vitest";
import { Game, GameState, PileId } from "./game";
import {
  boardRow,
  cardName,
  clampCursor,
  Cursor,
  describe as describeCursor,
  describeMove,
  minDepth,
  moveCursor,
  pileName,
  samePile,
  topRow,
} from "./cursor";

const UP = 52;
const [S, H, D, C] = [0, 1, 2, 3];
const dn = (suit: number, rank: number): number => suit * 13 + rank - 1;
const up = (suit: number, rank: number): number => dn(suit, rank) + UP;

function state(over: Partial<GameState> = {}): GameState {
  return {
    seed: 1, drawCount: 1, easy: false, moves: 0, score: 0,
    stock: [], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []], spares: [],
    ...over,
  };
}
function boardOf(over: Partial<GameState> = {}): Game {
  const g = new Game(1);
  g.restore(state(over));
  return g;
}

const TAB = (i: number): PileId => ({ kind: "tableau", index: i });
const FND = (i: number): PileId => ({ kind: "foundation", index: i });
const SPARE = (i: number): PileId => ({ kind: "spare", index: i });
const STOCK: PileId = { kind: "stock" };
const WASTE: PileId = { kind: "waste" };
const at = (pile: PileId, depth = 0): Cursor => ({ pile, depth });

describe("rows", () => {
  it("puts stock, waste and the four foundations on the top row", () => {
    const g = boardOf();
    expect(topRow().map((p) => pileName(g, p))).toEqual([
      "stock", "waste", "foundation 1", "foundation 2", "foundation 3", "foundation 4",
    ]);
  });

  it("puts the seven columns on the board row, with ✦ stacks after them", () => {
    const g = boardOf({ spares: [[], []] });
    expect(boardRow(g).map((p) => pileName(g, p))).toEqual([
      "column 1", "column 2", "column 3", "column 4", "column 5", "column 6", "column 7",
      "stack 1", "stack 2",
    ]);
  });
});

describe("moveCursor", () => {
  it("walks a row and wraps at both ends", () => {
    const g = boardOf();
    expect(moveCursor(g, at(TAB(0)), "right").pile).toEqual(TAB(1));
    expect(moveCursor(g, at(TAB(6)), "right").pile).toEqual(TAB(0));
    expect(moveCursor(g, at(TAB(0)), "left").pile).toEqual(TAB(6));
    expect(moveCursor(g, at(STOCK), "left").pile).toEqual(FND(3));
  });

  it("includes live ✦ stacks in the wrap", () => {
    const g = boardOf({ spares: [[]] });
    expect(moveCursor(g, at(TAB(6)), "right").pile).toEqual(SPARE(0));
    expect(moveCursor(g, at(SPARE(0)), "right").pile).toEqual(TAB(0));
  });

  it("swaps rows with up and down, keeping the nearest column", () => {
    const g = boardOf();
    expect(moveCursor(g, at(TAB(1)), "up").pile).toEqual(topRow()[1]);
    expect(moveCursor(g, at(FND(0)), "down").pile).toEqual(TAB(2)); // foundation 0 is index 2
  });

  it("clamps to the shorter row rather than falling off it", () => {
    const g = boardOf();
    expect(moveCursor(g, at(TAB(6)), "up").pile).toEqual(FND(3)); // top row has 6 slots
  });

  it("stays put when asked to go to the row it is already on", () => {
    const g = boardOf();
    expect(moveCursor(g, at(STOCK), "up").pile).toEqual(STOCK);
    expect(moveCursor(g, at(TAB(3)), "down").pile).toEqual(TAB(3));
  });
});

describe("grab depth", () => {
  it("starts on the top card of a column", () => {
    const g = boardOf({ tableau: [[dn(C, 4), up(S, 8), up(H, 7)], [], [], [], [], [], []] });
    expect(clampCursor(g, at(TAB(0), 99)).depth).toBe(2);
  });

  it("goes as deep as the run stays valid, and no further", () => {
    // 8♠ 7♥ is a valid descending alternating run; the 4♣ under it is face down.
    const g = boardOf({ tableau: [[dn(C, 4), up(S, 8), up(H, 7)], [], [], [], [], [], []] });
    expect(minDepth(g, TAB(0))).toBe(1);
    let c = at(TAB(0), 2);
    c = moveCursor(g, c, "deeper");
    expect(c.depth).toBe(1);
    c = moveCursor(g, c, "deeper");
    expect(c.depth).toBe(1); // the face-down card is not grabbable
  });

  it("won't descend through a broken run", () => {
    // 8♠ then 9♥ is not descending, so only the top card can move.
    const g = boardOf({ tableau: [[up(S, 8), up(H, 9)], [], [], [], [], [], []] });
    expect(minDepth(g, TAB(0))).toBe(1);
    expect(moveCursor(g, at(TAB(0), 1), "deeper").depth).toBe(1);
  });

  it("comes back up towards the top card", () => {
    const g = boardOf({ tableau: [[up(S, 10), up(H, 9), up(S, 8)], [], [], [], [], [], []] });
    expect(minDepth(g, TAB(0))).toBe(0);
    expect(moveCursor(g, at(TAB(0), 0), "shallower").depth).toBe(1);
    expect(moveCursor(g, at(TAB(0), 2), "shallower").depth).toBe(2); // already on top
  });

  it("ignores depth on piles you can only take one card from", () => {
    const g = boardOf({ waste: [up(S, 3), up(H, 4)], foundations: [[up(S, 1)], [], [], []] });
    expect(moveCursor(g, at(WASTE, 1), "deeper").depth).toBe(1);
    expect(minDepth(g, WASTE)).toBe(1);
    expect(minDepth(g, FND(0))).toBe(0);
  });
});

describe("clampCursor", () => {
  it("lands on 0 for an empty pile", () => {
    expect(clampCursor(boardOf(), at(TAB(0), 5))).toEqual({ pile: TAB(0), depth: 0 });
  });

  it("pulls a too-deep cursor back to the top card", () => {
    const g = boardOf({ tableau: [[up(S, 8)], [], [], [], [], [], []] });
    expect(clampCursor(g, at(TAB(0), 9)).depth).toBe(0);
  });

  it("falls back to a column when the ✦ stack it was on has gone", () => {
    const g = boardOf({ spares: [] }); // the stack emptied and vanished
    expect(clampCursor(g, at(SPARE(0), 0)).pile).toEqual(TAB(6));
  });

  it("keeps a still-valid spare where it is", () => {
    const g = boardOf({ spares: [[up(S, 5)]] });
    expect(clampCursor(g, at(SPARE(0), 0)).pile).toEqual(SPARE(0));
  });
});

describe("foundation names follow the cards, not the index", () => {
  // canMoveToFoundation lets *any* ace start *any* foundation, so index 0 is not the
  // spades pile — it is whatever suit landed on it. Naming it by index would promise
  // a rule the game doesn't have.
  it("numbers an empty foundation", () => {
    expect(pileName(boardOf(), FND(0))).toBe("foundation 1");
    expect(pileName(boardOf(), FND(3))).toBe("foundation 4");
  });

  it("names a foundation for the suit actually sitting on it", () => {
    const g = boardOf({ foundations: [[up(D, 1)], [], [], [up(H, 1)]] });
    expect(pileName(g, FND(0))).toBe("diamonds foundation");
    expect(pileName(g, FND(3))).toBe("hearts foundation");
  });

  it("describes a move to a foundation by where the card actually went", () => {
    const g = boardOf({ foundations: [[up(D, 1)], [], [], []] });
    expect(describeMove(g, g.foundations[0], FND(0), null)).toBe(
      "moved ace of diamonds to diamonds foundation",
    );
  });
});

describe("samePile", () => {
  it("compares kind and index", () => {
    expect(samePile(TAB(2), TAB(2))).toBe(true);
    expect(samePile(TAB(2), TAB(3))).toBe(false);
    expect(samePile(TAB(0), SPARE(0))).toBe(false);
    expect(samePile(STOCK, STOCK)).toBe(true);
    expect(samePile(STOCK, WASTE)).toBe(false);
  });
});

describe("names read as speech, not as glyphs", () => {
  it.each([
    [up(S, 1), "ace of spades"],
    [up(H, 11), "jack of hearts"],
    [up(D, 12), "queen of diamonds"],
    [up(C, 13), "king of clubs"],
    [up(H, 7), "7 of hearts"],
    [up(S, 10), "10 of spades"],
  ])("names a card", (code, expected) => {
    const g = boardOf({ tableau: [[code], [], [], [], [], [], []] });
    expect(cardName(g.tableau[0][0])).toBe(expected);
  });
});

describe("describe", () => {
  it("says a pile is empty", () => {
    expect(describeCursor(boardOf(), at(TAB(0)))).toBe("column 1, empty");
    expect(describeCursor(boardOf(), at(FND(1)))).toBe("foundation 2, empty");
  });

  it("counts the stock rather than naming a face-down card", () => {
    const g = boardOf({ stock: [dn(S, 2), dn(S, 3), dn(S, 4)] });
    expect(describeCursor(g, at(STOCK, 2))).toBe("stock, 3 cards face down");
  });

  it("says card for a stock of one", () => {
    expect(describeCursor(boardOf({ stock: [dn(S, 2)] }), at(STOCK, 0))).toBe("stock, 1 card face down");
  });

  it("names the focused card and how much would come with it", () => {
    const g = boardOf({ tableau: [[dn(C, 4), up(S, 8), up(H, 7)], [], [], [], [], [], []] });
    expect(describeCursor(g, at(TAB(0), 2))).toBe("column 1, 7 of hearts, 1 face down");
    expect(describeCursor(g, at(TAB(0), 1))).toBe("column 1, 8 of spades, run of 2, 1 face down");
  });

  it("leaves the face-down count off when there is nothing hidden", () => {
    const g = boardOf({ tableau: [[up(S, 8)], [], [], [], [], [], []] });
    expect(describeCursor(g, at(TAB(0), 0))).toBe("column 1, 8 of spades");
  });

  it("reports a face-down card without naming it", () => {
    const g = boardOf({ tableau: [[dn(C, 4)], [], [], [], [], [], []] });
    expect(describeCursor(g, at(TAB(0), 0))).toBe("column 1, face down");
  });
});

describe("describeMove", () => {
  it("names a single card and where it went", () => {
    const g = boardOf({ tableau: [[up(H, 7)], [], [], [], [], [], []] });
    expect(describeMove(g, [g.tableau[0][0]], TAB(4), null)).toBe("moved 7 of hearts to column 5");
  });

  it("counts a run and names the card it starts from", () => {
    const g = boardOf({ tableau: [[up(S, 8), up(H, 7)], [], [], [], [], [], []] });
    expect(describeMove(g, g.tableau[0], FND(0), null)).toBe(
      "moved 2 cards from 8 of spades to foundation 1",
    );
  });

  it("mentions a card turned up by the move, which is the point of making it", () => {
    const g = boardOf({ tableau: [[up(C, 4), up(H, 7)], [], [], [], [], [], []] });
    expect(describeMove(g, [g.tableau[0][1]], TAB(1), g.tableau[0][0])).toBe(
      "moved 7 of hearts to column 2, turned up 4 of clubs",
    );
  });
});
