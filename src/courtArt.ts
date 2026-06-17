// Illustrated art for the court cards (J/Q/K) and Aces. Each illustration is an
// SVG built procedurally, rasterised once into an HTMLImageElement and cached.
// The renderer draws the cached image when ready and falls back to simple text
// until then. Keeping the art as SVG means it stays crisp at any size / DPI.

import { Card, suitColor, Suit } from "./cards";

interface Palette {
  robe0: string;
  robe1: string;
  trim: string;
  emblem: string;
  hair: string;
  hairDark: string;
}

const RED: Palette = {
  robe0: "#d6394b",
  robe1: "#921325",
  trim: "#f3d27a",
  emblem: "#c41f33",
  hair: "#9b5b2a",
  hairDark: "#6e3c18",
};

const BLACK: Palette = {
  robe0: "#3f5fa0",
  robe1: "#1b2f63",
  trim: "#f3d27a",
  emblem: "#1c2330",
  hair: "#4a4a52",
  hairDark: "#2c2c33",
};

function pal(suit: Suit): Palette {
  return suitColor(suit) === "red" ? RED : BLACK;
}

// ---- Suit symbols (vector) -------------------------------------------------

/** A suit symbol centred at (cx,cy) with overall size `s`, filled with `fill`. */
function suitVector(suit: Suit, cx: number, cy: number, s: number, fill: string): string {
  const n = (v: number) => +(v * s).toFixed(2);
  switch (suit) {
    case "hearts":
      return `<path d="M ${cx} ${cy + n(0.4)} C ${cx - n(0.5)} ${cy} ${cx - n(0.52)} ${cy - n(0.36)} ${cx - n(0.2)} ${cy - n(0.36)} C ${cx - n(0.06)} ${cy - n(0.36)} ${cx} ${cy - n(0.2)} ${cx} ${cy - n(0.14)} C ${cx} ${cy - n(0.2)} ${cx + n(0.06)} ${cy - n(0.36)} ${cx + n(0.2)} ${cy - n(0.36)} C ${cx + n(0.52)} ${cy - n(0.36)} ${cx + n(0.5)} ${cy} ${cx} ${cy + n(0.4)} Z" fill="${fill}"/>`;
    case "diamonds":
      return `<path d="M ${cx} ${cy - n(0.5)} L ${cx + n(0.36)} ${cy} L ${cx} ${cy + n(0.5)} L ${cx - n(0.36)} ${cy} Z" fill="${fill}"/>`;
    case "spades":
      return `<path d="M ${cx} ${cy - n(0.44)} C ${cx + n(0.5)} ${cy + n(0.04)} ${cx + n(0.46)} ${cy + n(0.32)} ${cx + n(0.16)} ${cy + n(0.3)} C ${cx + n(0.28)} ${cy + n(0.34)} ${cx + n(0.26)} ${cy + n(0.46)} ${cx + n(0.08)} ${cy + n(0.46)} L ${cx + n(0.14)} ${cy + n(0.54)} L ${cx - n(0.14)} ${cy + n(0.54)} L ${cx - n(0.08)} ${cy + n(0.46)} C ${cx - n(0.26)} ${cy + n(0.46)} ${cx - n(0.28)} ${cy + n(0.34)} ${cx - n(0.16)} ${cy + n(0.3)} C ${cx - n(0.46)} ${cy + n(0.32)} ${cx - n(0.5)} ${cy + n(0.04)} ${cx} ${cy - n(0.44)} Z" fill="${fill}"/>`;
    case "clubs":
      return `<g fill="${fill}">
        <circle cx="${cx}" cy="${cy - n(0.22)}" r="${n(0.21)}"/>
        <circle cx="${cx - n(0.25)}" cy="${cy + n(0.08)}" r="${n(0.21)}"/>
        <circle cx="${cx + n(0.25)}" cy="${cy + n(0.08)}" r="${n(0.21)}"/>
        <path d="M ${cx - n(0.07)} ${cy + n(0.06)} C ${cx - n(0.1)} ${cy + n(0.3)} ${cx - n(0.18)} ${cy + n(0.45)} ${cx - n(0.22)} ${cy + n(0.52)} L ${cx + n(0.22)} ${cy + n(0.52)} C ${cx + n(0.18)} ${cy + n(0.45)} ${cx + n(0.1)} ${cy + n(0.3)} ${cx + n(0.07)} ${cy + n(0.06)} Z"/>
      </g>`;
  }
}

