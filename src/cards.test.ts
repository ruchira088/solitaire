// The card model and the persistence codec. The codec matters out of proportion to
// its size: saved games are arrays of these integers, so the id scheme and the SUITS
// ordering are effectively a wire format.

import { describe, expect, it } from "vitest";
import {
  buildDeck,
  Card,
  decodeCard,
  encodeCard,
  isRed,
  rankLabel,
  shuffle,
  SUITS,
  suitColor,
} from "./cards";

describe("buildDeck", () => {
  it("produces 52 cards, all face down", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(52);
    expect(deck.every((c) => !c.faceUp)).toBe(true);
  });

  it("numbers them 0..51 in order", () => {
    expect(buildDeck().map((c) => c.id)).toEqual([...Array(52).keys()]);
  });

  it("holds each suit/rank pair exactly once", () => {
    const seen = new Set(buildDeck().map((c) => `${c.suit}-${c.rank}`));
    expect(seen.size).toBe(52);
  });

  it("lays ids out as suitIndex * 13 + rank - 1", () => {
    for (const c of buildDeck()) {
      expect(c.id).toBe(SUITS.indexOf(c.suit) * 13 + c.rank - 1);
    }
  });
});

describe("encodeCard / decodeCard", () => {
  it("round-trips every card in both face states", () => {
    for (const base of buildDeck()) {
      for (const faceUp of [false, true]) {
        const card: Card = { ...base, faceUp };
        expect(decodeCard(encodeCard(card))).toEqual(card);
      }
    }
  });

  it("covers all 104 codes with no collisions", () => {
    const codes = new Set<number>();
    for (const base of buildDeck()) {
      for (const faceUp of [false, true]) codes.add(encodeCard({ ...base, faceUp }));
    }
    expect(codes.size).toBe(104);
    expect(Math.min(...codes)).toBe(0);
    expect(Math.max(...codes)).toBe(103);
  });

  it("adds exactly 52 for a face-up card", () => {
    const c = buildDeck()[7];
    expect(encodeCard({ ...c, faceUp: true }) - encodeCard({ ...c, faceUp: false })).toBe(52);
  });

  it("keeps the SUITS ordering frozen — code 0 is the ace of spades", () => {
    // Saved games store these codes. Reordering SUITS would silently reinterpret
    // every existing save, so this is a deliberate tripwire, not a tautology.
    expect(SUITS).toEqual(["spades", "hearts", "diamonds", "clubs"]);
    expect(decodeCard(0)).toEqual({ id: 0, suit: "spades", rank: 1, faceUp: false });
    expect(decodeCard(52)).toEqual({ id: 0, suit: "spades", rank: 1, faceUp: true });
    expect(decodeCard(103)).toEqual({ id: 51, suit: "clubs", rank: 13, faceUp: true });
  });
});

describe("shuffle", () => {
  it("preserves the exact multiset of cards", () => {
    const deck = buildDeck();
    const before = deck.map((c) => c.id).sort((a, b) => a - b);
    const after = shuffle(deck).map((c) => c.id).sort((a, b) => a - b);
    expect(after).toEqual(before);
  });

  it("shuffles in place and returns the same array", () => {
    const deck = buildDeck();
    expect(shuffle(deck)).toBe(deck);
  });

  it("actually reorders (not a no-op) across repeated runs", () => {
    const ordered = buildDeck().map((c) => c.id);
    const anyDifferent = Array.from({ length: 5 }, () =>
      shuffle(buildDeck()).map((c) => c.id),
    ).some((ids) => ids.join() !== ordered.join());
    expect(anyDifferent).toBe(true);
  });
});

describe("suitColor / isRed / rankLabel", () => {
  it("maps hearts and diamonds to red, spades and clubs to black", () => {
    expect(suitColor("hearts")).toBe("red");
    expect(suitColor("diamonds")).toBe("red");
    expect(suitColor("spades")).toBe("black");
    expect(suitColor("clubs")).toBe("black");
  });

  it("keeps isRed consistent with suitColor for every suit", () => {
    for (const s of SUITS) expect(isRed(s)).toBe(suitColor(s) === "red");
  });

  it("labels the court cards and the ace", () => {
    expect([1, 11, 12, 13].map(rankLabel)).toEqual(["A", "J", "Q", "K"]);
  });

  it("labels the pip ranks numerically", () => {
    for (let r = 2; r <= 10; r++) expect(rankLabel(r)).toBe(String(r));
  });
});
