// Klondike Solitaire rules and state. Framework-free and self-contained so the
// logic can be reasoned about (and tested) independently of rendering.

import { Card, buildDeck, shuffle, suitColor } from "./cards";

export type DrawCount = 1 | 3;

export type PileId =
  | { kind: "stock" }
  | { kind: "waste" }
  | { kind: "foundation"; index: number }
  | { kind: "tableau"; index: number };

export interface MoveResult {
  moved: Card[];
  from: PileId;
  to: PileId;
  /** A tableau card that was newly turned face up by this move, if any. */
  flipped: Card | null;
}

interface Snapshot {
  stock: Card[];
  waste: Card[];
  foundations: Card[][];
  tableau: Card[][];
  moves: number;
  score: number;
}

const MAX_HISTORY = 200;

function cloneCard(c: Card): Card {
  return { id: c.id, suit: c.suit, rank: c.rank, faceUp: c.faceUp };
}

function clonePile(p: Card[]): Card[] {
  return p.map(cloneCard);
}

export class Game {
  stock: Card[] = [];
  waste: Card[] = [];
  foundations: Card[][] = [[], [], [], []];
  tableau: Card[][] = [[], [], [], [], [], [], []];
  drawCount: DrawCount = 3;
  moves = 0;
  score = 0;

  private history: Snapshot[] = [];

  constructor(drawCount: DrawCount = 3) {
    this.drawCount = drawCount;
    this.deal();
  }

  // ---- Setup -------------------------------------------------------------

