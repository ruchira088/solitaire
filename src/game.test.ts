// Klondike rules, moves, scoring and undo. game.ts is pure by design, so these need
// no DOM and no canvas.
//
// Boards are built by hand and applied with `restore()` rather than dealt, so every
// test states exactly the position it cares about. `restore()` does no validation —
// that's parseGameState's job, covered separately — so a board here may hold fewer
// than 52 cards when the missing ones are irrelevant to the rule under test.

import { describe, expect, it, vi } from "vitest";
import { Game, GameState, MAX_SPARES, PileId } from "./game";

const UP = 52;
const [S, H, D, C] = [0, 1, 2, 3]; // suit indices, matching SUITS in cards.ts
const dn = (suit: number, rank: number): number => suit * 13 + rank - 1;
const up = (suit: number, rank: number): number => dn(suit, rank) + UP;

function state(over: Partial<GameState> = {}): GameState {
  return {
    drawCount: 1,
    easy: false,
    moves: 0,
    score: 0,
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    spares: [],
    ...over,
  };
}

function boardOf(over: Partial<GameState> = {}): Game {
  const g = new Game(1);
  g.restore(state(over));
  return g;
}

const TABLEAU = (i: number): PileId => ({ kind: "tableau", index: i });
const FOUNDATION = (i: number): PileId => ({ kind: "foundation", index: i });
const SPARE = (i: number): PileId => ({ kind: "spare", index: i });
const WASTE: PileId = { kind: "waste" };
const STOCK: PileId = { kind: "stock" };

describe("deal", () => {
  it("puts 28 cards in the tableau and 24 in the stock", () => {
    const g = new Game(1);
    expect(g.tableau.flat()).toHaveLength(28);
    expect(g.stock).toHaveLength(24);
    expect(g.waste).toHaveLength(0);
    expect(g.foundations.flat()).toHaveLength(0);
  });

  it("gives column i exactly i+1 cards", () => {
    const g = new Game(1);
    expect(g.tableau.map((c) => c.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("turns up exactly the last card of each column", () => {
    const g = new Game(1);
    for (const col of g.tableau) {
      expect(col.map((c) => c.faceUp)).toEqual([...col.slice(0, -1).map(() => false), true]);
    }
  });

  it("leaves the whole stock face down", () => {
    expect(new Game(1).stock.every((c) => !c.faceUp)).toBe(true);
  });

  it("deals all 52 distinct card ids", () => {
    const g = new Game(1);
    const ids = new Set([...g.tableau.flat(), ...g.stock].map((c) => c.id));
    expect(ids.size).toBe(52);
  });

  it("resets moves, score and undo history", () => {
    const g = new Game(1);
    g.drawFromStock();
    g.deal();
    expect(g.moves).toBe(0);
    expect(g.score).toBe(0);
    expect(g.canUndo()).toBe(false);
  });

  it("preserves drawCount and easy mode across a re-deal", () => {
    const g = new Game(3);
    g.easyEmptyStacks = true;
    g.deal();
    expect(g.drawCount).toBe(3);
    expect(g.easyEmptyStacks).toBe(true);
  });
});

describe("isValidRun", () => {
  it("accepts a descending alternating-colour run", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(S, 7), up(D, 6)], [], [], [], [], [], []] });
    expect(g.isValidRun(g.tableau[0])).toBe(true);
  });

  it("accepts a single card", () => {
    const g = boardOf({ tableau: [[up(H, 8)], [], [], [], [], [], []] });
    expect(g.isValidRun(g.tableau[0])).toBe(true);
  });

  it("rejects a run containing a face-down card", () => {
    const g = boardOf({ tableau: [[dn(H, 8), up(S, 7)], [], [], [], [], [], []] });
    expect(g.isValidRun(g.tableau[0])).toBe(false);
  });

  it("rejects two cards of the same colour", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(D, 7)], [], [], [], [], [], []] });
    expect(g.isValidRun(g.tableau[0])).toBe(false);
  });

  it("rejects a gap in rank", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(S, 6)], [], [], [], [], [], []] });
    expect(g.isValidRun(g.tableau[0])).toBe(false);
  });

  it("rejects an ascending pair", () => {
    const g = boardOf({ tableau: [[up(S, 7), up(H, 8)], [], [], [], [], [], []] });
    expect(g.isValidRun(g.tableau[0])).toBe(false);
  });
});

