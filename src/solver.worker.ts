// Runs the solver off the main thread. A search takes ~70ms on a typical deal and
// several hundred on a stubborn one — long enough to drop frames and freeze a drag if
// it ran inline, which is the whole reason this file exists.

import { GameMove, solve, SolveResult, toGameLine, toGameMove } from "./solver";
import { GameState } from "./game";
import { Outcome } from "./solver";

export interface SolveRequest {
  state: GameState;
  maxNodes?: number;
  /** Search again at this budget when the first pass can't tell. Only the positions
   *  that would otherwise answer "I don't know" pay for it, which is what makes it
   *  affordable: measured over 40 draw-1 deals, escalating 200k → 2M turns 3 of the 11
   *  shrugs into real answers, and the 29 boards that answer quickly are untouched. */
  escalateNodes?: number;
  /** Ask for the first move of the winning line, translated into board terms. The rest
   *  of the line is deliberately left behind — see below. */
  wantMove?: boolean;
  /** Ask for the whole winning line — the replay, which actually plays it out. Only
   *  that asks, so a hint still pays for one move. */
  wantLine?: boolean;
}

export interface SolveResponse {
  outcome: Outcome;
  nodes: number;
  /** How long the winning line is, when there is one. */
  moves: number;
  /** The first move of that line, when `wantMove` asked for it and there is one. */
  next?: GameMove | null;
  /** The whole line, when `wantLine` asked for it and there is one. */
  line?: GameMove[] | null;
}

self.addEventListener("message", (e: MessageEvent<SolveRequest>) => {
  const { state, maxNodes, escalateNodes, wantMove, wantLine } = e.data;
  let result: SolveResult = solve(state, { maxNodes });
  if (result.outcome === "unknown" && escalateNodes && escalateNodes > (maxNodes ?? 0)) {
    result = solve(state, { maxNodes: escalateNodes });
  }
  // A hint gets only the *first* move: copying a few hundred moves through
  // postMessage for something nothing reads is pure cost. The replay is the one asker
  // that reads the rest, and it says so with `wantLine`.
  const next =
    wantMove && result.moves.length > 0 ? toGameMove(state, result.moves[0]) : undefined;
  const line =
    wantLine && result.outcome === "solved" ? toGameLine(state, result.moves) : undefined;
  const response: SolveResponse = {
    outcome: result.outcome,
    nodes: result.nodes,
    moves: result.moves.length,
    ...(next === undefined ? {} : { next }),
    ...(line === undefined ? {} : { line }),
  };
  self.postMessage(response);
});