// ---- Shared SVG pieces -----------------------------------------------------

const DEFS = (p: Palette) => `
  <defs>
    <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.robe0}"/>
      <stop offset="1" stop-color="${p.robe1}"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbe7a6"/>
      <stop offset="0.5" stop-color="#e0b94e"/>
      <stop offset="1" stop-color="#a87d22"/>
    </linearGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f7d3ad"/>
      <stop offset="1" stop-color="#ecbe92"/>
    </linearGradient>
  </defs>`;

function eyes(): string {
  return `
    <ellipse cx="43" cy="67" rx="2.1" ry="2.5" fill="#3a2a1a"/>
    <ellipse cx="57" cy="67" rx="2.1" ry="2.5" fill="#3a2a1a"/>
    <circle cx="43.7" cy="66.2" r="0.7" fill="#fff"/>
    <circle cx="57.7" cy="66.2" r="0.7" fill="#fff"/>
    <path d="M40,62 Q43.5,60 47,62" stroke="#7a5a38" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M53,62 Q56.5,60 60,62" stroke="#7a5a38" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M50,68 L47.5,75 Q50,77 52.5,75" stroke="#d79e6e" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function gem(cx: number, cy: number, r: number, color: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff6d8" stroke-width="0.6" opacity="0.95"/>`;
}

// ---- King ------------------------------------------------------------------

function king(suit: Suit, p: Palette): string {
  return `
  ${DEFS(p)}
  <!-- robe -->
  <path d="M10,150 L16,103 Q50,90 84,103 L90,150 Z" fill="url(#robe)" stroke="${p.trim}" stroke-width="1.4"/>
  <path d="M50,150 L50,104" stroke="${p.trim}" stroke-width="1" opacity="0.5"/>
  <!-- ermine collar -->
  <path d="M27,107 Q50,94 73,107 L67,128 Q50,119 33,128 Z" fill="#fbfbf6" stroke="#d9c47e" stroke-width="0.8"/>
  <circle cx="42" cy="113" r="1.3" fill="#33312c"/>
  <circle cx="50" cy="116" r="1.3" fill="#33312c"/>
  <circle cx="58" cy="113" r="1.3" fill="#33312c"/>
  <!-- neck -->
  <rect x="43" y="86" width="14" height="16" rx="4" fill="url(#skin)"/>
  <!-- ears -->
  <circle cx="34" cy="69" r="3.6" fill="url(#skin)"/>
  <circle cx="66" cy="69" r="3.6" fill="url(#skin)"/>
  <!-- head -->
  <ellipse cx="50" cy="68" rx="16.5" ry="20" fill="url(#skin)"/>
  <!-- hair sides -->
  <path d="M33,55 Q31,80 38,90 Q33,72 36,56 Z" fill="${p.hair}"/>
  <path d="M67,55 Q69,80 62,90 Q67,72 64,56 Z" fill="${p.hair}"/>
  ${eyes()}
  <!-- mustache & beard -->
  <path d="M40,78 Q50,84 60,78 Q55,82 50,82 Q45,82 40,78 Z" fill="#efeae2"/>
  <path d="M37,79 Q41,106 50,106 Q59,106 63,79 Q57,95 50,95 Q43,95 37,79 Z" fill="#f2efe8" stroke="#d8d2c6" stroke-width="0.6"/>
  <!-- crown -->
  <path d="M30,52 L33,30 L41,45 L50,25 L59,45 L67,30 L70,52 Z" fill="url(#gold)" stroke="#a87d22" stroke-width="1"/>
  <rect x="29" y="50" width="42" height="8" rx="2.5" fill="url(#gold)" stroke="#a87d22" stroke-width="1"/>
  <!-- cross finial -->
  <rect x="49" y="15" width="2" height="9" rx="0.8" fill="url(#gold)"/>
  <rect x="46.5" y="17.5" width="7" height="2" rx="0.8" fill="url(#gold)"/>
  ${gem(50, 28, 3, "#e7473c")}
  ${gem(33, 31, 2.3, "#3aa0e0")}
  ${gem(67, 31, 2.3, "#3aa0e0")}
  ${gem(39, 54, 1.8, "#e7473c")}
  ${gem(50, 54, 1.8, "#46c46e")}
  ${gem(61, 54, 1.8, "#e7473c")}
  <!-- emblem -->
  ${suitVector(suit, 50, 132, 22, p.emblem)}
  `;
}

