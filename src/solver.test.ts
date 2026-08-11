// The solver. Two kinds of test here, and the second is the important one:
//
//  1. Does it get the answer right on positions whose answer we know?
//  2. Does it still agree with game.ts about what a legal move *is*? The solver has
//     its own compact board so it can backtrack past MAX_HISTORY, which means the
//     rules exist in two places. The cross-check below is what stops them drifting.

import { describe, expect, it } from "vitest";
import { Game, GameState } from "./game";
import { canAnalyse, legalMoves, Move, solve } from "./solver";

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

/** Every card of a suit from ace up to `rank`, as a finished foundation pile. */
const home = (suit: number, rank: number): number[] =>
  Array.from({ length: rank }, (_, i) => up(suit, i + 1));

describe("recognising a finished or nearly finished game", () => {
  it("solves a board that is already won", () => {
    const g = state({ foundations: [S, H, D, C].map((s) => home(s, 13)) });
    expect(solve(g).outcome).toBe("solved");
  });

  it("solves a board one move from home", () => {
    const g = state({
      foundations: [home(S, 12), home(H, 13), home(D, 13), home(C, 13)],
      tableau: [[up(S, 13)], [], [], [], [], [], []],
    });
    const r = solve(g);
    expect(r.outcome).toBe("solved");
    expect(r.moves).toEqual([{ kind: "tableauToFoundation", col: 0 }]);
  });

  it("solves a board that needs the stock", () => {
    const g = state({
      foundations: [home(S, 12), home(H, 13), home(D, 13), home(C, 13)],
      stock: [dn(S, 13)],
    });
    const r = solve(g);
    expect(r.outcome).toBe("solved");
    expect(r.moves).toEqual([{ kind: "draw" }, { kind: "wasteToFoundation" }]);
  });
});

describe("recognising a dead board", () => {
  it("calls a stuck position unwinnable", () => {
    // Two kings on the table, nothing to draw, nothing legal, nothing home.
    const g = state({ tableau: [[up(S, 13)], [up(H, 13)], [], [], [], [], []] });
    const r = solve(g);
    expect(r.outcome).toBe("unwinnable");
    expect(r.moves).toEqual([]);
  });

  it("digs a buried ace out by moving the king off it", () => {
    // A♠ is face down under K♠. Winning means shifting the king to an empty column to
    // turn the ace up, then running the rest of the suit out of the stock. The stock
    // is built descending so drawing yields 2♠ first.
    const g = state({
      foundations: [[], home(H, 13), home(D, 13), home(C, 13)],
      tableau: [[dn(S, 1), up(S, 13)], [], [], [], [], [], []],
      stock: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((r) => dn(S, r)),
    });
    const r = solve(g);
    expect(r.outcome).toBe("solved");
    expect(r.moves.some((m) => m.kind === "tableauToTableau")).toBe(true);
  });

  it("calls a board unwinnable when the cards to finish it don't exist", () => {
    // The same shape, but 2♠ through Q♠ are nowhere on the board — restore() does no
    // completeness checking, so this is a position the solver can be handed, and 52
    // cards can never come home from it.
    const g = state({
      foundations: [[], home(H, 13), home(D, 13), home(C, 13)],
      tableau: [[dn(S, 1), up(S, 13)], [], [], [], [], [], []],
    });
    expect(solve(g).outcome).toBe("unwinnable");
  });

  it("does not claim unwinnable when it merely ran out of budget", () => {
    const g = new Game(1, 116).serialize();
    const r = solve(g, { maxNodes: 50 });
    expect(r.outcome).toBe("unknown");
    expect(r.nodes).toBeLessThanOrEqual(51);
  });
});

