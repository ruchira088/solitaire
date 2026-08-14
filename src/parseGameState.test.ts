// parseGameState guards the one place untrusted data enters the game: a saved board
// from localStorage, which may be corrupt, hand-edited, or written by an older
// build. A false *accept* puts the game into a structurally impossible state, so
// every rejection branch is covered here.
//
// Each rejection test mutates exactly one field of a known-good state, so a failure
// points at one branch rather than at "the fixture is wrong".

import { describe, expect, it } from "vitest";
import { Game, GameState, MAX_SPARES, parseGameState } from "./game";

/** A structurally valid state: a real deal, round-tripped through JSON. */
function valid(): GameState {
  return JSON.parse(JSON.stringify(new Game(3).serialize())) as GameState;
}

/** A valid pre-deal board — every card face down in the stock. Used wherever a test
 *  needs a *specific* card, since a real deal scatters 28 of them into the tableau. */
function blank(): GameState {
  return {
    seed: 12345,
    drawCount: 3,
    easy: false,
    moves: 0,
    score: 0,
    stock: Array.from({ length: 52 }, (_, i) => i),
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    spares: [],
  };
}

const UP = 52; // a card code is its id, plus 52 when face up

/** Pull a specific card id out of the stock so it can be placed elsewhere. */
function take(s: GameState, id: number): number {
  const i = s.stock.indexOf(id);
  if (i < 0) throw new Error(`id ${id} not in stock`);
  s.stock.splice(i, 1);
  return id;
}

describe("parseGameState — accepts", () => {
  it("a freshly dealt board round-tripped through JSON", () => {
    expect(parseGameState(valid())).not.toBeNull();
  });

  it("every draw count the game supports", () => {
    for (const n of [1, 3]) {
      const s = valid();
      s.drawCount = n as 1 | 3;
      expect(parseGameState(s), `drawCount ${n}`).not.toBeNull();
    }
  });

  it("a mid-game board with a foundation, waste and spares", () => {
    const s = blank();
    s.foundations[0] = [take(s, 0) + UP]; // ace of spades
    s.waste = [take(s, 40) + UP];
    s.spares = [[], [take(s, 41) + UP]];
    s.moves = 17;
    s.score = 85;
    expect(parseGameState(s)).not.toBeNull();
  });

  it("a complete 13-card foundation", () => {
    const s = blank();
    s.foundations[0] = Array.from({ length: 13 }, (_, r) => take(s, r) + UP);
    expect(parseGameState(s)).not.toBeNull();
  });

  it("a tableau column that is entirely face down", () => {
    const s = valid();
    s.tableau[0] = s.tableau[0].map((c) => (c >= UP ? c - UP : c));
    expect(parseGameState(s)).not.toBeNull();
  });

  it("the maximum number of spare piles", () => {
    const s = valid();
    s.spares = Array.from({ length: MAX_SPARES }, () => []);
    expect(parseGameState(s)).not.toBeNull();
  });

  it("and returns a value that round-trips back into a Game", () => {
    const s = valid();
    s.moves = 9;
    s.score = 40;
    const parsed = parseGameState(s)!;
    const g = new Game(1);
    g.restore(parsed);
    expect(g.serialize()).toEqual(s);
  });
});

describe("parseGameState — rejects non-objects", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "hello"],
    ["a number", 42],
    ["a boolean", true],
  ])("%s", (_label, input) => {
    expect(parseGameState(input)).toBeNull();
  });

  it("an array", () => {
    expect(parseGameState([1, 2, 3])).toBeNull();
  });

  it("an empty object", () => {
    expect(parseGameState({})).toBeNull();
  });
});

describe("parseGameState — rejects bad scalars", () => {
  it.each([0, 2, 4, -1, "3", null, undefined, 1.5])("drawCount %p", (v) => {
    const s = valid() as unknown as Record<string, unknown>;
    s.drawCount = v;
    expect(parseGameState(s)).toBeNull();
  });

  it.each([-1, 1.5, NaN, Infinity, "3", null])("moves %p", (v) => {
    const s = valid() as unknown as Record<string, unknown>;
    s.moves = v;
    expect(parseGameState(s)).toBeNull();
  });

  it.each([-1, 2.5, NaN, "0", null])("score %p", (v) => {
    const s = valid() as unknown as Record<string, unknown>;
    s.score = v;
    expect(parseGameState(s)).toBeNull();
  });

  it.each(["true", 1, 0, null, undefined])("easy %p", (v) => {
    const s = valid() as unknown as Record<string, unknown>;
    s.easy = v;
    expect(parseGameState(s)).toBeNull();
  });
});

