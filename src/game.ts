// Klondike Solitaire rules and state. Framework-free and self-contained so the
// logic can be reasoned about (and tested) independently of rendering.

import { Card, buildDeck, decodeCard, encodeCard, shuffle, suitColor } from "./cards";
import { mulberry32, randomSeed } from "./rng";

export type DrawCount = 1 | 3;

export type PileId =
  | { kind: "stock" }
  | { kind: "waste" }
  | { kind: "foundation"; index: number }
  | { kind: "tableau"; index: number }
  | { kind: "spare"; index: number };

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
  spares: Card[][];
  moves: number;
  score: number;
}

/** The piles of a board, as plain JSON-safe data: arrays of encoded cards (see
 *  `encodeCard`). Shared by the live board and by every undo snapshot, so both are
 *  validated by exactly the same rules. */
export interface BoardState {
  stock: number[];
  waste: number[];
  foundations: number[][];
  tableau: number[][];
  spares: number[][];
}

/** A board as it was before a move, which is all undo needs: the piles, plus the two
 *  counters a move changes. */
export interface SnapshotState extends BoardState {
  moves: number;
  score: number;
}

/** A whole game as plain JSON-safe data. */
export interface GameState extends BoardState {
  /** The 32-bit seed this board was dealt from; see rng.ts. */
  seed: number;
  drawCount: DrawCount;
  easy: boolean;
  moves: number;
  score: number;
  /** Undo and redo, oldest first. Optional on purpose: a save written before these
   *  existed is still a perfectly good board and resumes with an empty history, which
   *  is exactly how every resumed game used to behave — so this needed no schema bump
   *  and no one lost a game in progress to the upgrade. */
  history?: SnapshotState[];
  future?: SnapshotState[];
}

const MAX_HISTORY = 200;

/** How much of the undo stack rides along in the save. Smaller than `MAX_HISTORY`
 *  because the save is rewritten after *every move*: the whole 200 would be ~60 KB of
 *  JSON per move to buy undo depth that nobody reaches after coming back to a game.
 *  The most recent moves are the ones anyone actually takes back. */
const PERSISTED_HISTORY = 40;

/** Maximum number of temp parking stacks alive at once. */
export const MAX_SPARES = 3;

/** What every move costs, so winning in fewer moves scores better. Small enough that
 *  a productive move still pays (a card to a foundation nets +9), big enough that
 *  shuffling cards about pointlessly bleeds points. */
const MOVE_COST = 1;

function cloneCard(c: Card): Card {
  return { id: c.id, suit: c.suit, rank: c.rank, faceUp: c.faceUp };
}

function clonePile(p: Card[]): Card[] {
  return p.map(cloneCard);
}

function encodePile(p: Card[]): number[] {
  return p.map(encodeCard);
}

function decodePile(codes: number[]): Card[] {
  return codes.map(decodeCard);
}

function encodeSnapshot(s: Snapshot): SnapshotState {
  return {
    stock: encodePile(s.stock),
    waste: encodePile(s.waste),
    foundations: s.foundations.map(encodePile),
    tableau: s.tableau.map(encodePile),
    spares: s.spares.map(encodePile),
    moves: s.moves,
    score: s.score,
  };
}

function decodeSnapshot(s: SnapshotState): Snapshot {
  return {
    stock: decodePile(s.stock),
    waste: decodePile(s.waste),
    foundations: s.foundations.map(decodePile),
    tableau: s.tableau.map(decodePile),
    spares: s.spares.map(decodePile),
    moves: s.moves,
    score: s.score,
  };
}

// ---- Deserialization -------------------------------------------------------

function asDrawCount(v: unknown): DrawCount | null {
  return v === 1 ? 1 : v === 3 ? 3 : null;
}

function asSeed(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : null;
}

function asCount(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function isCodePile(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 104)
  );
}

function isCodeGrid(v: unknown, len: number): v is number[][] {
  return Array.isArray(v) && v.length === len && v.every(isCodePile);
}

const allFaceUp = (p: number[]): boolean => p.every((c) => c >= 52);

/** The piles of an untrusted board, checked as a structurally legal Klondike position.
 *  Factored out so an undo snapshot is held to exactly the same standard as the live
 *  board — a snapshot is a board the game will adopt wholesale the moment Undo is
 *  pressed, so waving it through would just move the corruption one keystroke away. */