  /** Reset and deal a fresh game. Cards start face down for the deal animation. */
  deal(): void {
    const deck = shuffle(buildDeck());
    this.stock = [];
    this.waste = [];
    this.foundations = [[], [], [], []];
    this.tableau = [[], [], [], [], [], [], []];
    this.moves = 0;
    this.score = 0;
    this.history = [];

    let idx = 0;
    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const card = deck[idx++];
        card.faceUp = row === col; // only the last card in each column is face up
        this.tableau[col].push(card);
      }
    }
    while (idx < deck.length) {
      const card = deck[idx++];
      card.faceUp = false;
      this.stock.push(card);
    }
  }

  // ---- Pile access -------------------------------------------------------

  getPile(id: PileId): Card[] {
    switch (id.kind) {
      case "stock":
        return this.stock;
      case "waste":
        return this.waste;
      case "foundation":
        return this.foundations[id.index];
      case "tableau":
        return this.tableau[id.index];
    }
  }

  // ---- Rules -------------------------------------------------------------

  /** A run of tableau cards is movable if every card is face up and forms a
   *  descending, alternating-color sequence. */
  isValidRun(cards: Card[]): boolean {
    for (let i = 0; i < cards.length; i++) {
      if (!cards[i].faceUp) return false;
      if (i > 0) {
        const prev = cards[i - 1];
        const cur = cards[i];
        if (cur.rank !== prev.rank - 1) return false;
        if (suitColor(cur.suit) === suitColor(prev.suit)) return false;
      }
    }
    return true;
  }

  canMoveToTableau(card: Card, col: number): boolean {
    const pile = this.tableau[col];
    if (pile.length === 0) return card.rank === 13; // empty accepts King
    const top = pile[pile.length - 1];
    if (!top.faceUp) return false;
    return (
      card.rank === top.rank - 1 &&
      suitColor(card.suit) !== suitColor(top.suit)
    );
  }

  canMoveToFoundation(card: Card, index: number): boolean {
    const pile = this.foundations[index];
    if (pile.length === 0) return card.rank === 1; // empty accepts Ace
    const top = pile[pile.length - 1];
    return card.suit === top.suit && card.rank === top.rank + 1;
  }

  /** Find a foundation index that legally accepts this card, or -1. */
  foundationTargetFor(card: Card): number {
    for (let i = 0; i < 4; i++) {
      if (this.canMoveToFoundation(card, i)) return i;
    }
    return -1;
  }

  // ---- Moves -------------------------------------------------------------

  /** Move cards starting at `fromIndex` of the source pile onto a destination.
   *  Returns the result, or null if the move is illegal. Records undo state. */
  moveCards(from: PileId, fromIndex: number, to: PileId): MoveResult | null {
    const src = this.getPile(from);
    if (fromIndex < 0 || fromIndex >= src.length) return null;
    const moving = src.slice(fromIndex);

    // Only tableau allows multi-card runs; everything else moves a single top card.
    if (moving.length > 1 && from.kind !== "tableau") return null;
    if (from.kind === "tableau" && !this.isValidRun(moving)) return null;

    if (to.kind === "tableau") {
      if (!this.canMoveToTableau(moving[0], to.index)) return null;
    } else if (to.kind === "foundation") {
      if (moving.length !== 1) return null;
      if (!this.canMoveToFoundation(moving[0], to.index)) return null;
    } else {
      return null; // cannot move onto stock or waste
    }

    this.pushHistory();

    src.splice(fromIndex);
    const dst = this.getPile(to);
    for (const c of moving) dst.push(c);

    // Turn up a newly exposed tableau card.
    let flipped: Card | null = null;
    if (from.kind === "tableau" && src.length > 0) {
      const newTop = src[src.length - 1];
      if (!newTop.faceUp) {
        newTop.faceUp = true;
        flipped = newTop;
      }
    }

    this.moves++;
    this.applyScore(from, to, !!flipped);
    return { moved: moving, from, to, flipped };
  }

  /** Auto-send the top card of a pile to a foundation (double-click). */
  autoMoveToFoundation(from: PileId): MoveResult | null {
    const pile = this.getPile(from);
    if (pile.length === 0) return null;
    const card = pile[pile.length - 1];
    if (!card.faceUp) return null;
    const target = this.foundationTargetFor(card);
    if (target < 0) return null;
    return this.moveCards(from, pile.length - 1, {
      kind: "foundation",
      index: target,
    });
  }

  /** Draw from stock to waste; recycle waste back to stock when empty. */
  drawFromStock(): MoveResult | null {
    this.pushHistory();
    if (this.stock.length === 0) {
      if (this.waste.length === 0) {
        this.history.pop();
        return null;
      }
      // Recycle: waste back to stock, face down, original order restored.
      while (this.waste.length > 0) {
        const c = this.waste.pop()!;
        c.faceUp = false;
        this.stock.push(c);
      }
      this.moves++;
      return { moved: [], from: { kind: "waste" }, to: { kind: "stock" }, flipped: null };
    }
    const n = Math.min(this.drawCount, this.stock.length);
    const moved: Card[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.stock.pop()!;
      c.faceUp = true;
      this.waste.push(c);
      moved.push(c);
    }
    this.moves++;
    return { moved, from: { kind: "stock" }, to: { kind: "waste" }, flipped: null };
  }

  // ---- Status ------------------------------------------------------------

  isWon(): boolean {
    return this.foundations.every((f) => f.length === 13);
  }

  /** True when the remaining game can be finished purely by sending cards to
   *  the foundations (no face-down cards left and stock/waste are clear-able). */
  canAutoComplete(): boolean {
    if (this.isWon()) return false;
    if (this.stock.length > 0 || this.waste.length > 0) return false;
    for (const col of this.tableau) {
      for (const c of col) if (!c.faceUp) return false;
    }
    return true;
  }

  /** A single step of auto-complete: send one eligible card to a foundation. */
  autoCompleteStep(): MoveResult | null {
    // Prefer tableau tops, then waste.
    const sources: PileId[] = [];
    for (let i = 0; i < 7; i++) sources.push({ kind: "tableau", index: i });
    sources.push({ kind: "waste" });
    for (const src of sources) {
      const pile = this.getPile(src);
      if (pile.length === 0) continue;
      const card = pile[pile.length - 1];
      const target = this.foundationTargetFor(card);
      if (target >= 0) {
        return this.moveCards(src, pile.length - 1, {
          kind: "foundation",
          index: target,
        });
      }
    }
    return null;
  }

  /** Suggest a legal, useful move for the Hint button. */
  findHint(): { from: PileId; fromIndex: number; to: PileId } | null {
    // 1) Anything that can go to a foundation.
    const singleSources: PileId[] = [
      { kind: "waste" },
      ...Array.from({ length: 7 }, (_, i): PileId => ({ kind: "tableau", index: i })),
    ];
    for (const src of singleSources) {
      const pile = this.getPile(src);
      if (pile.length === 0) continue;
      const card = pile[pile.length - 1];
      const f = this.foundationTargetFor(card);
      if (f >= 0) return { from: src, fromIndex: pile.length - 1, to: { kind: "foundation", index: f } };
    }
    // 2) Tableau → tableau runs that reveal a face-down card or empty a column.
    for (let c = 0; c < 7; c++) {
      const col = this.tableau[c];
      const firstFaceUp = col.findIndex((card) => card.faceUp);
      if (firstFaceUp < 0) continue;
      const run = col.slice(firstFaceUp);
      if (!this.isValidRun(run)) continue;
      for (let d = 0; d < 7; d++) {
        if (d === c) continue;
        if (this.canMoveToTableau(run[0], d)) {
          const revealing = firstFaceUp > 0; // moving exposes a face-down card
          const fromEmpty = firstFaceUp === 0 && this.tableau[d].length > 0;
          if (revealing || (run[0].rank === 13 && !fromEmpty)) {
            return { from: { kind: "tableau", index: c }, fromIndex: firstFaceUp, to: { kind: "tableau", index: d } };
          }
        }
      }
    }
    // 3) Waste → tableau.
    if (this.waste.length > 0) {
      const card = this.waste[this.waste.length - 1];
      for (let d = 0; d < 7; d++) {
        if (this.canMoveToTableau(card, d)) {
          return { from: { kind: "waste" }, fromIndex: this.waste.length - 1, to: { kind: "tableau", index: d } };
        }
      }
    }
    // 4) Otherwise a draw is the move.
    if (this.stock.length > 0 || this.waste.length > 0) {
      return { from: { kind: "stock" }, fromIndex: 0, to: { kind: "waste" } };
    }
    return null;
  }

  // ---- Undo --------------------------------------------------------------

  canUndo(): boolean {
    return this.history.length > 0;
  }

  undo(): boolean {
    const snap = this.history.pop();
    if (!snap) return false;
    this.stock = snap.stock;
    this.waste = snap.waste;
    this.foundations = snap.foundations;
    this.tableau = snap.tableau;
    this.moves = snap.moves;
    this.score = snap.score;
    return true;
  }

  private pushHistory(): void {
    this.history.push({
      stock: clonePile(this.stock),
      waste: clonePile(this.waste),
      foundations: this.foundations.map(clonePile),
      tableau: this.tableau.map(clonePile),
      moves: this.moves,
      score: this.score,
    });
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  private applyScore(from: PileId, to: PileId, flipped: boolean): void {
    let delta = 0;
    if (to.kind === "foundation") delta += 10;
    if (from.kind === "foundation" && to.kind === "tableau") delta -= 15;
    if (from.kind === "waste" && to.kind === "tableau") delta += 5;
    if (flipped) delta += 5;
    this.score = Math.max(0, this.score + delta);
  }
}
