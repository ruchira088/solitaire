// Runs the solver off the main thread. A search takes ~100ms on a typical deal and
// several hundred on a stubborn one — long enough to drop frames and freeze a drag if
// it ran inline, which is the whole reason this file exists.

import { solve, SolveResult } from "./solver";
import { GameState } from "./game";

export interface SolveRequest {
  state: GameState;
  maxNodes?: number;
}

self.addEventListener("message", (e: MessageEvent<SolveRequest>) => {
  const result: SolveResult = solve(e.data.state, { maxNodes: e.data.maxNodes });
  // The winning line can be long and nothing on the other side reads it yet; sending
  // only the verdict keeps the postMessage copy small.
  self.postMessage({ outcome: result.outcome, nodes: result.nodes, moves: result.moves.length });
});