describe("canMoveToTableau", () => {
  it("lets an empty column take only a King", () => {
    const g = boardOf();
    expect(g.canMoveToTableau({ id: 12, suit: "spades", rank: 13, faceUp: true }, 0)).toBe(true);
    expect(g.canMoveToTableau({ id: 11, suit: "spades", rank: 12, faceUp: true }, 0)).toBe(false);
  });

  it("lets an empty column take any card in easy mode", () => {
    const g = boardOf();
    g.easyEmptyStacks = true;
    expect(g.canMoveToTableau({ id: 0, suit: "spades", rank: 1, faceUp: true }, 0)).toBe(true);
  });

  it("accepts one lower and the opposite colour", () => {
    const g = boardOf({ tableau: [[up(S, 8)], [], [], [], [], [], []] });
    expect(g.canMoveToTableau({ id: dn(H, 7), suit: "hearts", rank: 7, faceUp: true }, 0)).toBe(true);
  });

  it("rejects the same colour", () => {
    const g = boardOf({ tableau: [[up(S, 8)], [], [], [], [], [], []] });
    expect(g.canMoveToTableau({ id: dn(C, 7), suit: "clubs", rank: 7, faceUp: true }, 0)).toBe(false);
  });

  it("rejects a drop onto a face-down top card", () => {
    const g = boardOf({ tableau: [[dn(S, 8)], [], [], [], [], [], []] });
    expect(g.canMoveToTableau({ id: dn(H, 7), suit: "hearts", rank: 7, faceUp: true }, 0)).toBe(false);
  });
});

describe("canMoveToFoundation", () => {
  it("accepts only an Ace on an empty foundation", () => {
    const g = boardOf();
    expect(g.canMoveToFoundation({ id: 0, suit: "spades", rank: 1, faceUp: true }, 0)).toBe(true);
    expect(g.canMoveToFoundation({ id: 1, suit: "spades", rank: 2, faceUp: true }, 0)).toBe(false);
  });

  it("accepts the next rank in the same suit", () => {
    const g = boardOf({ foundations: [[up(S, 1)], [], [], []] });
    expect(g.canMoveToFoundation({ id: dn(S, 2), suit: "spades", rank: 2, faceUp: true }, 0)).toBe(true);
  });

  it("rejects another suit and rejects a skipped rank", () => {
    const g = boardOf({ foundations: [[up(S, 1)], [], [], []] });
    expect(g.canMoveToFoundation({ id: dn(H, 2), suit: "hearts", rank: 2, faceUp: true }, 0)).toBe(false);
    expect(g.canMoveToFoundation({ id: dn(S, 3), suit: "spades", rank: 3, faceUp: true }, 0)).toBe(false);
  });
});

