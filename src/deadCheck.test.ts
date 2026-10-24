// The dead-board warning's lifetime, against a fake solver that answers when told to.

import { describe, expect, it } from "vitest";
import { Board, DeadCheck } from "./deadCheck";
import { Game } from "./game";
import type { SolveRequest, SolveResponse } from "./solver.worker";
import { Outcome } from "./solver";

interface Pending {
  request: SolveRequest;
  answer: (outcome: Outcome) => void;
  fail: () => void;
}

function harness() {
  const pending: Pending[] = [];
  const warnings: boolean[] = [];
  let board: Board | null = { version: 1, state: new Game(1, 7).serialize(), won: false };
  const check = new DeadCheck({
    ask: (request, onAnswer, onFail) => {
      pending.push({
        request,
        answer: (outcome) => onAnswer({ outcome, nodes: 1, moves: 0 } as SolveResponse),
        fail: onFail,
      });
    },
    current: () => board,
    onWarn: (dead) => warnings.push(dead),
  });
  return {
    check,
    pending,
    warnings,
    setBoard: (over: Partial<Board> | null) => {
      board = over === null ? null : { ...board!, ...over };
    },
    /** Answer the oldest outstanding search. */
    answer: (outcome: Outcome) => pending.shift()!.answer(outcome),
  };
}

describe("DeadCheck", () => {
  it("raises the warning on a proven dead board, once", () => {
    const h = harness();
    h.check.check();
    h.answer("unwinnable");
    expect(h.warnings).toEqual([true]);
    h.setBoard({ version: 2 });
    h.check.check();
    h.answer("unwinnable");
    expect(h.warnings).toEqual([true]); // dead → dead is silent
    expect(h.check.warned).toBe(true);
  });

  it("says nothing for unknown or solved", () => {
    const h = harness();
    h.check.check();
    h.answer("unknown");
    h.setBoard({ version: 2 });
    h.check.check();
    h.answer("solved");
    expect(h.warnings).toEqual([]);
  });

  it("takes the warning down on the next verdict, not on the bump", () => {
    const h = harness();
    h.check.check();
    h.answer("unwinnable");
    h.setBoard({ version: 2 });
    h.check.check();
    expect(h.check.warned).toBe(true); // still up while the new search runs
    h.answer("solved");
    expect(h.warnings).toEqual([true, false]);
  });

  it("asks at the fast budget only", () => {
    const h = harness();
    h.check.check();
    expect(h.pending[0].request).toEqual({ state: expect.any(Object), maxNodes: 200_000 });
  });

  it("runs one search at a time, and re-asks once for changes made during it", () => {
    const h = harness();
    h.check.check();
    h.setBoard({ version: 2 });
    h.check.check();
    h.setBoard({ version: 3 });
    h.check.check();
    expect(h.pending).toHaveLength(1);
    h.answer("unwinnable"); // about version 1: stale, and triggers the one re-ask
    expect(h.warnings).toEqual([]);
    expect(h.pending).toHaveLength(1);
    h.answer("unwinnable"); // about version 3, the board on screen
    expect(h.warnings).toEqual([true]);
  });

  it("takes the warning down when a rescue changes the rules", () => {
    const h = harness();
    h.check.check();
    h.answer("unwinnable");
    h.setBoard({ version: 2, state: { ...new Game(1, 7).serialize(), easy: true } });
    h.check.check();
    expect(h.pending).toHaveLength(0); // not asked at all
    expect(h.warnings).toEqual([true, false]);
  });

  it("doesn't ask about a won board", () => {
    const h = harness();
    h.setBoard({ won: true });
    h.check.check();
    expect(h.pending).toHaveLength(0);
  });

  it("does nothing before there's a board to check", () => {
    const h = harness();
    h.setBoard(null);
    h.check.check();
    expect(h.pending).toHaveLength(0);
  });

  it("recovers from a failed search without claiming anything", () => {
    const h = harness();
    h.check.check();
    h.pending.shift()!.fail();
    expect(h.warnings).toEqual([]);
    h.check.check();
    expect(h.pending).toHaveLength(1); // free to ask again
  });
});
