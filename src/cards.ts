// Card model and deck utilities for Klondike Solitaire.

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

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
