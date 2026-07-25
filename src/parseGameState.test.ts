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