describe("parseGameState — rejects bad pile shapes", () => {
  it("fewer than 4 foundations", () => {
    const s = valid();
    s.foundations = [[], [], []];
    expect(parseGameState(s)).toBeNull();
  });

  it("more than 4 foundations", () => {
    const s = valid();
    s.foundations = [[], [], [], [], []];
    expect(parseGameState(s)).toBeNull();
  });

  it("fewer than 7 tableau columns", () => {
    const s = valid();
    s.tableau.pop();
    expect(parseGameState(s)).toBeNull();
  });

  it("more than 7 tableau columns", () => {
    const s = valid();
    s.tableau.push([]);
    expect(parseGameState(s)).toBeNull();
  });

  it(`more than ${MAX_SPARES} spare piles`, () => {
    const s = valid();
    s.spares = Array.from({ length: MAX_SPARES + 1 }, () => []);
    expect(parseGameState(s)).toBeNull();
  });

  it.each([
    ["a string", "nope"],
    ["null", null],
    ["a number", 7],
  ])("a pile that is %s", (_label, v) => {
    const s = valid() as unknown as Record<string, unknown>;
    s.stock = v;
    expect(parseGameState(s)).toBeNull();
  });
});

describe("parseGameState — rejects bad card codes", () => {
  it.each([-1, 104, 200, 1.5, NaN, "12", null])("a code of %p", (v) => {
    const s = valid();
    (s.stock as unknown[])[0] = v;
    expect(parseGameState(s)).toBeNull();
  });

  it("a duplicated card (52 codes, 51 distinct ids)", () => {
    const s = valid();
    s.stock[0] = s.stock[1];
    expect(parseGameState(s)).toBeNull();
  });

  it("a missing card (51 codes total)", () => {
    const s = valid();
    s.stock.pop();
    expect(parseGameState(s)).toBeNull();
  });

  it("an extra card (53 codes total)", () => {
    const s = valid();
    s.stock.push(s.stock[0]);
    expect(parseGameState(s)).toBeNull();
  });

  it("a card duplicated across two different piles", () => {
    const s = valid();
    s.waste = [s.tableau[6][0] >= UP ? s.tableau[6][0] : s.tableau[6][0] + UP];
    s.stock.pop(); // keep the total at 52 so only the duplicate is at fault
    expect(parseGameState(s)).toBeNull();
  });
});

describe("parseGameState — rejects impossible face states", () => {
  it("a face-up card in the stock", () => {
    const s = valid();
    s.stock[0] += UP;
    expect(parseGameState(s)).toBeNull();
  });

  it("a face-down card in the waste", () => {
    const s = blank();
    s.waste = [take(s, 20)]; // no +UP
    expect(parseGameState(s)).toBeNull();
  });

  it("a face-down card in a foundation", () => {
    const s = blank();
    s.foundations[0] = [take(s, 0)]; // ace of spades, face down
    expect(parseGameState(s)).toBeNull();
  });

  it("a face-down card in a spare pile", () => {
    const s = blank();
    s.spares = [[take(s, 30)]];
    expect(parseGameState(s)).toBeNull();
  });

  it("a face-down card resting on a face-up one in a tableau column", () => {
    const s = valid();
    // A dealt column is face-down cards then one face-up; reversing is impossible.
    s.tableau[3].reverse();
    expect(parseGameState(s)).toBeNull();
  });
});

describe("parseGameState — rejects impossible foundations", () => {
  it("one not starting from the Ace", () => {
    const s = blank();
    s.foundations[0] = [take(s, 1) + UP]; // 2 of spades
    expect(parseGameState(s)).toBeNull();
  });

  it("one that skips a rank", () => {
    const s = blank();
    s.foundations[0] = [take(s, 0) + UP, take(s, 2) + UP]; // A, 3
    expect(parseGameState(s)).toBeNull();
  });

  it("one that mixes two suits", () => {
    const s = blank();
    s.foundations[0] = [take(s, 0) + UP, take(s, 14) + UP]; // A of spades, 2 of hearts
    expect(parseGameState(s)).toBeNull();
  });

  it("one built in descending order", () => {
    const s = blank();
    s.foundations[0] = [take(s, 1) + UP, take(s, 0) + UP]; // 2 then A
    expect(parseGameState(s)).toBeNull();
  });
});