describe("moveCards", () => {
  it("turns up the newly exposed card and reports it as flipped", () => {
    const g = boardOf({ tableau: [[dn(C, 4), up(S, 8)], [up(H, 9)], [], [], [], [], []] });
    const r = g.moveCards(TABLEAU(0), 1, TABLEAU(1))!;
    expect(r).not.toBeNull();
    expect(r.flipped?.id).toBe(dn(C, 4));
    expect(g.tableau[0][0].faceUp).toBe(true);
  });

  it("reports no flip when the exposed card was already face up", () => {
    const g = boardOf({ tableau: [[up(H, 10), up(S, 9), up(H, 8)], [up(C, 9)], [], [], [], [], []] });
    const r = g.moveCards(TABLEAU(0), 2, TABLEAU(1))!;
    expect(r).not.toBeNull();
    expect(r.flipped).toBeNull();
  });

  it("moves a whole valid run", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(S, 7)], [up(S, 9)], [], [], [], [], []] });
    expect(g.moveCards(TABLEAU(0), 0, TABLEAU(1))).not.toBeNull();
    expect(g.tableau[1].map((c) => c.id)).toEqual([dn(S, 9), dn(H, 8), dn(S, 7)]);
    expect(g.tableau[0]).toHaveLength(0);
  });

  it("refuses an invalid run", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(H, 7)], [up(S, 9)], [], [], [], [], []] });
    expect(g.moveCards(TABLEAU(0), 0, TABLEAU(1))).toBeNull();
  });

  it("refuses a multi-card move to a foundation", () => {
    const g = boardOf({ tableau: [[up(S, 1), up(H, 2)], [], [], [], [], [], []] });
    expect(g.moveCards(TABLEAU(0), 0, FOUNDATION(0))).toBeNull();
  });

  it("refuses any move onto the stock or the waste", () => {
    const g = boardOf({ tableau: [[up(S, 13)], [], [], [], [], [], []] });
    expect(g.moveCards(TABLEAU(0), 0, STOCK)).toBeNull();
    expect(g.moveCards(TABLEAU(0), 0, WASTE)).toBeNull();
  });

  it("refuses an out-of-range source index", () => {
    const g = boardOf({ tableau: [[up(S, 13)], [], [], [], [], [], []] });
    expect(g.moveCards(TABLEAU(0), 5, TABLEAU(1))).toBeNull();
    expect(g.moveCards(TABLEAU(0), -1, TABLEAU(1))).toBeNull();
  });

  it("refuses a multi-card move from the waste", () => {
    const g = boardOf({ waste: [up(S, 1), up(H, 2)], tableau: [[up(S, 3)], [], [], [], [], [], []] });
    expect(g.moveCards(WASTE, 0, TABLEAU(0))).toBeNull();
  });

  it("only lets a spare accept a card while it is empty", () => {
    const g = boardOf({ spares: [[up(S, 5)]], tableau: [[up(H, 9)], [], [], [], [], [], []] });
    expect(g.moveCards(TABLEAU(0), 0, SPARE(0))).toBeNull();
  });

  it("removes an emptied spare and shifts later spares down", () => {
    const g = boardOf({ spares: [[up(S, 5)], [], []], tableau: [[up(H, 6)], [], [], [], [], [], []] });
    const r = g.moveCards(SPARE(0), 0, TABLEAU(0))!;
    expect(r).not.toBeNull();
    expect(g.spares).toHaveLength(2);
    expect(g.tableau[0].map((c) => c.id)).toEqual([dn(H, 6), dn(S, 5)]);
  });

  it("re-indexes the destination when a spare to its left is removed", () => {
    // The `adjTo` branch: emptying spare 0 splices it out, so the card that landed
    // on spare 1 is now at spare 0 and the result must say so.
    const g = boardOf({ spares: [[up(S, 5)], []] });
    const r = g.moveCards(SPARE(0), 0, SPARE(1))!;
    expect(r.to).toEqual({ kind: "spare", index: 0 });
    expect(g.spares).toHaveLength(1);
    expect(g.spares[0].map((c) => c.id)).toEqual([dn(S, 5)]);
  });

  it("counts a move", () => {
    const g = boardOf({ tableau: [[up(S, 13)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, TABLEAU(1));
    expect(g.moves).toBe(1);
  });
});

describe("addTempStack", () => {
  it("costs 50 points", () => {
    const g = boardOf({ score: 120 });
    expect(g.addTempStack()).toBe(true);
    expect(g.score).toBe(70);
    expect(g.spares).toHaveLength(1);
  });

  it("clamps the cost at zero", () => {
    const g = boardOf({ score: 10 });
    g.addTempStack();
    expect(g.score).toBe(0);
  });

  it(`is capped at ${MAX_SPARES} live stacks`, () => {
    const g = boardOf();
    for (let i = 0; i < MAX_SPARES; i++) expect(g.addTempStack()).toBe(true);
    expect(g.addTempStack()).toBe(false);
    expect(g.spares).toHaveLength(MAX_SPARES);
  });
});

describe("drawFromStock", () => {
  it("moves one card face up in draw-1", () => {
    const g = boardOf({ stock: [dn(S, 2), dn(S, 3)] });
    const r = g.drawFromStock()!;
    expect(r.moved).toHaveLength(1);
    expect(g.waste).toHaveLength(1);
    expect(g.waste[0].faceUp).toBe(true);
    expect(g.stock).toHaveLength(1);
  });

  it("moves three in draw-3", () => {
    const g = boardOf({ drawCount: 3, stock: [1, 2, 3, 4, 5] });
    g.drawFromStock();
    expect(g.waste).toHaveLength(3);
    expect(g.stock).toHaveLength(2);
  });

  it("draws only what remains when the stock is short", () => {
    const g = boardOf({ drawCount: 3, stock: [1, 2] });
    g.drawFromStock();
    expect(g.waste).toHaveLength(2);
    expect(g.stock).toHaveLength(0);
  });

  it("recycles the waste face down, restoring the original order", () => {
    const g = boardOf({ stock: [], waste: [up(S, 2), up(S, 3), up(S, 4)] });
    const r = g.drawFromStock()!;
    expect(r.from).toEqual(WASTE);
    expect(r.to).toEqual(STOCK);
    expect(g.waste).toHaveLength(0);
    expect(g.stock.every((c) => !c.faceUp)).toBe(true);
    // Drawing them back out returns the original order.
    const back = [g.drawFromStock()!, g.drawFromStock()!, g.drawFromStock()!];
    expect(back.map((m) => m.moved[0].id)).toEqual([dn(S, 2), dn(S, 3), dn(S, 4)]);
  });

  it("returns null and records no undo when stock and waste are both empty", () => {
    const g = boardOf({ stock: [], waste: [] });
    expect(g.drawFromStock()).toBeNull();
    expect(g.canUndo()).toBe(false);
    expect(g.moves).toBe(0);
  });
});

describe("scoring", () => {
  it("gives 10 for a card sent to a foundation", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    expect(g.score).toBe(10);
  });

  it("takes 15 for pulling a card back down to the tableau", () => {
    const g = boardOf({ score: 100, foundations: [[up(S, 1)], [], [], []], tableau: [[up(H, 2)], [], [], [], [], [], []] });
    g.moveCards(FOUNDATION(0), 0, TABLEAU(0));
    expect(g.score).toBe(85);
  });

  it("gives 5 for waste to tableau", () => {
    const g = boardOf({ waste: [up(H, 7)], tableau: [[up(S, 8)], [], [], [], [], [], []] });
    g.moveCards(WASTE, 0, TABLEAU(0));
    expect(g.score).toBe(5);
  });

  it("gives 5 for turning a card up, on top of the move's own score", () => {
    const g = boardOf({ tableau: [[dn(C, 4), up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 1, FOUNDATION(0));
    expect(g.score).toBe(15); // 10 foundation + 5 flip
  });

  it("never drops below zero", () => {
    const g = boardOf({ score: 5, foundations: [[up(S, 1)], [], [], []], tableau: [[up(H, 2)], [], [], [], [], [], []] });
    g.moveCards(FOUNDATION(0), 0, TABLEAU(0));
    expect(g.score).toBe(0);
  });
});

describe("undo", () => {
  it("restores the exact prior board", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(S, 7)], [up(S, 9)], [], [], [], [], []], score: 100 });
    const before = g.serialize();
    g.moveCards(TABLEAU(0), 0, TABLEAU(1));
    expect(g.undo()).toBe(true);
    const after = g.serialize();
    expect(after.tableau).toEqual(before.tableau);
    expect(after.moves).toEqual(before.moves);
  });

  it("costs exactly 5 points off the restored score", () => {
    // Start high enough that the zero-clamp can't hide the penalty.
    const g = boardOf({ score: 100, tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    expect(g.score).toBe(110);
    g.undo();
    expect(g.score).toBe(95); // restored 100, less the 5-point undo penalty
  });

  it("charges the penalty on each undo, against that snapshot's score", () => {
    // The penalty applies to the *restored* score, it doesn't compound off the
    // current one — so stepping back through two scoring moves gives 105 then 95.
    const g = boardOf({ score: 100, tableau: [[up(S, 1)], [up(H, 1)], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0)); // +10 -> 110
    g.moveCards(TABLEAU(1), 0, FOUNDATION(1)); // +10 -> 120
    expect(g.score).toBe(120);
    g.undo();
    expect(g.score).toBe(105); // restored 110, less 5
    g.undo();
    expect(g.score).toBe(95); // restored 100, less 5
  });

  it("still clamps at zero when the score is below the penalty", () => {
    const g = boardOf({ score: 0, tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0)); // +10
    g.undo();
    expect(g.score).toBe(0); // restored 0, penalty clamped
  });

  it("clamps the penalty at zero", () => {
    const g = boardOf({ score: 0, tableau: [[up(S, 13)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, TABLEAU(1));
    g.undo();
    expect(g.score).toBe(0);
  });

  it("returns false with no history", () => {
    expect(boardOf().undo()).toBe(false);
  });

  it("restores a bought spare stack away again", () => {
    const g = boardOf();
    g.addTempStack();
    expect(g.spares).toHaveLength(1);
    g.undo();
    expect(g.spares).toHaveLength(0);
  });

  it("caps history at 200 snapshots", () => {
    const g = boardOf({ stock: Array.from({ length: 300 }, (_, i) => i % 52) });
    for (let i = 0; i < 250; i++) g.drawFromStock();
    let undos = 0;
    while (g.undo()) undos++;
    expect(undos).toBe(200);
  });

  it("is cleared by restore", () => {
    const g = boardOf({ tableau: [[up(S, 13)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, TABLEAU(1));
    expect(g.canUndo()).toBe(true);
    g.restore(state());
    expect(g.canUndo()).toBe(false);
  });

  it("does not alias the restored state's arrays", () => {
    const s = state({ tableau: [[up(S, 13)], [], [], [], [], [], []] });
    const g = boardOf();
    g.restore(s);
    g.tableau[0].pop();
    expect(s.tableau[0]).toHaveLength(1);
  });
});

describe("redo", () => {
  it("returns false with nothing undone", () => {
    expect(boardOf().redo()).toBe(false);
    expect(boardOf().canRedo()).toBe(false);
  });

  it("puts the board back exactly as it was before the undo", () => {
    const g = boardOf({ tableau: [[up(H, 8), up(S, 7)], [up(S, 9)], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, TABLEAU(1));
    const afterMove = g.serialize();
    g.undo();
    expect(g.canRedo()).toBe(true);
    expect(g.redo()).toBe(true);
    expect(g.serialize()).toEqual(afterMove);
  });

  it("refunds the undo penalty, so a round trip costs nothing", () => {
    const g = boardOf({ score: 100, tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0)); // -> 110
    g.undo();
    expect(g.score).toBe(95);
    g.redo();
    expect(g.score).toBe(110);
  });

  it("is invalidated by a new move", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [up(H, 1)], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    g.undo();
    expect(g.canRedo()).toBe(true);
    g.moveCards(TABLEAU(1), 0, FOUNDATION(1)); // a different branch
    expect(g.canRedo()).toBe(false);
  });

  it("is invalidated by buying a spare stack", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    g.undo();
    g.addTempStack();
    expect(g.canRedo()).toBe(false);
  });

  it("survives a dead-stock click, which records no history", () => {
    // Regression: drawFromStock used to push history and pop it again on this
    // path, which would have cleared the redo stack as a side effect.
    const g = boardOf({ stock: [], waste: [], tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    g.undo();
    expect(g.canRedo()).toBe(true);
    expect(g.drawFromStock()).toBeNull();
    expect(g.canRedo()).toBe(true);
  });

  it("walks a multi-move sequence forwards and backwards", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [up(H, 1)], [up(D, 1)], [], [], [], []] });
    const states = [g.serialize()];
    for (let i = 0; i < 3; i++) {
      g.moveCards(TABLEAU(i), 0, FOUNDATION(i));
      states.push(g.serialize());
    }
    for (let i = 3; i > 0; i--) {
      g.undo();
      expect(g.serialize().tableau, `after undo to ${i - 1}`).toEqual(states[i - 1].tableau);
    }
    for (let i = 1; i <= 3; i++) {
      g.redo();
      expect(g.serialize().tableau, `after redo to ${i}`).toEqual(states[i].tableau);
    }
    expect(g.canRedo()).toBe(false);
  });

  it("is cleared by deal and by restore", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    g.undo();
    expect(g.canRedo()).toBe(true);
    g.deal();
    expect(g.canRedo()).toBe(false);

    const g2 = boardOf({ tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g2.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    g2.undo();
    g2.restore(state());
    expect(g2.canRedo()).toBe(false);
  });

  it("does not alias the live board through the forward stack", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [], [], [], [], [], []] });
    g.moveCards(TABLEAU(0), 0, FOUNDATION(0));
    g.undo();
    g.tableau[0].pop(); // mutate the live board
    g.redo();
    expect(g.foundations[0]).toHaveLength(1); // redo unaffected by that mutation
  });
});

describe("isWon / canAutoComplete", () => {
  const full = (suit: number): number[] => Array.from({ length: 13 }, (_, r) => up(suit, r + 1));

  it("is won when all four foundations are complete", () => {
    const g = boardOf({ foundations: [full(S), full(H), full(D), full(C)] });
    expect(g.isWon()).toBe(true);
    expect(g.canAutoComplete()).toBe(false);
  });

  it("is not won one card short", () => {
    const g = boardOf({ foundations: [full(S).slice(0, 12), full(H), full(D), full(C)] });
    expect(g.isWon()).toBe(false);
  });

  it("cannot auto-complete while a tableau card is face down", () => {
    const g = boardOf({ tableau: [[dn(S, 5), up(S, 4)], [], [], [], [], [], []] });
    expect(g.canAutoComplete()).toBe(false);
  });

  it("cannot auto-complete while stock or waste holds a card", () => {
    expect(boardOf({ stock: [1] }).canAutoComplete()).toBe(false);
    expect(boardOf({ waste: [up(S, 1)] }).canAutoComplete()).toBe(false);
  });

  it("can auto-complete an all-face-up board with an empty stock and waste", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [], [], [], [], [], []] });
    expect(g.canAutoComplete()).toBe(true);
  });

  it("drains a solved board to a win", () => {
    const g = boardOf({
      foundations: [full(S).slice(0, 12), full(H), full(D), full(C)],
      tableau: [[up(S, 13)], [], [], [], [], [], []],
    });
    let steps = 0;
    while (g.autoCompleteStep() && steps < 60) steps++;
    expect(g.isWon()).toBe(true);
    expect(steps).toBe(1);
  });

  it("returns null from autoCompleteStep when nothing can move", () => {
    const g = boardOf({ tableau: [[up(S, 5)], [], [], [], [], [], []] });
    expect(g.autoCompleteStep()).toBeNull();
  });
});

