// The text the Share button puts on the clipboard after a win.
//
// Pure and DOM-free so it can be tested: everything it needs is passed in. The shape
// is deliberately three short lines — a title, the result, the link — because that is
// what survives being pasted into a chat window, and the link is the part that has to
// still be there when it does.

/** m:ss, the same clock the toolbar shows. Lives here rather than in main.ts so the
 *  shared text and the on-screen timer can't drift into disagreeing. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface WinSummary {
  score: number;
  moves: number;
  elapsedMs: number;
  /** The shareable URL for this deal — `shareUrl()`, so it carries ?deal= and ?draw=. */
  url: string;
  /** Present when the game won was that day's daily deal. */
  daily?: { key: string; streak: number };
  /** The deal code, shown when this wasn't the daily so the line still names a board. */
  code: string;
}

/** A daily win leads with the date and carries the streak, since that is the part
 *  worth comparing with someone else who played the same board. Any other win names
 *  its deal code instead, which is the only thing that makes it reproducible. */
export function shareText(win: WinSummary): string {
  const title = win.daily ? `Solitaire · Daily ${win.daily.key}` : `Solitaire · Deal ${win.code}`;
  const streak = win.daily && win.daily.streak > 0 ? `  🔥${win.daily.streak}` : "";
  const plural = win.moves === 1 ? "move" : "moves";
  const result = `Score ${win.score} · ${formatClock(win.elapsedMs)} · ${win.moves} ${plural}${streak}`;
  return `${title}\n${result}\n${win.url}`;
}
