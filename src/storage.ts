// localStorage access: the UI preferences and the in-progress game. Every call is
// best-effort — storage can be absent (private browsing) or full, in which case the
// game simply runs without persistence.

import { GameState, parseGameState } from "./game";

const GAME_KEY = "solitaire-game";

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