function parseBoardState(d: Record<string, unknown>): BoardState | null {
  const { stock, waste, foundations, tableau, spares } = d;
  if (!isCodePile(stock) || !isCodePile(waste)) return null;
  if (!isCodeGrid(foundations, 4) || !isCodeGrid(tableau, 7)) return null;
  if (!Array.isArray(spares) || spares.length > MAX_SPARES) return null;
  if (!spares.every(isCodePile)) return null;
  const sparePiles: number[][] = spares;

  // Exactly one deck, no duplicates and nothing missing.
  const ids = new Set<number>();
  let total = 0;
  for (const p of [stock, waste, ...foundations, ...tableau, ...sparePiles]) {
    total += p.length;
    for (const c of p) ids.add(c % 52);
  }
  if (total !== 52 || ids.size !== 52) return null;

  // Face state: the stock is face down, everything off-tableau is face up, and a
  // tableau column is a face-down run followed by a face-up one.
  if (stock.some((c) => c >= 52)) return null;
  if (!allFaceUp(waste) || !foundations.every(allFaceUp) || !sparePiles.every(allFaceUp)) return null;
  for (const col of tableau) {
    let up = false;
    for (const c of col) {
      if (c >= 52) up = true;
      else if (up) return null; // a face-down card resting on a face-up one
    }
  }

  // Foundations run up from the Ace in a single suit.
  for (const f of foundations) {
    for (let i = 0; i < f.length; i++) {
      const card = decodeCard(f[i]);
      if (card.rank !== i + 1 || card.suit !== decodeCard(f[0]).suit) return null;
    }
  }

  return { stock, waste, foundations, tableau, spares: sparePiles };
}

/** One undo entry. A whole board plus the counters that go back with it. */
function parseSnapshotState(data: unknown): SnapshotState | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const moves = asCount(d.moves);
  const score = asCount(d.score);
  if (moves === null || score === null) return null;
  const board = parseBoardState(d);
  return board && { ...board, moves, score };
}

/** A run of undo entries. One bad entry drops the *whole* stack rather than leaving a
 *  hole in it: undo walks backwards through these in order, and a gap would silently
 *  skip a position rather than fail. Capped on the way in as well as on the way out, so
 *  a hand-edited save can't make the game hold an unbounded list in memory. */
function parseHistory(v: unknown): SnapshotState[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_HISTORY) return null;
  const out: SnapshotState[] = [];
  for (const entry of v) {
    const snap = parseSnapshotState(entry);
    if (!snap) return null;
    out.push(snap);
  }
  return out;
}

/** Validate untrusted data — a localStorage save, possibly hand-edited or
 *  written by an older build — as a structurally legal Klondike board. Returns
 *  null instead of throwing so callers can quietly fall back to a fresh deal. */
export function parseGameState(data: unknown): GameState | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  const seed = asSeed(d.seed);
  const drawCount = asDrawCount(d.drawCount);
  const moves = asCount(d.moves);
  const score = asCount(d.score);
  const { easy } = d;
  if (seed === null || drawCount === null || moves === null || score === null) return null;
  if (typeof easy !== "boolean") return null;

  const board = parseBoardState(d);
  if (!board) return null;

  const history = parseHistory(d.history);
  const future = parseHistory(d.future);
  if (!history || !future) return null;

  // Deliberately not checked: that the seed actually deals this board, and that the
  // history is a chain of positions one move apart. Verifying either would mean
  // replaying the game on every load, and neither can produce anything worse than a
  // legal board — Restart lays out a different game; Undo lands on a position you
  // couldn't have reached.
  return { seed, drawCount, easy, moves, score, ...board, history, future };
}

export class Game {
  stock: Card[] = [];
  waste: Card[] = [];
  foundations: Card[][] = [[], [], [], []];
  tableau: Card[][] = [[], [], [], [], [], [], []];
  drawCount: DrawCount = 3;
  /** Easy mode: when true, an empty tableau column accepts any card, not
   *  only a King. */
  easyEmptyStacks = false;
  /** Temp parking piles bought with the + Stack button (−50 each, max 3).
   *  Each accepts a drop only while empty and is removed once a move empties
   *  it again. */
  spares: Card[][] = [];
  moves = 0;
  score = 0;
  /** The seed this board was dealt from. Every game has one, so Restart and the
   *  shareable deal code are always available. */
  seed = 0;