describe("findHint", () => {
  it("prefers a foundation move", () => {
    const g = boardOf({ tableau: [[up(S, 1)], [up(H, 9)], [], [], [], [], []] });
    expect(g.findHint()?.to).toEqual(FOUNDATION(0));
  });

  it("suggests a tableau move that reveals a face-down card", () => {
    const g = boardOf({ tableau: [[dn(C, 4), up(H, 7)], [up(S, 8)], [], [], [], [], []] });
    const h = g.findHint()!;
    expect(h.from).toEqual(TABLEAU(0));
    expect(h.to).toEqual(TABLEAU(1));
  });

  it("falls back to drawing when nothing else is available", () => {
    const g = boardOf({ stock: [1, 2, 3], tableau: [[up(S, 5)], [], [], [], [], [], []] });
    expect(g.findHint()?.from).toEqual(STOCK);
  });

  it("returns null on a dead board", () => {
    const g = boardOf({ tableau: [[up(S, 5)], [], [], [], [], [], []] });
    expect(g.findHint()).toBeNull();
  });

  it("only ever suggests a legal move, across many random deals", () => {
    const g = new Game(1);
    for (let i = 0; i < 200; i++) {
      g.deal();
      for (let step = 0; step < 5; step++) {
        const h = g.findHint();
        if (!h) break;
        if (h.from.kind === "stock") {
          expect(g.drawFromStock(), `deal ${i} step ${step}: hinted draw failed`).not.toBeNull();
        } else {
          expect(
            g.moveCards(h.from, h.fromIndex, h.to),
            `deal ${i} step ${step}: hinted move ${JSON.stringify(h)} was illegal`,
          ).not.toBeNull();
        }
      }
    }
  });
});

describe("serialize / restore", () => {
  it("round-trips a board exactly", () => {
    const g = new Game(3);
    g.easyEmptyStacks = true;
    g.drawFromStock();
    const s = g.serialize();
    const g2 = new Game(1);
    g2.restore(s);
    expect(g2.serialize()).toEqual(s);
  });

  it("carries drawCount and easy mode", () => {
    const g = new Game(1);
    g.restore(state({ drawCount: 3, easy: true }));
    expect(g.drawCount).toBe(3);
    expect(g.easyEmptyStacks).toBe(true);
  });

  it("rebuilds real Card objects with the right suit and rank", () => {
    const g = boardOf({ tableau: [[up(D, 12)], [], [], [], [], [], []] });
    expect(g.tableau[0][0]).toMatchObject({ suit: "diamonds", rank: 12, faceUp: true });
  });
});

describe("deal determinism", () => {
  it("produces the same board for the same shuffle sequence", () => {
    const seq = Array.from({ length: 64 }, (_, i) => ((i * 7919) % 1000) / 1000);
    const run = (): string => {
      let i = 0;
      const spy = vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]);
      const g = new Game(1);
      spy.mockRestore();
      return JSON.stringify(g.serialize());
    };
    expect(run()).toBe(run());
  });
});
