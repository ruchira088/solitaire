// localStorage access: the UI preferences and the in-progress game. Every call is
// best-effort — storage can be absent (private browsing) or full, in which case the
// game simply runs without persistence.

import { GameState, parseGameState } from "./game";

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
}

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
};

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
  return {
    played,
    // Clamped, so a hand-edited record can't show a win rate over 100%.
    won: Math.min(count(d.won), played),
    streak: count(d.streak),
    bestStreak: count(d.bestStreak),
    bestScore: count(d.bestScore),
    fastestMs: count(d.fastestMs),
    fewestMoves: count(d.fewestMoves),
    totalMs: count(d.totalMs),
    pending: d.pending === true,
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
  saveStats(s);
  return { stats: s, isRecord };
}