// ---- Queen -----------------------------------------------------------------

function queen(suit: Suit, p: Palette): string {
  return `
  ${DEFS(p)}
  <!-- robe -->
  <path d="M12,150 L18,104 Q50,92 82,104 L88,150 Z" fill="url(#robe)" stroke="${p.trim}" stroke-width="1.4"/>
  <!-- hair behind -->
  <path d="M30,58 Q24,92 34,116 Q30,90 38,64 Z" fill="${p.hair}"/>
  <path d="M70,58 Q76,92 66,116 Q70,90 62,64 Z" fill="${p.hair}"/>
  <!-- pearl necklace -->
  <path d="M34,107 Q50,120 66,107" stroke="#fff" stroke-width="0.6" fill="none"/>
  ${[38, 43, 48, 53, 58, 62].map((x, i) => `<circle cx="${x}" cy="${110 + Math.sin(i) * 1.5 + (i === 0 || i === 5 ? -2 : 2)}" r="1.6" fill="#fdfdfd" stroke="#cdbf8f" stroke-width="0.4"/>`).join("")}
  <!-- neck -->
  <rect x="44" y="88" width="12" height="14" rx="4" fill="url(#skin)"/>
  <!-- head -->
  <ellipse cx="50" cy="69" rx="15.5" ry="19" fill="url(#skin)"/>
  <!-- hair front framing -->
  <path d="M34,60 Q33,44 50,42 Q67,44 66,60 Q60,50 50,50 Q40,50 34,60 Z" fill="${p.hair}"/>
  <path d="M35,58 Q34,86 41,100 Q33,80 38,60 Z" fill="${p.hairDark}" opacity="0.5"/>
  <path d="M65,58 Q66,86 59,100 Q67,80 62,60 Z" fill="${p.hairDark}" opacity="0.5"/>
  ${eyes()}
  <!-- cheeks & lips -->
  <circle cx="40" cy="74" r="3" fill="#f4a6a0" opacity="0.45"/>
  <circle cx="60" cy="74" r="3" fill="#f4a6a0" opacity="0.45"/>
  <path d="M46,80 Q50,83 54,80 Q50,82 46,80 Z" fill="#d24a52"/>
  <!-- tiara -->
  <path d="M35,52 Q50,43 65,52 L62,46 L56,50 L50,42 L44,50 L38,46 Z" fill="url(#gold)" stroke="#a87d22" stroke-width="0.9"/>
  ${gem(50, 46, 2.6, "#46c46e")}
  ${gem(40, 50, 1.6, "#e7473c")}
  ${gem(60, 50, 1.6, "#e7473c")}
  <!-- emblem -->
  ${suitVector(suit, 50, 132, 22, p.emblem)}
  `;
}

// ---- Jack ------------------------------------------------------------------

function jack(suit: Suit, p: Palette): string {
  return `
  ${DEFS(p)}
  <!-- robe -->
  <path d="M14,150 L20,106 Q50,94 80,106 L86,150 Z" fill="url(#robe)" stroke="${p.trim}" stroke-width="1.4"/>
  <!-- ruff collar -->
  <path d="M30,108 q5,-7 10,0 q5,-7 10,0 q5,-7 10,0 q5,-7 10,0 l-3,9 q-17,7 -34,0 Z" fill="#fbfbf6" stroke="#d9c47e" stroke-width="0.7"/>
  <!-- neck -->
  <rect x="44" y="90" width="12" height="13" rx="4" fill="url(#skin)"/>
  <!-- ears -->
  <circle cx="35" cy="70" r="3.2" fill="url(#skin)"/>
  <circle cx="65" cy="70" r="3.2" fill="url(#skin)"/>
  <!-- head -->
  <ellipse cx="50" cy="69" rx="15.5" ry="18.5" fill="url(#skin)"/>
  <!-- hair (youthful, shoulder length) -->
  <path d="M34,58 Q33,82 40,92 Q34,74 37,58 Z" fill="${p.hair}"/>
  <path d="M66,58 Q67,82 60,92 Q66,74 63,58 Z" fill="${p.hair}"/>
  <path d="M35,57 Q36,46 50,45 Q64,46 65,57 Q58,52 50,52 Q42,52 35,57 Z" fill="${p.hair}"/>
  ${eyes()}
  <!-- small mustache & lips -->
  <path d="M44,79 Q50,82 56,79 Q50,80.5 44,79 Z" fill="${p.hairDark}"/>
  <!-- cap with feather -->
  <path d="M30,54 Q50,34 70,52 Q72,42 58,38 Q44,34 36,44 Q30,48 30,54 Z" fill="url(#robe)" stroke="${p.trim}" stroke-width="1.1"/>
  <path d="M30,54 Q50,46 70,52 L70,50 Q50,44 30,52 Z" fill="${p.trim}" opacity="0.85"/>
  <path d="M62,40 Q82,18 88,40 Q74,32 62,42 Z" fill="url(#gold)" stroke="#a87d22" stroke-width="0.8"/>
  ${gem(38, 47, 2, "#e7473c")}
  <!-- emblem -->
  ${suitVector(suit, 50, 132, 22, p.emblem)}
  `;
}

