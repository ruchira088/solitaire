// Loads the static card faces (the public-domain vector-playing-cards set) from
// public/cards/ and caches them as HTMLImageElements. The renderer draws the
// cached image for each face-up card; while an image is still decoding the caller
// falls back to the procedural face so nothing pops in blank.

import { Card, Suit, SUITS } from "./cards";

const RANK_NAME: Record<number, string> = {
  1: "ace",
  11: "jack",
  12: "queen",
  13: "king",
};

const SUIT_NAME: Record<Suit, string> = {
  spades: "spades",
  hearts: "hearts",
  diamonds: "diamonds",
  clubs: "clubs",
};

/** Court art is served as WebP rasterised from art/cards-src/ (the source SVGs are
 *  auto-traced and up to 1.1 MB each); everything else stays vector. See
 *  scripts/rasterize-cards.mjs. */
function isCourt(rank: number): boolean {
  return rank >= 11;
}

function fileName(card: Card): string {
  const rank = RANK_NAME[card.rank] ?? String(card.rank);
  const ext = isCourt(card.rank) ? "webp" : "svg";
  return `${rank}_of_${SUIT_NAME[card.suit]}.${ext}`;
}

// Respects Vite's configured base path so it works in dev and when deployed.
const BASE = import.meta.env.BASE_URL;

const cache = new Map<string, HTMLImageElement>();

/** The loaded SVG face for a card, or null while it is still decoding. */
export function getCardFace(card: Card): HTMLImageElement | null {
  const name = fileName(card);
  let img = cache.get(name);
  if (!img) {
    img = new Image();
    img.src = `${BASE}cards/${name}`;
    cache.set(name, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

function request(suit: Suit, rank: number): void {
  getCardFace({ id: -1, suit, rank, faceUp: true });
}

/** Start loading faces. The 40 pip/ace faces go up front — they total ~150 KB — but
 *  the 12 court WebPs are ~850 KB between them, so they wait for idle rather than
 *  competing with first paint. Any court card that appears before then loads on
 *  demand via `getCardFace` from the render loop, showing the procedural courtArt
 *  face until it decodes. */
export function preloadCardFaces(): void {
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 10; rank++) request(suit, rank);
  }
  const warmCourt = (): void => {
    for (const suit of SUITS) {
      for (let rank = 11; rank <= 13; rank++) request(suit, rank);
    }
  };
  // Aliased rather than tested with `in`, which narrows `window` itself to never.
  const idle: typeof window.requestIdleCallback | undefined = window.requestIdleCallback;
  if (idle) idle(warmCourt, { timeout: 4000 });
  else window.setTimeout(warmCourt, 1500); // Safari < 17.4
}
