// The click-to-play overlay: the DOM half. It exists because browsers block audio
// until a user gesture, so the opening deal (and its sound) waits behind a click.
// What each choice *does* to the game stays in main.ts; this only shows the right
// words and reports which button was pressed.

import { formatClock, SharedResult } from "./share";

/** What the overlay's buttons ask for: pick the restored board back up, reveal the one
 *  already dealt behind the overlay (a fresh boot, or an accepted challenge), or throw
 *  that away for a new deal. A union rather than a pair of booleans, because "reveal
 *  the board" and "deal a new one" used to be the same `else`. */
export type StartChoice = "resume" | "reveal" | "fresh";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class StartOverlay {
  private readonly overlay = byId("start-overlay");
  private readonly startBtn = byId<HTMLButtonElement>("start-btn");
  private readonly startNew = byId<HTMLButtonElement>("start-new");
  private readonly title = this.overlay.querySelector(".start-title") as HTMLElement;
  private readonly tip = this.overlay.querySelector(".start-tip") as HTMLElement;
  private resuming = false;

  constructor(onChoose: (choice: StartChoice) => void) {
    this.startBtn.addEventListener("click", () => onChoose(this.resuming ? "resume" : "reveal"));
    this.startNew.addEventListener("click", () => onChoose("fresh"));
  }

  /** Fill in the challenge card and turn the start button into the invitation.
   *  `board` describes the deal already laid out from `?deal=`, so what the card says
   *  is what pressing the button plays. */
  showChallenge(r: SharedResult, board: string): void {
    byId("challenge-score").textContent = String(r.score);
    byId("challenge-time").textContent = formatClock(r.elapsedMs);
    byId("challenge-moves").textContent = String(r.moves);
    byId("challenge-deal").textContent = board;
    byId("challenge").hidden = false;
    this.title.textContent = `Can you beat ${r.score}?`;
    this.tip.textContent =
      "The same deal, dealt the same way. Every move costs a point, so a tidy win scores higher than a long one.";
    this.startNew.hidden = false; // declining the challenge is a normal thing to want
  }

  /** Resume wins the button over a challenge when both apply — the board is already on
   *  the go, and dealing it again would bin the progress. A challenge card stays up: it
   *  is still the score to beat. */
  showResume(moves: number, score: number): void {
    this.resuming = true;
    this.title.textContent = "Resume game";
    this.tip.textContent = `Game in progress — ${moves} moves, ${score} points. Your recent moves can still be undone.`;
    this.startNew.hidden = false;
  }

  dismiss(): void {
    this.overlay.classList.add("is-hiding");
    setTimeout(() => this.overlay.remove(), 400);
  }
}