// ---- Ace -------------------------------------------------------------------

function flourish(cx: number, cy: number, dir: number, p: Palette): string {
  const d = dir;
  return `<g stroke="${p.trim}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.9">
    <path d="M ${cx} ${cy} q ${12 * d} ${-4} ${16 * d} ${-12} q ${2 * d} ${-6} ${-4 * d} ${-7} q ${-5 * d} ${-1} ${-4 * d} ${5}"/>
    <path d="M ${cx} ${cy} q ${10 * d} ${4} ${18 * d} ${2}"/>
    <circle cx="${cx + 16 * d}" cy="${cy - 12}" r="1.4" fill="${p.trim}" stroke="none"/>
  </g>`;
}

function ace(suit: Suit, p: Palette): string {
  const fill = suitColor(suit) === "red" ? "url(#aceRed)" : "url(#aceBlk)";
  return `
  <defs>
    <radialGradient id="aceRed" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="#ef5365"/>
      <stop offset="1" stop-color="#a3142a"/>
    </radialGradient>
    <radialGradient id="aceBlk" cx="0.4" cy="0.35" r="0.8">
      <stop offset="0" stop-color="#3a414f"/>
      <stop offset="1" stop-color="#11151f"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fbe7a6"/>
      <stop offset="1" stop-color="#bb9230"/>
    </linearGradient>
  </defs>
  <!-- decorative double ring -->
  <circle cx="50" cy="75" r="40" fill="none" stroke="url(#ring)" stroke-width="1.4" opacity="0.7"/>
  <circle cx="50" cy="75" r="36" fill="none" stroke="url(#ring)" stroke-width="0.7" opacity="0.5"/>
  <!-- top & bottom flourishes -->
  ${flourish(50, 30, 1, p)}
  ${flourish(50, 30, -1, p)}
  ${flourish(50, 120, 1, p)}
  ${flourish(50, 120, -1, p)}
  <!-- large suit symbol with sheen -->
  ${suitVector(suit, 50, 76, 70, fill)}
  <ellipse cx="42" cy="60" rx="9" ry="14" fill="#ffffff" opacity="0.12"/>
  `;
}

// ---- SVG assembly & image cache -------------------------------------------

function wrap(inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" width="100" height="150">${inner}</svg>`;
}

function svgFor(card: Card): string {
  const p = pal(card.suit);
  if (card.rank === 1) return wrap(ace(card.suit, p));
  if (card.rank === 11) return wrap(jack(card.suit, p));
  if (card.rank === 12) return wrap(queen(card.suit, p));
  return wrap(king(card.suit, p));
}

const cache = new Map<string, HTMLImageElement>();

function keyFor(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

/** Return the cached, loaded illustration for a court/ace card, or null while
 *  it is still decoding (the caller draws a fallback in the meantime). */
export function getFaceArt(card: Card): HTMLImageElement | null {
  if (card.rank !== 1 && card.rank < 11) return null;
  const key = keyFor(card);
  let img = cache.get(key);
  if (!img) {
    img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgFor(card));
    cache.set(key, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Kick off rasterising every court/ace illustration up front. */
export function preloadFaceArt(): void {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  for (const suit of suits) {
    for (const rank of [1, 11, 12, 13]) {
      getFaceArt({ id: -1, suit, rank, faceUp: true });
    }
  }
}
