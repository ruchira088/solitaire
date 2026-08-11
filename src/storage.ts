// localStorage access: the UI preferences and the in-progress game. Every call is
// best-effort — storage can be absent (private browsing) or full, in which case the
// game simply runs without persistence.

import { GameState, parseGameState } from "./game";
import { isDailyKey } from "./rng";

const GAME_KEY = "solitaire-game";
const STATS_KEY = "solitaire-stats";
/** Pre-dates `solitaire-stats`, which absorbed it; read once to keep an old record. */
const BEST_KEY = "solitaire-best";

/** Bumped whenever the meaning of `GameState` changes; older saves are discarded
 *  rather than migrated. */
const SCHEMA = 2;

export interface SavedGame {
  state: GameState;
  /** Accumulated play time in ms — the clock is frozen while the tab is away. */
  elapsed: number;
}

let writable = true; // latched off after the first failed write

export function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string): void {
  if (!writable) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    writable = false; // storage unavailable or full: stop paying for the throw
  }
}

export function saveGame(state: GameState, elapsed: number): void {
  writeItem(GAME_KEY, JSON.stringify({ v: SCHEMA, elapsed: Math.round(elapsed), state }));
}

/** Read the saved game, or null if there isn't a usable one. Anything unreadable —
 *  corrupt, hand-edited, or written by a build with a different schema — is dropped
 *  so it can't be re-parsed on every load. */
export function loadGame(): SavedGame | null {
  const raw = readItem(GAME_KEY);
  if (raw === null) return null;
  const saved = decode(raw);
  if (!saved) clearGame();
  return saved;
}

function decode(raw: string): SavedGame | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { v, elapsed, state } = data as Record<string, unknown>;
  if (v !== SCHEMA) return null;
  const parsed = parseGameState(state);
  if (!parsed) return null;
  const ms = typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
  return { state: parsed, elapsed: ms };
}

