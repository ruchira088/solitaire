// The statistics dialog: the lifetime record, the archive of daily deals, the
// challenges you've been sent, and the Vegas switch. All DOM, so it isn't unit-tested
// — the words it shows come from statsView.ts and challenges.ts, which are — and
// `npm run smoke` checks it opens, closes, and is genuinely modal.
//
// The modality is enforced here, not merely claimed by `aria-modal="true"`: `#app` is
// made inert while it is up, which stops Tab walking out of the panel into the toolbar
// and takes the board out of the accessibility tree. `#stats-overlay` is a sibling of
// `#app` precisely so that is one line. main.ts's key handling asks `isOpen()` so no
// board shortcut fires through it either.

import { Challenge, challengeRow } from "./challenges";
import { recentDailyKeys } from "./rng";
import { statGroups } from "./statsView";
import { hasWonDaily, loadChallenges, loadStats, resetStats, Stats } from "./storage";
import { setTip } from "./tooltip";

/** How far back the archive looks — four weeks in the grid, and the same window
 *  main.ts searches when deciding whether a won board was a daily, so anything the
 *  grid can offer is recognised when won. */
export const ARCHIVE_WINDOW = 28;

export interface StatsDialogDeps {
  today: () => string;
  playDay: (key: string) => void;
  playChallenge: (c: Challenge) => void;
  /** After a reset: the 📅 button's ✓ was drawn from the record just wiped. */
  afterReset: () => void;
  vegas: {
    /** What the next deal will be played under — what the switch shows. */
    next: () => boolean;
    toggle: () => void;
  };
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class StatsDialog {
  private readonly button = byId<HTMLButtonElement>("btn-stats");
  private readonly overlay = byId("stats-overlay");
  private readonly list = byId("stats-list");
  private readonly reset = byId<HTMLButtonElement>("stats-reset");
  private readonly resetLabel = byId("stats-reset-label");
  private readonly closeBtn = byId<HTMLButtonElement>("stats-close");
  private readonly vegasBtn = byId<HTMLButtonElement>("stats-vegas");
  private readonly app = byId("app");
  private resetArmed = false;
  private resetTimer = 0;
  /** The challenges as last drawn, so a Play click can find its entry by index. */
  private shown: Challenge[] = [];

  constructor(private deps: StatsDialogDeps) {
    this.button.addEventListener("click", () => this.open());
    this.closeBtn.addEventListener("click", () => this.close());
    this.reset.addEventListener("click", () => this.armOrReset());
    this.vegasBtn.addEventListener("click", () => {
      deps.vegas.toggle();
      this.syncVegas();
    });
    this.list.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const day = target.closest<HTMLButtonElement>(".archive-day")?.dataset.day;
      const pick = target.closest<HTMLButtonElement>(".challenge-play")?.dataset.index;
      const challenge = pick === undefined ? undefined : this.shown[Number(pick)];
      if (!day && !challenge) return;
      this.close();
      if (day) deps.playDay(day);
      else if (challenge) deps.playChallenge(challenge);
    });
    // A click on the backdrop — not the panel — dismisses it, as a modal should.
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(): void {
    this.render();
    this.disarm(); // a freshly opened dialog never opens half-way through a confirmation
    this.syncVegas();
    this.overlay.hidden = false;
    this.app.inert = true;
    this.closeBtn.focus();
  }

  close(): void {
    this.overlay.hidden = true;
    this.app.inert = false; // before the focus call below — focus can't land inside inert
    this.disarm();
    this.button.focus(); // back to the button that opened it
  }

  /** Re-draw while open — a Vegas game settling changes the bank under it. */
  refresh(): void {
    if (this.isOpen()) this.render();
  }

  private syncVegas(): void {
    const on = this.deps.vegas.next();
    this.vegasBtn.setAttribute("aria-pressed", on ? "true" : "false");
    setTip(
      this.vegasBtn,
      on
        ? "Vegas rules on: $52 a deal, $5 a card home, limited passes through the stock (V)"
        : "Vegas rules: $52 a deal, $5 a card home, limited passes through the stock (V)",
    );
  }

  private render(): void {
    const today = this.deps.today();
    const stats = loadStats();
    const nodes: HTMLElement[] = [];
    for (const group of statGroups(stats, today)) {
      // A <dt> spanning both columns: still a definition list, still one grid, and the
      // heading can't drift out of step with the rows under it.
      nodes.push(heading("dt", "stats-group", group.title));
      for (const [label, value] of group.rows) {
        nodes.push(heading("dt", "", label), heading("dd", "", value));
      }
    }

    const wrap = document.createElement("dd");
    wrap.className = "archive-cell";
    wrap.appendChild(this.archive(stats, today));
    nodes.push(heading("dt", "archive-cell", "Last 4 weeks"), wrap);

    this.shown = loadChallenges();
    if (this.shown.length > 0) {
      nodes.push(heading("dt", "stats-group challenges-head", "Challenges received"));
      this.shown.forEach((c, i) => {
        const row = challengeRow(c, today);
        const dt = heading("dt", "challenge-board", row.board);
        const dd = heading("dd", "challenge-standing", row.standing);
        dd.classList.toggle("is-beaten", row.standing.endsWith("✓"));
        const play = document.createElement("button");
        play.type = "button";
        play.className = "challenge-play";
        play.dataset.index = String(i);
        play.textContent = "Play";
        play.setAttribute("aria-label", `Play ${row.board}`);
        dd.appendChild(play);
        nodes.push(dt, dd);
      });
    }
    this.list.replaceChildren(...nodes);
  }

  /** The last four weeks of daily deals, ticked where they were won and clickable to
   *  play. It lives in this dialog rather than behind a toolbar button: it *is* the
   *  daily record, and the measured wrap threshold has no room to spare. */
  private archive(s: Stats, today: string): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "archive";
    // Oldest first, so it reads like a calendar rather than backwards.
    for (const key of recentDailyKeys(today, ARCHIVE_WINDOW).reverse()) {
      const won = hasWonDaily(s, key);
      const isToday = key === today;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "archive-day";
      cell.classList.toggle("is-won", won);
      cell.classList.toggle("is-today", isToday);
      cell.dataset.day = key;
      cell.textContent = String(Number(key.slice(8, 10)));
      const state = won ? "won" : "not won";
      setTip(cell, `${key} — ${state}. Click to play this deal.`);
      cell.setAttribute("aria-label", `${key}, ${state}${isToday ? ", today" : ""}`);
      grid.appendChild(cell);
    }
    return grid;
  }

  /** Wiping the record is destructive and unundoable, so the button asks first and
   *  forgets the question after a few seconds. */
  private armOrReset(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.reset.classList.add("is-confirming");
      this.resetLabel.textContent = "Confirm reset";
      this.resetTimer = window.setTimeout(() => this.disarm(), 4000);
      return;
    }
    this.disarm();
    resetStats();
    this.render();
    this.deps.afterReset();
  }

  private disarm(): void {
    window.clearTimeout(this.resetTimer);
    this.resetArmed = false;
    this.reset.classList.remove("is-confirming");
    this.resetLabel.textContent = "Reset stats";
  }
}

function heading(tag: "dt" | "dd", className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}
