// The dead-board warning's bookkeeping: when to ask, which answers to believe, and
// when the warning goes up or comes down. Split out of main.ts so those rules — which
// were only ever checked by the smoke test — can be tested against a fake solver.
//
// The worker itself stays in main.ts, behind `ask`: this module never sees a Worker,
// only a function that takes a request and eventually calls back.
//
// The rules, each of which has been got wrong at least once:
//   - Only a *proven* `unwinnable` raises the warning. `unknown` is a shrug, and
//     `solved` is the normal case.
//   - One search at a time. A change that lands mid-search queues one more ask rather
//     than a pile of them, and the answer in flight is thrown away if the board it was
//     about has gone — otherwise a verdict lands on a position the player has left.
//   - Dead → dead is silent, and a bump doesn't take the warning down: only the next
//     verdict does, so it can't flicker between moves.
//   - A check that is *skipped* — a won board, or rules the solver doesn't model —
//     takes the warning down. Easy mode and a ✦ stack are two of the rescues the
//     message offers; taking one retires a claim made under the old rules.

import { GameState } from "./game";
import { canAnalyse } from "./solver";
import type { SolveRequest, SolveResponse } from "./solver.worker";

/** The fast pass only, no escalation: this runs unasked after every change. Dead
 *  boards are the cheap case — nowhere to go means a tiny reachable space — so the
 *  budget that matters is the one that answers those, and 💡 escalates on demand. */
export const DEAD_CHECK_NODES = 200_000;

export type Ask = (
  request: SolveRequest,
  onAnswer: (r: SolveResponse) => void,
  onFail: () => void,
) => void;

export interface Board {
  /** Moves on every change; an answer about an older version is stale. */
  version: number;
  state: GameState;
  won: boolean;
}

export interface DeadCheckDeps {
  ask: Ask;
  /** The board as it is now, or null while there is nothing to check (before the
   *  start overlay is dismissed). */
  current: () => Board | null;
  /** The warning went up (true) or came down (false). Only called on a change. */
  onWarn: (dead: boolean) => void;
}

export class DeadCheck {
  /** Whether the warning is currently up. */
  warned = false;
  private checking = false;
  /** A change landed mid-search; the answer in flight is about an older board. */
  private recheck = false;

  constructor(private deps: DeadCheckDeps) {}

  check(): void {
    const board = this.deps.current();
    if (!board) return;
    if (board.won || !canAnalyse(board.state)) {
      this.set(false);
      return;
    }
    if (this.checking) {
      this.recheck = true;
      return;
    }
    this.checking = true;
    const askedAbout = board.version;
    this.deps.ask(
      { state: board.state, maxNodes: DEAD_CHECK_NODES },
      (r) => {
        this.checking = false;
        if (this.recheck) {
          this.recheck = false;
          this.check();
        }
        if (this.deps.current()?.version !== askedAbout) return;
        this.set(r.outcome === "unwinnable");
      },
      () => {
        // Quietly: a check that can't run is not a verdict, and nothing was promised.
        this.checking = false;
        this.recheck = false;
      },
    );
  }

  private set(dead: boolean): void {
    if (dead === this.warned) return;
    this.warned = dead;
    this.deps.onWarn(dead);
  }
}
