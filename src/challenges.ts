// Challenges you've been sent: every `?win=` link opened is kept, so the scores your
// friends set on a board stay listed after the start screen is gone, along with
// whether you've since beaten them. A leaderboard with no server — the links are the
// transport, and this is only the memory of what arrived.
//
// Pure: the list goes in and a new list comes out. storage.ts keeps it, main.ts and
// the stats dialog draw it.

import { DrawCount } from "./game";
import { dailyDayForSeed, encodeSeed, isDailyKey } from "./rng";
import { boardLine, SharedResult } from "./share";

export interface Challenge extends SharedResult {
  seed: number;
  drawCount: DrawCount;
  vegas: boolean;
  /** The local date it arrived (YYYY-MM-DD). */
  received: string;
  /** Your best score on this board since it arrived; 0 for not won yet — the same
   *  reading of 0 as the lifetime bests. */
  best: number;
}

/** The list is for "what have I been sent lately", not an archive, and lives in a
 *  5 MB store — the newest twenty is plenty. */
export const CHALLENGES_KEPT = 20;

export type Board = Pick<Challenge, "seed" | "drawCount" | "vegas">;

/** Two challenges on the same board are comparable: a score only means something
 *  within one deal, one draw count and one rule set. */
export function sameBoard(a: Board, b: Board): boolean {
  return a.seed === b.seed && a.drawCount === b.drawCount && a.vegas === b.vegas;
}

function sameResult(a: Challenge, b: Omit<Challenge, "best">): boolean {
  return (
    sameBoard(a, b) && a.score === b.score && a.moves === b.moves && a.elapsedMs === b.elapsedMs
  );
}

/** File a challenge that just arrived. Opening the same link twice — a reload, or the
 *  same message tapped again — moves it to the top rather than listing it twice, and
 *  keeps what you'd already scored against it. A *new* result on a board you've
 *  already beaten something on starts from that best, since it's the same board. */
export function receiveChallenge(list: Challenge[], c: Omit<Challenge, "best">): Challenge[] {
  const existing = list.find((x) => sameResult(x, c));
  const priorBest = Math.max(0, ...list.filter((x) => sameBoard(x, c)).map((x) => x.best));
  const entry: Challenge = { ...c, best: existing?.best ?? priorBest };
  return [entry, ...list.filter((x) => x !== existing)].slice(0, CHALLENGES_KEPT);
}

/** A win on some board: every challenge on it remembers the best you've managed. */
export function recordBoardWin(list: Challenge[], board: Board, score: number): Challenge[] {
  return list.map((c) => (sameBoard(c, board) ? { ...c, best: Math.max(c.best, score) } : c));
}

/** Strictly greater, as with a record: matching a score isn't beating it. */
export function isBeaten(c: Challenge): boolean {
  return c.best > c.score;
}

const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;

/** The stored list, which is untrusted like any other read from storage. A bad entry
 *  is dropped on its own — unlike undo history, nothing walks this list in order, so
 *  a gap costs nothing. */
export function parseChallenges(data: unknown): Challenge[] {
  if (!Array.isArray(data)) return [];
  const out: Challenge[] = [];
  for (const v of data) {
    if (typeof v !== "object" || v === null) continue;
    const d = v as Record<string, unknown>;
    const seed = count(d.seed, 0xffffffff);
    const score = count(d.score);
    const moves = count(d.moves);
    const elapsedMs = count(d.elapsedMs);
    const best = count(d.best);
    const drawCount = d.drawCount === 1 || d.drawCount === 3 ? d.drawCount : null;
    if (seed === null || score === null || moves === null || elapsedMs === null) continue;
    if (best === null || drawCount === null || typeof d.vegas !== "boolean") continue;
    if (!isDailyKey(d.received)) continue;
    out.push({ seed, drawCount, vegas: d.vegas, score, moves, elapsedMs, received: d.received, best });
    if (out.length === CHALLENGES_KEPT) break;
  }
  return out;
}

/** How the dialog lists one: which board, and where you stand against it. */
export function challengeRow(c: Challenge, today: string): { board: string; standing: string } {
  const board = boardLine({
    code: encodeSeed(c.seed),
    drawCount: c.drawCount,
    dailyKey: dailyDayForSeed(c.seed, today),
    todayKey: today,
    vegas: c.vegas,
  });
  const standing = isBeaten(c)
    ? `${c.score} to beat · beaten with ${c.best} ✓`
    : c.best > 0
      ? `${c.score} to beat · your best ${c.best}`
      : `${c.score} to beat`;
  return { board, standing };
}