export function clearGame(): void {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

// ---- Lifetime statistics ---------------------------------------------------

/** Counters kept across games. Zero means "never happened" for the bests, so the UI
 *  can show a dash rather than a misleading 0:00 or 0 moves. */
export interface Stats {
  played: number;
  won: number;
  /** Wins in a row, and the best run of them. */
  streak: number;
  bestStreak: number;
  bestScore: number;
  fastestMs: number;
  fewestMoves: number;
  /** Time spent on finished games — won or given up on. */
  totalMs: number;
  /** A game is under way and unwon. Persisted so that closing the tab mid-game and
   *  starting a fresh one later still breaks the streak. */
  pending: boolean;
  /** Daily deals won, and the run of consecutive days. `lastDailyWin` is the
   *  YYYY-MM-DD of the most recent one, `""` for never — it's what makes the streak
   *  answerable, since the stored count alone can't say whether the run is still
   *  live. Read it through `currentDailyStreak`, never directly. */
  dailyWins: number;
  dailyStreak: number;
  bestDailyStreak: number;
  lastDailyWin: string;
  /** Which days have been won, newest first — what the archive ticks. Capped at
   *  `WON_DAYS_KEPT`, because the archive only ever shows a recent window and an
   *  uncapped list would grow forever in a 5 MB store. `dailyWins` is the real total
   *  and is not capped, so trimming this can't cost you a counter. */
  dailyWonDays: string[];
}

/** A bit over a year of history — comfortably more than the archive shows. */
const WON_DAYS_KEPT = 400;

/** Bumped only when an existing field changes *meaning* — a mismatch wipes the
 *  lifetime record, which is a real loss, so it isn't a version-stamp for every
 *  edit. Purely additive fields don't need it: each is sanitised independently
 *  below, so an older record simply reads its new fields as "nothing recorded". */
const STATS_SCHEMA = 1;

const EMPTY_STATS: Stats = {
  played: 0,
  won: 0,
  streak: 0,
  bestStreak: 0,
  bestScore: 0,
  fastestMs: 0,
  fewestMoves: 0,
  totalMs: 0,
  pending: false,
  dailyWins: 0,
  dailyStreak: 0,
  bestDailyStreak: 0,
  lastDailyWin: "",
  dailyWonDays: [],
};

/** Whole days from `a` to `b`, both YYYY-MM-DD. Parsed at UTC midnight so that a
 *  daylight-saving change — where a local day is 23 or 25 hours long — can't make
 *  two adjacent dates round to a gap of 0 or 2. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The daily streak as it stands on `today`, which is not always the stored number:
 *  a run keeps its value while it's still live and reads as 0 once it has lapsed.
 *  Won today, it's intact; won yesterday, it's intact *and* today's deal is still
 *  there to extend it. Anything older is a broken run, and `recordWin` will start
 *  the next one at 1. Left lazy rather than zeroed on read, so nothing has to run at
 *  midnight for the number to be right. */
export function currentDailyStreak(s: Stats, today: string): number {
  if (s.lastDailyWin === "") return 0;
  const gap = daysBetween(s.lastDailyWin, today);
  return gap === 0 || gap === 1 ? s.dailyStreak : 0;
}

/** Whether a given day's deal has been won. The archive asks this per cell. */
export function hasWonDaily(s: Stats, key: string): boolean {
  return s.dailyWonDays.includes(key);
}

/** Non-negative integer, or 0. Every stat is a count or a duration, so anything else —
 *  hand-edited, negative, fractional, missing — reads as "nothing recorded". */
function count(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** The pre-stats best score, kept only so an existing record survives the upgrade. */
function legacyBestScore(): number {
  const raw = readItem(BEST_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function loadStats(): Stats {
  const raw = readItem(STATS_KEY);
  if (raw === null) return { ...EMPTY_STATS, bestScore: legacyBestScore() };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...EMPTY_STATS };
  }
  if (typeof data !== "object" || data === null) return { ...EMPTY_STATS };
  const d = data as Record<string, unknown>;
  if (d.v !== STATS_SCHEMA) return { ...EMPTY_STATS };
  const played = count(d.played);
  // Clamped, so a hand-edited record can't show a win rate over 100%.
  const won = Math.min(count(d.won), played);
  return {
    played,
    won,
    streak: count(d.streak),
    bestStreak: count(d.bestStreak),
    bestScore: count(d.bestScore),
    fastestMs: count(d.fastestMs),
    fewestMoves: count(d.fewestMoves),
    totalMs: count(d.totalMs),
    pending: d.pending === true,
    dailyWins: Math.min(count(d.dailyWins), won), // a daily win is also a win
    dailyStreak: count(d.dailyStreak),
    bestDailyStreak: count(d.bestDailyStreak),
    lastDailyWin: isDailyKey(d.lastDailyWin) ? d.lastDailyWin : "",
    dailyWonDays: Array.isArray(d.dailyWonDays)
      ? [...new Set(d.dailyWonDays.filter(isDailyKey))].sort().reverse().slice(0, WON_DAYS_KEPT)
      : [],
  };
}

function saveStats(s: Stats): void {
  writeItem(STATS_KEY, JSON.stringify({ v: STATS_SCHEMA, ...s }));
}

/** Both keys, or resetting would resurrect the old best score from the pre-stats one. */
export function resetStats(): void {
  for (const key of [STATS_KEY, BEST_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage may be unavailable */
    }
  }
}

/** A deal becomes a played game on its first move, not when it's dealt — otherwise
 *  cycling through deals looking for a nice one would tank the win rate. */
export function recordGameStart(): Stats {
  const s = loadStats();
  if (s.pending) s.streak = 0; // the game before this one was never finished
  s.played += 1;
  s.pending = true;
  saveStats(s);
  return s;
}

/** A game given up on: New Game or Restart over the top of one that had moves. */
export function recordAbandon(elapsedMs: number): Stats {
  const s = loadStats();
  if (!s.pending) return s;
  s.pending = false;
  s.streak = 0;
  s.totalMs += count(Math.round(elapsedMs));
  saveStats(s);
  return s;
}

/** Fold a win into the record. `isRecord` is what the win dialog announces: beating
 *  the best score is strictly greater, so matching it isn't new. The answer holds even
 *  when the write fails (full or unavailable storage) — the player still just won. */
export function recordWin(game: {
  score: number;
  elapsedMs: number;
  moves: number;
  /** Set when the board played was some day's daily deal.
   *
   *  `extendsStreak` is separate from `key` on purpose: an archived day can be won at
   *  any time, and it should tick that day in the archive without touching a run that
   *  is about it being *today*. Only main.ts knows which case this is, so it says so
   *  rather than storage guessing from a date. */
  daily?: { key: string; extendsStreak: boolean };
}): { stats: Stats; isRecord: boolean } {
  const s = loadStats();
  const isRecord = game.score > s.bestScore;
  const ms = count(Math.round(game.elapsedMs));
  if (!s.pending) s.played += 1; // a win with no recorded start still counts as played
  s.pending = false;
  s.won += 1;
  s.streak += 1;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.bestScore = Math.max(s.bestScore, count(game.score));
  s.totalMs += ms;
  if (ms > 0 && (s.fastestMs === 0 || ms < s.fastestMs)) s.fastestMs = ms;
  if (game.moves > 0 && (s.fewestMoves === 0 || game.moves < s.fewestMoves)) {
    s.fewestMoves = game.moves;
  }
  // A day's deal counts once, however often it is replayed — which is why this keys
  // off the date rather than off the win.
  const daily = game.daily;
  if (daily && isDailyKey(daily.key) && !s.dailyWonDays.includes(daily.key)) {
    s.dailyWins += 1;
    s.dailyWonDays = [daily.key, ...s.dailyWonDays].sort().reverse().slice(0, WON_DAYS_KEPT);
    // The streak is only ever about keeping up with *today*. Winning an archived day
    // ticks it off above, but must not extend or restart a run.
    if (daily.extendsStreak) {
      s.dailyStreak =
        s.lastDailyWin !== "" && daysBetween(s.lastDailyWin, daily.key) === 1
          ? s.dailyStreak + 1
          : 1;
      s.bestDailyStreak = Math.max(s.bestDailyStreak, s.dailyStreak);
      s.lastDailyWin = daily.key;
    }
  }
  saveStats(s);
  return { stats: s, isRecord };
}