describe("what it refuses to answer", () => {
  it("won't analyse a board with ✦ stacks, whose rules it doesn't model", () => {
    const g = state({ spares: [[]], tableau: [[up(S, 13)], [], [], [], [], [], []] });
    expect(canAnalyse(g)).toBe(false);
    expect(solve(g).outcome).toBe("unknown");
  });

  it("won't analyse a board in easy mode", () => {
    const g = state({ easy: true, tableau: [[up(S, 13)], [], [], [], [], [], []] });
    expect(canAnalyse(g)).toBe(false);
    expect(solve(g).outcome).toBe("unknown");
  });

  it("analyses an ordinary board", () => {
    expect(canAnalyse(new Game(1, 42).serialize())).toBe(true);
  });
});

describe("the winning line it returns is actually legal", () => {
  /** Replay a solver line through the real Game and see whether it wins. This is the
   *  end-to-end guard: the solver can only be trusted if game.ts agrees the moves it
   *  found are moves you could really make. */
  function replay(initial: GameState, moves: Move[]): Game {
    const g = new Game(initial.drawCount, initial.seed);
    g.restore(initial);
    for (const m of moves) {
      let ok: unknown = null;
      switch (m.kind) {
        case "draw":
        case "recycle":
          ok = g.drawFromStock();
          break;
        case "wasteToFoundation":
          ok = g.autoMoveToFoundation({ kind: "waste" });
          break;
        case "tableauToFoundation":
          ok = g.autoMoveToFoundation({ kind: "tableau", index: m.col });
          break;
        case "wasteToTableau":
          ok = g.moveCards({ kind: "waste" }, g.waste.length - 1, { kind: "tableau", index: m.col });
          break;
        case "tableauToTableau":
          ok = g.moveCards(
            { kind: "tableau", index: m.from },
            g.tableau[m.from].length - m.count,
            { kind: "tableau", index: m.to },
          );
          break;
        case "foundationToTableau": {
          const idx = g.foundations.findIndex(
            (p) => p.length > 0 && p[p.length - 1].suit === (["spades", "hearts", "diamonds", "clubs"] as const)[m.suit],
          );
          ok = g.moveCards(
            { kind: "foundation", index: idx },
            g.foundations[idx].length - 1,
            { kind: "tableau", index: m.col },
          );
          break;
        }
      }
      expect(ok, `game.ts rejected solver move ${JSON.stringify(m)}`).not.toBeNull();
    }
    return g;
  }

  it("replays a short solution through the real Game", () => {
    const initial = state({
      foundations: [home(S, 11), home(H, 13), home(D, 13), home(C, 13)],
      tableau: [[up(S, 13)], [up(S, 12)], [], [], [], [], []],
    });
    const r = solve(initial);
    expect(r.outcome).toBe("solved");
    expect(replay(initial, r.moves).isWon()).toBe(true);
  });

  it("replays solutions found from real deals", () => {
    let solved = 0;
    for (const seed of [116, 42, 7, 99, 2024, 1337]) {
      const initial = new Game(1, seed).serialize();
      const r = solve(initial, { maxNodes: 120_000 });
      expect(["solved", "unwinnable", "unknown"]).toContain(r.outcome);
      if (r.outcome === "solved") {
        solved++;
        expect(replay(initial, r.moves).isWon(), `seed ${seed}`).toBe(true);
      }
    }
    // Not asserting a particular hit rate — only that whatever it claims to solve,
    // game.ts agrees is a real win.
    expect(solved).toBeGreaterThan(0);
  });
});

