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
