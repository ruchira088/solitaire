// "Abandon this game?" — asked before anything throws away a game in progress. main.ts
// decides when a game is at stake; this is only the panel. Modal the way the stats
// dialog is, for the same reasons, and a sibling of `#app` for the same one line.
//
// Keep playing takes the focus, and Escape and the backdrop mean the same: the slip
// this guards against is one key or click too many, so a second one has to land safely.

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class ConfirmDialog {
  private readonly overlay = byId("confirm-overlay");
  private readonly detail = byId("confirm-detail");
  private readonly keep = byId<HTMLButtonElement>("confirm-keep");
  private readonly go = byId<HTMLButtonElement>("confirm-go");
  private readonly app = byId("app");
  private run: (() => void) | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    this.keep.addEventListener("click", () => this.close());
    this.go.addEventListener("click", () => {
      const run = this.run;
      this.close();
      run?.();
    });
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  isOpen(): boolean {
    return !this.overlay.hidden;
  }

  ask(action: string, detail: string, run: () => void): void {
    this.go.textContent = action;
    this.detail.textContent = detail;
    this.run = run;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.overlay.hidden = false;
    this.app.inert = true;
    this.keep.focus();
  }

  close(): void {
    this.overlay.hidden = true;
    this.app.inert = false; // before the focus call below — focus can't land inside inert
    this.run = null;
    this.returnFocus?.focus();
  }
}