  private history: Snapshot[] = [];
  /** Undone snapshots, awaiting redo. Bounded by MAX_HISTORY for free: every entry
   *  here was moved out of `history`, which is itself capped. */
  private future: Snapshot[] = [];

  constructor(drawCount: DrawCount = 3, seed: number = randomSeed()) {
    this.drawCount = drawCount;
    this.deal(seed);
  }

  // ---- Setup -------------------------------------------------------------

  /** Reset and deal. Cards start face down for the deal animation. Passing the
   *  current seed re-deals the identical layout. */
  deal(seed: number = randomSeed()): void {
    this.seed = seed >>> 0;
    const deck = shuffle(buildDeck(), mulberry32(this.seed));
    this.stock = [];
    this.waste = [];
    this.foundations = [[], [], [], []];
    this.tableau = [[], [], [], [], [], [], []];
    this.spares = [];
    this.moves = 0;
    this.score = 0;
    this.history = [];
    this.future = [];

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

  /** Re-deal this same layout from scratch — a fresh attempt, not an undo, so
   *  moves, score and history all reset. */
  restartDeal(): void {
    this.deal(this.seed);
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
      case "spare":
        return this.spares[id.index];
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
    if (pile.length === 0) return this.easyEmptyStacks || card.rank === 13; // empty accepts King (or any card in easy mode)
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

  canMoveToSpare(index: number): boolean {
    const pile = this.spares[index];
    return pile !== undefined && pile.length === 0;
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

    // Only tableau and spare allow multi-card runs; everything else moves a
    // single top card.
    if (moving.length > 1 && from.kind !== "tableau" && from.kind !== "spare") return null;
    if ((from.kind === "tableau" || from.kind === "spare") && !this.isValidRun(moving)) return null;

    if (to.kind === "tableau") {
      if (!this.canMoveToTableau(moving[0], to.index)) return null;
    } else if (to.kind === "foundation") {
      if (moving.length !== 1) return null;
      if (!this.canMoveToFoundation(moving[0], to.index)) return null;
    } else if (to.kind === "spare") {
      if (!this.canMoveToSpare(to.index)) return null;
    } else {
      return null; // cannot move onto stock or waste
    }

    this.pushHistory();

    const dst = this.getPile(to); // resolve before any spares splice below
    src.splice(fromIndex);
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

    // An emptied temp stack is removed; later stacks shift down one index.
    let adjTo = to;
    if (from.kind === "spare" && src.length === 0) {
      this.spares.splice(from.index, 1);
      if (to.kind === "spare" && to.index > from.index) {
        adjTo = { kind: "spare", index: to.index - 1 };
      }
    }

    this.countMove();
    this.applyScore(from, to, !!flipped);
    return { moved: moving, from, to: adjTo, flipped };
  }

  /** Buy a temp parking stack (−50 points, max 3 alive at once). Undoable. */
  addTempStack(): boolean {
    if (this.spares.length >= MAX_SPARES) return false;
    this.pushHistory();
    this.spares.push([]);
    this.countMove();
    this.score = Math.max(0, this.score - 50);
    return true;
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
    // Guard before recording history, not after: pushing and then popping would
    // still have cleared the redo stack, so a click on a dead stock would silently
    // throw away everything you could redo.
    if (this.stock.length === 0 && this.waste.length === 0) return null;
    this.pushHistory();
    if (this.stock.length === 0) {
      // Recycle: waste back to stock, face down, original order restored.
      while (this.waste.length > 0) {
        const c = this.waste.pop()!;
        c.faceUp = false;
        this.stock.push(c);
      }
      this.countMove();
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
    this.countMove();
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

  /** Which card auto-complete would send home next, and where from — the single
   *  definition of the sweep's order.
   *
   *  Separate from `autoCompleteStep` because the animation needs the card's *old*
   *  screen position, which only exists before the move. main.ts used to mirror this
   *  loop to get it, which is two copies of an ordering with nothing holding them
   *  together; now both ask the same question and only one of them then moves. */
  autoCompleteSource(): { from: PileId; index: number } | null {
    // Prefer tableau tops, then waste, then the temp stacks.
    const sources: PileId[] = [];
    for (let i = 0; i < 7; i++) sources.push({ kind: "tableau", index: i });
    sources.push({ kind: "waste" });
    for (let i = 0; i < this.spares.length; i++) sources.push({ kind: "spare", index: i });
    for (const from of sources) {
      const pile = this.getPile(from);
      if (pile.length === 0) continue;
      if (this.foundationTargetFor(pile[pile.length - 1]) >= 0) {
        return { from, index: pile.length - 1 };
      }
    }
    return null;
  }

  /** A single step of auto-complete: send one eligible card to a foundation. */
  autoCompleteStep(): MoveResult | null {
    const next = this.autoCompleteSource();
    if (!next) return null;
    const card = this.getPile(next.from)[next.index];
    return this.moveCards(next.from, next.index, {
      kind: "foundation",
      index: this.foundationTargetFor(card),
    });
  }

  // ---- Persistence -------------------------------------------------------

  serialize(): GameState {
    return {
      seed: this.seed,
      drawCount: this.drawCount,
      easy: this.easyEmptyStacks,
      moves: this.moves,
      score: this.score,
      stock: encodePile(this.stock),
      waste: encodePile(this.waste),
      foundations: this.foundations.map(encodePile),
      tableau: this.tableau.map(encodePile),
      spares: this.spares.map(encodePile),
      // The most recent entries, oldest first — the tail is what undo reaches for, and
      // `history.shift()` already means the oldest is the one the live stack drops.
      history: this.history.slice(-PERSISTED_HISTORY).map(encodeSnapshot),
      future: this.future.slice(-PERSISTED_HISTORY).map(encodeSnapshot),
    };
  }

  /** Adopt a state produced by `parseGameState`, which owns validation. Cards are
   *  rebuilt fresh so nothing aliases the replaced board — including in the history,
   *  whose snapshots are handed to `applySnapshot` whole when Undo is pressed. */
  restore(state: GameState): void {
    this.seed = state.seed;
    this.drawCount = state.drawCount;
    this.easyEmptyStacks = state.easy;
    this.moves = state.moves;
    this.score = state.score;
    this.stock = decodePile(state.stock);
    this.waste = decodePile(state.waste);
    this.foundations = state.foundations.map(decodePile);
    this.tableau = state.tableau.map(decodePile);
    this.spares = state.spares.map(decodePile);
    this.history = (state.history ?? []).map(decodeSnapshot);
    this.future = (state.future ?? []).map(decodeSnapshot);
  }

  // ---- Undo / redo --------------------------------------------------------

  canUndo(): boolean {
    return this.history.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const snap = this.history.pop();
    if (!snap) return false;
    this.future.push(this.snapshot());
    this.applySnapshot(snap);
    this.score = Math.max(0, snap.score - 5);
    return true;
  }

  /** Step forward again after an undo. Redo restores the pre-undo snapshot whole,
   *  which refunds the undo's 5-point penalty — a round trip that changes nothing
   *  shouldn't cost anything. The penalty still bites for an undo you keep. */
  redo(): boolean {
    const snap = this.future.pop();
    if (!snap) return false;
    this.history.push(this.snapshot());
    this.applySnapshot(snap);
    return true;
  }

  private snapshot(): Snapshot {
    return {
      stock: clonePile(this.stock),
      waste: clonePile(this.waste),
      foundations: this.foundations.map(clonePile),
      tableau: this.tableau.map(clonePile),
      spares: this.spares.map(clonePile),
      moves: this.moves,
      score: this.score,
    };
  }

  private applySnapshot(s: Snapshot): void {
    this.stock = s.stock;
    this.waste = s.waste;
    this.foundations = s.foundations;
    this.tableau = s.tableau;
    this.spares = s.spares;
    this.moves = s.moves;
    this.score = s.score;
  }

  private pushHistory(): void {
    // Any fresh move invalidates the forward stack. This is the single choke point
    // for every mutating path, so one line covers them all.
    this.future.length = 0;
    this.history.push(this.snapshot());
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  /** The single place the move counter advances, so the per-move cost can't be
   *  forgotten on a new kind of move. Every move — a card, a draw, a recycle, buying a
   *  stack — costs `MOVE_COST`, which is what makes a short win worth more than a long
   *  one. Undo refunds it by restoring the pre-move snapshot (less its own penalty). */
  private countMove(): void {
    this.moves++;
    this.score = Math.max(0, this.score - MOVE_COST);
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
