// The win dialog. DOM, not canvas, so New Game and Restart are real buttons —
// focusable, keyboard-reachable, styled by the same `.btn` rules as the toolbar.
//
// It is deliberately *not* modal: no backdrop, and the wrapper is
// `pointer-events: none`, because the cascade behind it is the reward and the toolbar
// stays usable. main.ts decides what the panel says (`WinView`); this only puts it on
// screen and runs the Share button.

import { fmtDollars } from "./statsView";

export interface WinView {
  /** The solver played this one (the replay): no score of yours, nothing to share. */
  demo: boolean;
  score: number;
  /** Beat the best score; shown as its own line and colour. */
  record: boolean;
  best: number;
  /** The daily run as it now stands, or 0 when this wasn't today's deal. */
  dailyStreak: number;
  /** This game's Vegas result and the bank after it, when played under Vegas. */
  vegas: { game: number; bank: number } | null;
  /** What Share copies — built once, since the clock stopped with the win. */
  shareText: string;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class WinPanel {
  private readonly overlay = byId("win-overlay");
  private readonly title = byId("win-title");
  private readonly scoreLine = byId("win-score");
  private readonly daily = byId("win-daily");
  private readonly vegas = byId("win-vegas");
  private readonly share = byId<HTMLButtonElement>("win-share");
  private readonly shareLabel = byId("win-share-label");
  private readonly newBtn = byId<HTMLButtonElement>("win-new");
  private shareTimer = 0;
  private text = "";

  constructor(actions: { newGame: () => void; restart: () => void }) {
    this.newBtn.addEventListener("click", actions.newGame);
    byId("win-restart").addEventListener("click", actions.restart);
    this.share.addEventListener("click", () => void this.copy());
  }

  isOpen(): boolean {
    return !this.overlay.hidden;
  }

  show(v: WinView): void {
    this.text = v.shareText;
    this.title.textContent = v.demo ? "That's one way to win it" : "You Win! 🎉";
    this.scoreLine.textContent = v.demo
      ? "🤖 Played by the solver — Restart to try it yourself."
      : v.record
        ? `🏆 New best score — ${v.score}`
        : `Score ${v.score}  ·  Best ${v.best}`;
    this.scoreLine.classList.toggle("is-record", v.record && !v.demo);
    this.daily.hidden = v.dailyStreak === 0;
    this.daily.textContent = `📅 Daily deal · ${v.dailyStreak}-day streak`;
    this.vegas.hidden = !v.vegas;
    if (v.vegas) {
      this.vegas.textContent = `💵 Vegas ${fmtDollars(v.vegas.game)} · bank ${fmtDollars(v.vegas.bank)}`;
    }
    this.share.hidden = v.demo; // there is no result of yours to share
    this.resetShareLabel();
    this.overlay.hidden = false;
    this.newBtn.focus(); // so Enter/Space plays again without reaching for the mouse
  }

  hide(): void {
    this.overlay.hidden = true;
    this.resetShareLabel();
  }

  /** The label is the only feedback there is, so a failure has to say so rather than
   *  silently reading as success — clipboard writes are refused outside a secure
   *  context and can be denied by permission policy. */
  private async copy(): Promise<void> {
    window.clearTimeout(this.shareTimer);
    let ok = false;
    try {
      await navigator.clipboard.writeText(this.text);
      ok = true;
    } catch {
      ok = false;
    }
    this.shareLabel.textContent = ok ? "Copied!" : "Press ⌘C";
    this.share.classList.toggle("is-copied", ok);
    if (!ok) this.selectFallbackText();
    this.shareTimer = window.setTimeout(() => this.resetShareLabel(), 2400);
  }

  /** When the clipboard API is unavailable, put the text somewhere the player can copy
   *  it by hand instead of leaving them with a button that does nothing. */
  private selectFallbackText(): void {
    const area = document.createElement("textarea");
    area.value = this.text;
    area.setAttribute("aria-label", "Your result — copy this");
    area.className = "share-fallback";
    this.share.parentElement?.appendChild(area);
    area.focus();
    area.select();
    window.setTimeout(() => area.remove(), 8000);
  }

  private resetShareLabel(): void {
    window.clearTimeout(this.shareTimer);
    this.shareLabel.textContent = "Share";
    this.share.classList.remove("is-copied");
    this.overlay.querySelector(".share-fallback")?.remove();
  }
}