describe("its move generator agrees with game.ts", () => {
  /** The cross-check that keeps the duplicated rules honest: for a position, every
   *  move the solver offers must be one `Game` accepts, and every tableau/foundation
   *  move `Game` accepts must be one the solver offered. */
  function compare(initial: GameState): void {
    const probe = new Game(initial.drawCount, initial.seed);
    probe.restore(initial);

    // What the solver thinks is legal, expressed as (from, index, to) triples.
    const solverSet = new Set<string>();
    // prune: false — compare the complete move set, since pruning deliberately
    // withholds legal-but-pointless moves that game.ts still accepts.
    for (const m of legalMoves(toSolverState(initial), { prune: false })) {
      if (m.kind === "tableauToTableau") solverSet.add(`t${m.from}:${m.count}->t${m.to}`);
      if (m.kind === "tableauToFoundation") solverSet.add(`t${m.col}->F`);
      if (m.kind === "wasteToTableau") solverSet.add(`w->t${m.col}`);
      if (m.kind === "wasteToFoundation") solverSet.add(`w->F`);
    }

    const gameSet = new Set<string>();
    for (let from = 0; from < 7; from++) {
      const col = probe.tableau[from];
      for (let i = 0; i < col.length; i++) {
        if (!col[i].faceUp || !probe.isValidRun(col.slice(i))) continue;
        for (let to = 0; to < 7; to++) {
          if (to !== from && probe.canMoveToTableau(col[i], to)) {
            gameSet.add(`t${from}:${col.length - i}->t${to}`);
          }
        }
      }
      if (col.length && probe.foundationTargetFor(col[col.length - 1]) >= 0) gameSet.add(`t${from}->F`);
    }
    if (probe.waste.length) {
      const top = probe.waste[probe.waste.length - 1];
      for (let to = 0; to < 7; to++) if (probe.canMoveToTableau(top, to)) gameSet.add(`w->t${to}`);
      if (probe.foundationTargetFor(top) >= 0) gameSet.add("w->F");
    }

    expect([...solverSet].sort()).toEqual([...gameSet].sort());
  }

  it("agrees on freshly dealt boards", () => {
    for (const seed of [1, 42, 116, 999, 31337]) compare(new Game(1, seed).serialize());
  });

  it("agrees after playing a few moves in", () => {
    for (const seed of [42, 116]) {
      const g = new Game(1, seed);
      for (let i = 0; i < 12; i++) g.drawFromStock();
      compare(g.serialize());
    }
  });

  it("prunes only whole-column shuffles between empty columns", () => {
    const board = state({
      tableau: [[up(S, 13), up(D, 12)], [], [], [], [], [], [up(H, 13)]],
    });
    const all = legalMoves(toSolverState(board), { prune: false });
    const pruned = legalMoves(toSolverState(board), { prune: true });
    const dropped = all.filter((a) => !pruned.some((p) => JSON.stringify(p) === JSON.stringify(a)));
    expect(dropped.length).toBeGreaterThan(0);
    // Everything withheld is a full column moving onto an empty one.
    for (const m of dropped) {
      expect(m.kind).toBe("tableauToTableau");
      if (m.kind !== "tableauToTableau") continue;
      expect(board.tableau[m.from]).toHaveLength(m.count);
      expect(board.tableau[m.to]).toHaveLength(0);
    }
  });

  it("agrees on a board with runs, empties and foundations in play", () => {
    compare(
      state({
        foundations: [home(S, 3), [], home(D, 1), []],
        waste: [up(H, 9)],
        stock: [dn(C, 5)],
        tableau: [
          [dn(C, 4), up(S, 10), up(H, 9)],
          [up(S, 13), up(D, 12)],
          [],
          [up(C, 2)],
          [dn(H, 3), up(D, 7)],
          [],
          [up(H, 13)],
        ],
      }),
    );
  });
});

/** The solver keeps its board private; tests need one to call legalMoves directly. */
function toSolverState(g: GameState): Parameters<typeof legalMoves>[0] {
  const suitOf = (id: number): number => Math.floor(id / 13);
  const rankOf = (id: number): number => (id % 13) + 1;
  const found = [0, 0, 0, 0];
  for (const pile of g.foundations) {
    for (const code of pile) {
      const id = code % 52;
      found[suitOf(id)] = Math.max(found[suitOf(id)], rankOf(id));
    }
  }
  return {
    found,
    down: g.tableau.map((c) => c.filter((x) => x < 52).map((x) => x % 52)),
    up: g.tableau.map((c) => c.filter((x) => x >= 52).map((x) => x % 52)),
    stock: g.stock.map((c) => c % 52),
    waste: g.waste.map((c) => c % 52),
    drawCount: g.drawCount,
  };
}
