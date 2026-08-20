// What a win shares: the text the Share button puts on the clipboard, and the
// `win=` payload its link carries so the page opens on the score to beat.
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

/** The three numbers a win is: everything both the shared text and the challenge
 *  screen a shared link opens are built from. */
export interface SharedResult {
  score: number;
  moves: number;
  elapsedMs: number;
}

export interface WinSummary extends SharedResult {
  /** The shareable URL for this deal — `shareUrl()`, so it carries ?deal=, ?draw= and
   *  the `win=` that makes the link open on the score to beat. */
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
  return `${title}\n${resultLine(win)}${streak}\n${win.url}`;
}

/** The result as one line. Shared with the challenge screen rather than duplicated,
 *  so the pasted text and the page the link opens can't come to disagree about what
 *  was scored. */
export function resultLine(r: SharedResult): string {
  const plural = r.moves === 1 ? "move" : "moves";
  return `Score ${r.score} · ${formatClock(r.elapsedMs)} · ${r.moves} ${plural}`;
}

// ---- The challenge link ----------------------------------------------------
//
// A shared win links back to its deal with the result attached (`?deal=…&win=…`), so
// the page it opens can show what there is to beat before dealing the board. Three
// numbers is the whole payload: the seed is already in `deal=`, and whether that board
// was a daily is derivable from the seed (`dailyDayForSeed`), so nothing is carried
// twice and no save format changes. Plain digits rather than anything packed, because
// a shared URL gets read by people as well as by the app.

const RESULT_RE = /^(\d{1,7})-(\d{1,7})-(\d{1,7})$/;
const RESULT_MAX = 9_999_999;

export function encodeResult(r: SharedResult): string {
  const n = (v: number) => Math.min(RESULT_MAX, Math.max(0, Math.round(v) || 0));
  return `${n(r.score)}-${n(r.moves)}-${n(Math.floor(r.elapsedMs / 1000))}`;
}

/** Parse a `win=` payload, which is untrusted: it arrives from a link anyone can
 *  hand-edit. Anything that isn't three plain in-range numbers is null, and the app
 *  shows its ordinary start screen rather than a nonsense score to beat. */
export function parseResult(v: string | null | undefined): SharedResult | null {
  if (typeof v !== "string") return null;
  const m = RESULT_RE.exec(v.trim());
  if (!m) return null;
  return { score: Number(m[1]), moves: Number(m[2]), elapsedMs: Number(m[3]) * 1000 };
}

export interface ChallengeBoard {
  /** The deal code, named when the board isn't a daily — the only thing that makes an
   *  ordinary deal reproducible. */
  code: string;
  drawCount: number;
  /** Which day's daily this board is (`dailyDayForSeed`), or null for an ordinary deal. */
  dailyKey?: string | null;
  todayKey?: string;
}

/** Which board the challenge is on. The draw mode is part of it: the same cards under
 *  Draw 3 are a different game, and a score is only comparable within one. */
export function boardLine(b: ChallengeBoard): string {
  const deal = b.dailyKey
    ? b.dailyKey === b.todayKey
      ? "Today's daily deal"
      : `Daily deal · ${b.dailyKey}`
    : `Deal ${b.code}`;
  return `${deal} · Draw ${b.drawCount}`;
}
