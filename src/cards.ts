// Card model and deck utilities for Klondike Solitaire.

import { Rng } from "./rng";

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Color = "red" | "black";

/** Rank is 1..13 where 1 = Ace, 11 = Jack, 12 = Queen, 13 = King. */
export type Rank = number;

export interface Card {
  /** Stable unique id, used to track a card across animations. */
  id: number;
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
}

export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

export const SUIT_GLYPH: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const RANK_LABEL: Record<number, string> = {
  1: "A",
  11: "J",
  12: "Q",
  13: "K",
};

export function rankLabel(rank: Rank): string {
  return RANK_LABEL[rank] ?? String(rank);
}

export function suitColor(suit: Suit): Color {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

export function isRed(suit: Suit): boolean {
  return suitColor(suit) === "red";
}

/** Compact encoding used to persist a card: its id, plus 52 when face up. Suit
 *  and rank fall out of the id, so the ordering of `SUITS` is part of the saved
 *  format — reordering it would misread existing saves. */
export function encodeCard(c: Card): number {
  return c.id + (c.faceUp ? 52 : 0);
}

export function decodeCard(code: number): Card {
  const id = code % 52;
  return { id, suit: SUITS[Math.floor(id / 13)], rank: (id % 13) + 1, faceUp: code >= 52 };
}

/** Build an ordered 52-card deck (all face down). */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: id++, suit, rank, faceUp: false });
    }
  }
  return deck;
}

/** In-place Fisher–Yates shuffle. The generator is a parameter so a deal can be
 *  reproduced from a seed; together with `rng.ts` this loop defines what any given
 *  deal code lays out, so its order of operations is a wire format. */
export function shuffle<T>(arr: T[], rand: Rng = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
