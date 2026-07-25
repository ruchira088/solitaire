// Loads the static SVG card faces (the public-domain vector-playing-cards set)
// from public/cards/ and caches them as HTMLImageElements. The renderer draws
// the cached image for each face-up card; while an image is still decoding the
// caller falls back to the procedural face so nothing pops in blank.

import { Card, Suit } from "./cards";

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

/** Eagerly start loading every face up front. */
export function preloadCardFaces(): void {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  for (const suit of suits) {
    for (let rank = 1; rank <= 13; rank++) {
      getCardFace({ id: -1, suit, rank, faceUp: true });
    }
  }
}
