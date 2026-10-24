// Playing a winning line out on the board, one move at a time — the "show me how"
// answer to a dead board. The line itself comes from the solver (`toGameLine`); this
// is only the pacing: wait for the cards to settle, make the next move, pause, repeat.
//
// Each move goes through the same path a player's would (main.ts supplies `step`), so
// the replay looks and sounds like play rather than cards teleporting. Waiting on
// `settled` rather than a fixed delay is what keeps it honest: a move is never made
// under a flight that is still landing, whatever the animation settings.

import type { GameMove } from "./solver";

export interface ReplayDeps {
  /** Make one move. False means the board refused it, and the replay stops. */
  step: (move: GameMove) => boolean;
  /** No cards in flight and nothing else moving them. */
  settled: () => boolean;
  /** The line ran out (`finished`) or a move was refused. Not called on `stop()`. */
  onEnd: (finished: boolean) => void;
}

/** The pause between one move landing and the next starting: quick enough that a
 *  500-move line is a couple of minutes rather than ten, slow enough to follow. */
export const REPLAY_PAUSE_MS = 110;
/** How often to look again while the cards are still moving. */
const SETTLE_POLL_MS = 40;

export class Replay {
  private run = 0;
  private timer = 0;
  active = false;

  constructor(private deps: ReplayDeps) {}

  start(line: GameMove[]): void {
    this.stop();
    this.active = true;
    const run = this.run;
    let next = 0;
    const tick = (): void => {
      if (run !== this.run) return; // stopped, or a newer replay took over
      if (!this.deps.settled()) {
        this.timer = window.setTimeout(tick, SETTLE_POLL_MS);
        return;
      }
      if (next >= line.length) {
        this.active = false;
        this.deps.onEnd(true);
        return;
      }
      if (!this.deps.step(line[next++])) {
        this.active = false;
        this.deps.onEnd(false);
        return;
      }
      this.timer = window.setTimeout(tick, REPLAY_PAUSE_MS);
    };
    this.timer = window.setTimeout(tick, REPLAY_PAUSE_MS);
  }

  /** Abandon the line where it stands. Silent: whoever stops it already knows why. */
  stop(): void {
    this.run++;
    this.active = false;
    window.clearTimeout(this.timer);
  }
}