// The undo history is a list of whole boards that the game adopts wholesale when Undo
// is pressed, so it is untrusted input exactly as the live board is — and letting a
// broken snapshot through would only move the corruption one keystroke away.
describe("parseGameState — the undo history", () => {
  /** A state with a real history: three draws and an undo, so `history[1]` is a board
   *  with cards in the waste and `future[0]` is the position the undo stepped back
   *  from. `history[0]` is the pre-first-draw board and its waste is empty, which is
   *  exactly the sort of thing a rejection test must not be pointed at. */
  function withHistory(): GameState {
    const g = new Game(1, 7);
    g.drawFromStock();
    g.drawFromStock();
    g.drawFromStock();
    g.undo();
    return JSON.parse(JSON.stringify(g.serialize())) as GameState;
  }

  it("accepts a save carrying history and future", () => {
    const s = withHistory();
    expect(s.history?.length).toBe(2);
    expect(s.future?.length).toBe(1);
    const parsed = parseGameState(s);
    expect(parsed?.history?.length).toBe(2);
    expect(parsed?.future?.length).toBe(1);
  });

  it("accepts a save from before the history existed", () => {
    const s = valid();
    delete s.history;
    delete s.future;
    expect(parseGameState(s)?.history).toEqual([]);
  });

  it("rejects a snapshot missing a card", () => {
    const s = withHistory();
    s.history![0].stock.pop();
    expect(parseGameState(s)).toBeNull();
  });

  it("rejects a snapshot with a face-down card in the waste", () => {
    const s = withHistory();
    expect(s.history![1].waste.length).toBeGreaterThan(0);
    s.history![1].waste = s.history![1].waste.map((c) => c % UP);
    expect(parseGameState(s)).toBeNull();
  });

  it("rejects a snapshot whose counters aren't counts", () => {
    const s = withHistory();
    s.history![0].moves = -1;
    expect(parseGameState(s)).toBeNull();
  });

  it("rejects a history that isn't a list", () => {
    const s = withHistory();
    (s as unknown as Record<string, unknown>).history = { 0: s.history![0] };
    expect(parseGameState(s)).toBeNull();
  });

  it("rejects a history longer than the game will ever hold", () => {
    const s = withHistory();
    s.history = Array.from({ length: 201 }, () => structuredClone(s.history![0]));
    expect(parseGameState(s)).toBeNull();
  });

  it("checks the future as well as the history", () => {
    const s = withHistory();
    s.future![0].tableau[0] = [];
    expect(parseGameState(s)).toBeNull();
  });
});

// Round-tripping is what the feature actually promises: close the tab mid-game, come
// back, and the last few moves are still there to take back.
describe("undo survives a save and reload", () => {
  it("restores a history that can still be undone", () => {
    const g = new Game(1, 11);
    g.drawFromStock();
    g.drawFromStock();
    const movesBefore = g.moves;

    const revived = new Game(1, 11);
    revived.restore(parseGameState(JSON.parse(JSON.stringify(g.serialize())))!);
    expect(revived.canUndo()).toBe(true);
    expect(revived.undo()).toBe(true);
    expect(revived.moves).toBe(movesBefore - 1);
    expect(revived.waste.length).toBe(1);
  });

  it("restores a redo that was pending when the tab closed", () => {
    const g = new Game(1, 11);
    g.drawFromStock();
    g.undo();

    const revived = new Game(1, 11);
    revived.restore(parseGameState(JSON.parse(JSON.stringify(g.serialize())))!);
    expect(revived.canRedo()).toBe(true);
    expect(revived.redo()).toBe(true);
    expect(revived.waste.length).toBe(1);
  });

  it("keeps only the most recent entries, and the newest ones at that", () => {
    const g = new Game(1, 11);
    for (let i = 0; i < 60; i++) g.drawFromStock();
    const s = g.serialize();
    expect(s.history!.length).toBe(40);

    const revived = new Game(1, 11);
    revived.restore(parseGameState(JSON.parse(JSON.stringify(s)))!);
    // The tail is what undo reaches for: the first undo must land on the position one
    // move back, not on one from forty moves ago.
    revived.undo();
    expect(revived.waste.length).toBe(g.waste.length - 1);
  });
});
