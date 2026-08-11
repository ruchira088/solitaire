// A tiny seeded PRNG, used so every deal is reproducible from a short code.
//
// This is a WIRE FORMAT, not an implementation detail. A deal code is shared,
// bookmarked and pasted into URLs, so the pairing of this generator with the
// Fisher-Yates loop in cards.ts determines what every existing code deals.
// Changing either silently reinterprets them all. Don't "improve" it.
//
// mulberry32: 32 bits of state, so the seed *is* the state with no expansion step
// to get wrong; integer-only via Math.imul and >>>, so it is bit-identical on every
// JS engine and can never drift into floating point.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed in [0, 2^32). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

const MAX_SEED = 0xffffffff;

/** The short, shareable form of a seed. At most 7 characters. */
export function encodeSeed(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase();
}

/** Parse a deal code. Case-insensitive; null for anything that isn't a legal
 *  32-bit value, including the just-too-big "1Z141Z4" (2^32 exactly). */
export function parseSeed(code: string | null | undefined): number | null {
  if (typeof code !== "string") return null;
  const t = code.trim();
  if (!/^[0-9a-z]{1,7}$/i.test(t)) return null;
  const n = parseInt(t, 36);
  return Number.isInteger(n) && n >= 0 && n <= MAX_SEED ? n : null;
}

// ---- The daily deal --------------------------------------------------------
//
// One board per calendar day, derived from the date alone, so everyone playing on
// the same day gets the same layout and a score is worth comparing. It needs no new
// state anywhere: a daily *is* an ordinary seeded deal, and "am I on today's?" is
// `game.seed === dailySeed(dailyKey(new Date()))`.

const DAILY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A day's identity: YYYY-MM-DD in the player's **own** timezone, not UTC, so the
 *  deal turns over at their midnight rather than in the middle of their afternoon.
 *  The cost is that two people in different zones briefly disagree about which deal
 *  is "today's" — which matters far less than the puzzle changing at lunchtime. */
export function dailyKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDailyKey(v: unknown): v is string {
  return typeof v === "string" && DAILY_KEY_RE.test(v);
}

/** The seed for a given day. Like the generator above, this is a WIRE FORMAT the
 *  moment anyone plays one: it decides which board "the daily for 2026-08-10" is,
 *  and every streak already recorded assumes that answer never changes. Pinned in
 *  rng.test.ts for exactly that reason.
 *
 *  The date is hashed rather than used as a seed directly (FNV-1a, then an avalanche
 *  step). Consecutive days differ in one low digit, and mixing here means their
 *  boards are unrelated without leaning on the PRNG to do that job. */
export function dailySeed(key: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}

/** The day `days` before (or after) `key`. Arithmetic is done at UTC midnight so a
 *  daylight-saving change can't skip or repeat a day. */
export function shiftDailyKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The `count` most recent day keys ending at `today`, newest first. */
export function recentDailyKeys(today: string, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => shiftDailyKey(today, -i));
}

/** Which day's deal a board is, or null if it isn't one.
 *
 *  Derived rather than stored, for the same reason `isDailyGame()` is: it costs no
 *  save-format change and it survives a reload, so a game resumed days later is still
 *  recognised as the daily it came from. The search window bounds the work — 400 hashes
 *  is microseconds — and also bounds the claim: a board older than that reads as an
 *  ordinary deal, which is the harmless direction. */
export function dailyDayForSeed(seed: number, today: string, window = 400): string | null {
  for (const key of recentDailyKeys(today, window)) {
    if (dailySeed(key) === seed) return key;
  }
  return null;
}
