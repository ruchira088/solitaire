// Can this position be won? A depth-first search over the whole legal move set,
// pure and DOM-free so it can run in a worker or a test.
//
// It does not reuse `Game` to explore. Backtracking through `Game.undo()` looks
// tempting — same rules, no duplication — but `MAX_HISTORY` caps the undo stack at
// 200, so beyond that depth an undo would pop the wrong snapshot, and every move
// allocates a full board snapshot besides. Instead the search runs on a compact
// mutable state, and `solver.test.ts` cross-checks its move generator against
// `Game.moveCards` on random positions so the two can't drift apart.
//
// Soundness matters more than speed here: "unwinnable" is a claim shown to a player,
// so the move set has to be *complete*. That includes foundation→tableau, which is
// rarely useful and enlarges the search, but leaving it out would let the solver call
// a winnable game dead. Anything the node budget cuts short reports `unknown`, never
// `unsolvable`.
//
// Not modelled: ✦ spare stacks and easy mode. Both change what a legal move is, and a
// solver that quietly ignored them would answer a different question from the one the
// board is asking — `analyse` returns `unknown` for those positions instead.

import { GameState } from "./game";

/** id 0..51, laid out by cards.ts: suit = id / 13 (spades, hearts, diamonds, clubs),
 *  rank = id % 13 + 1. */
const suitOf = (id: number): number => Math.floor(id / 13);
const rankOf = (id: number): number => (id % 13) + 1;
/** hearts and diamonds are red — matching `suitColor` in cards.ts. */
const isRed = (id: number): boolean => suitOf(id) === 1 || suitOf(id) === 2;

export interface State {
  /** Highest rank home per suit, 0 for none. Foundations aren't suit-locked in this
   *  game, but with four suits and four piles every suit can always claim one, so
   *  per-suit progress is a complete *and* canonical description. */
  found: number[];
  /** Face-down and face-up halves of each tableau column. parseGameState guarantees
   *  every face-down card sits below every face-up one, so the split is lossless. */
  down: number[][];
  up: number[][];
  stock: number[]; // face down; the last entry is the next to be drawn
  waste: number[]; // face up; the last entry is playable
  drawCount: number;
}

export type Move =
  | { kind: "draw" }
  | { kind: "recycle" }
  | { kind: "wasteToTableau"; col: number }
  | { kind: "wasteToFoundation" }
  | { kind: "tableauToFoundation"; col: number }
  | { kind: "tableauToTableau"; from: number; to: number; count: number }
  | { kind: "foundationToTableau"; suit: number; col: number };

export type Outcome = "solved" | "unwinnable" | "unknown";

export interface SolveResult {
  outcome: Outcome;
  /** A winning line, when there is one. */
  moves: Move[];
  /** Search effort actually spent — for tests and for reporting a timeout honestly. */
  nodes: number;
}

/** Positions this search understands. A board with ✦ stacks or easy mode on plays by
 *  different rules, and the honest answer there is "I don't know". */
export function canAnalyse(state: GameState): boolean {
  return state.spares.length === 0 && !state.easy;
}

function toState(g: GameState): State {
  const found = [0, 0, 0, 0];
  for (const pile of g.foundations) {
    for (const code of pile) {
      const id = code % 52;
      found[suitOf(id)] = Math.max(found[suitOf(id)], rankOf(id));
    }
  }
  const down: number[][] = [];
  const up: number[][] = [];
  for (const col of g.tableau) {
    down.push(col.filter((c) => c < 52).map((c) => c % 52));
    up.push(col.filter((c) => c >= 52).map((c) => c % 52));
  }
  return {
    found,
    down,
    up,
    stock: g.stock.map((c) => c % 52),
    waste: g.waste.map((c) => c % 52),
    drawCount: g.drawCount,
  };
}

const isWon = (s: State): boolean => s.found[0] + s.found[1] + s.found[2] + s.found[3] === 52;

/** Descending rank, alternating colour — `isValidRun` in game.ts. */
function runStarts(up: number[]): number[] {
  const starts: number[] = [];
  for (let i = up.length - 1; i >= 0; i--) {
    if (i < up.length - 1) {
      const prev = up[i];
      const next = up[i + 1];
      if (rankOf(next) !== rankOf(prev) - 1 || isRed(next) === isRed(prev)) break;
    }
    starts.push(i);
  }
  return starts;
}

const acceptsOnTableau = (col: number[], card: number): boolean =>
  col.length === 0
    ? rankOf(card) === 13
    : rankOf(card) === rankOf(col[col.length - 1]) - 1 && isRed(card) !== isRed(col[col.length - 1]);

/** A card is safe to send home when nothing still on the table could need it: both
 *  opposite-colour foundations are already at least one rank behind it. Playing these
 *  automatically never costs a win, and it prunes enormous amounts of search. */
function safeToFoundation(s: State, id: number): boolean {
  const rank = rankOf(id);
  if (rank <= 2) return true;
  const red = isRed(id);
  const opposite = red ? [0, 3] : [1, 2];
  return opposite.every((suit) => s.found[suit] >= rank - 1);
}

/** Every legal move from this position.
 *
 *  `prune` drops moves that are legal but provably pointless — currently only shifting
 *  a whole column onto an empty one, which just swaps two interchangeable columns and
 *  is the classic way a Klondike search spins forever. It is safe for the "unwinnable"
 *  claim because `key()` already collapses those two positions into one, so the search
 *  was never going to learn anything new down that branch. Tests call it with
 *  `prune: false` to compare the *complete* move set against game.ts. */
export function legalMoves(s: State, { prune = true }: { prune?: boolean } = {}): Move[] {
  const moves: Move[] = [];
  const wasteTop = s.waste.length ? s.waste[s.waste.length - 1] : -1;

  // Foundations first: cheap, and usually progress.
  if (wasteTop >= 0 && s.found[suitOf(wasteTop)] === rankOf(wasteTop) - 1) {
    moves.push({ kind: "wasteToFoundation" });
  }
  for (let c = 0; c < 7; c++) {
    const col = s.up[c];
    if (!col.length) continue;
    const top = col[col.length - 1];
    if (s.found[suitOf(top)] === rankOf(top) - 1) moves.push({ kind: "tableauToFoundation", col: c });
  }

  // Tableau → tableau. Only the deepest legal start is tried for a move onto an empty
  // column: shuffling part of a run between empties is never progress, and it is the
  // classic way a Klondike search loops forever.
  for (let from = 0; from < 7; from++) {
    const starts = runStarts(s.up[from]);
    for (const start of starts) {
      const card = s.up[from][start];
      const movingWholeColumn = start === 0 && s.down[from].length === 0;
      for (let to = 0; to < 7; to++) {
        if (to === from) continue;
        if (!acceptsOnTableau(s.up[to], card)) continue;
        // Moving a whole column onto an empty one just renames it.
        if (prune && movingWholeColumn && s.up[to].length === 0) continue;
        moves.push({ kind: "tableauToTableau", from, to, count: s.up[from].length - start });
      }
    }
  }

  if (wasteTop >= 0) {
    for (let c = 0; c < 7; c++) {
      if (acceptsOnTableau(s.up[c], wasteTop)) moves.push({ kind: "wasteToTableau", col: c });
    }
  }

  // Foundation → tableau. Almost never useful, but legal, and leaving it out would
  // let the search call a winnable board dead. That includes onto an **empty** column:
  // the `s.up[c].length &&` guard this once had quietly excluded pulling a King back
  // off a foundation to open a base, which is exactly the case that makes some boards
  // winnable at all.
  for (let suit = 0; suit < 4; suit++) {
    const rank = s.found[suit];
    if (rank === 0) continue;
    const id = suit * 13 + rank - 1;
    // Empty columns are interchangeable, so this card only needs to be offered one of
    // them — but the flag is **per card**, not shared across suits. Sharing it means
    // only the lowest-numbered foundation ever gets an empty column, and if that card
    // is the wrong colour for what needs a base, the winning line is invisible.
    let emptyOffered = false;
    for (let c = 0; c < 7; c++) {
      if (!acceptsOnTableau(s.up[c], id)) continue;
      const bareColumn = s.up[c].length === 0 && s.down[c].length === 0;
      if (prune && bareColumn && emptyOffered) continue;
      moves.push({ kind: "foundationToTableau", suit, col: c });
      if (bareColumn) emptyOffered = true;
    }
  }

  if (s.stock.length) moves.push({ kind: "draw" });
  else if (s.waste.length) moves.push({ kind: "recycle" });

  return moves;
}

/** Apply a move, returning what's needed to undo it exactly. */
interface Undo {
  move: Move;
  /** Cards moved between stock and waste, for draw / recycle. */
  drawn: number;
  /** The card that went to a foundation, so `revert` can put it back. */
  card: number;
  /** Whether the move turned a face-down card up, which reverting must put back down. */
  flipped: boolean;
}

function apply(s: State, move: Move): Undo {
  const undo: Undo = { move, drawn: 0, card: -1, flipped: false };
  switch (move.kind) {
    case "draw": {
      const n = Math.min(s.drawCount, s.stock.length);
      for (let i = 0; i < n; i++) s.waste.push(s.stock.pop()!);
      undo.drawn = n;
      break;
    }
    case "recycle": {
      undo.drawn = s.waste.length;
      while (s.waste.length) s.stock.push(s.waste.pop()!);
      break;
    }
    case "wasteToFoundation": {
      const id = s.waste.pop()!;
      s.found[suitOf(id)] = rankOf(id);
      undo.card = id;
      break;
    }
    case "wasteToTableau": {
      s.up[move.col].push(s.waste.pop()!);
      break;
    }
    case "tableauToFoundation": {
      const id = s.up[move.col].pop()!;
      s.found[suitOf(id)] = rankOf(id);
      undo.card = id;
      undo.flipped = flipIfNeeded(s, move.col);
      break;
    }
    case "tableauToTableau": {
      const moving = s.up[move.from].splice(s.up[move.from].length - move.count, move.count);
      s.up[move.to].push(...moving);
      undo.flipped = flipIfNeeded(s, move.from);
      break;
    }
    case "foundationToTableau": {
      const rank = s.found[move.suit];
      s.found[move.suit] = rank - 1;
      s.up[move.col].push(move.suit * 13 + rank - 1);
      break;
    }
  }
  return undo;
}

/** Turning up the newly exposed card is part of the move, exactly as in game.ts. */
function flipIfNeeded(s: State, col: number): boolean {
  if (s.up[col].length === 0 && s.down[col].length > 0) {
    s.up[col].push(s.down[col].pop()!);
    return true;
  }
  return false;
}

/** Exactly undo `apply`. The search reverts far more often than it advances, so this
 *  restores in place rather than copying the state. */
function revert(s: State, u: Undo): void {
  const move = u.move;
  // Put a turned-up card back down first: it was exposed *by* the move, so it has to
  // go before the moved cards come back on top of it.
  if (u.flipped) {
    const col = move.kind === "tableauToTableau" ? move.from : (move as { col: number }).col;
    s.down[col].push(s.up[col].pop()!);
  }
  switch (move.kind) {
    case "draw":
      for (let i = 0; i < u.drawn; i++) s.stock.push(s.waste.pop()!);
      break;
    case "recycle":
      for (let i = 0; i < u.drawn; i++) s.waste.push(s.stock.pop()!);
      break;
    case "wasteToFoundation":
      s.found[suitOf(u.card)] = rankOf(u.card) - 1;
      s.waste.push(u.card);
      break;
    case "wasteToTableau":
      s.waste.push(s.up[move.col].pop()!);
      break;
    case "tableauToFoundation":
      s.found[suitOf(u.card)] = rankOf(u.card) - 1;
      s.up[move.col].push(u.card);
      break;
    case "tableauToTableau": {
      const moving = s.up[move.to].splice(s.up[move.to].length - move.count, move.count);
      s.up[move.from].push(...moving);
      break;
    }
    case "foundationToTableau":
      s.up[move.col].pop();
      s.found[move.suit] += 1;
      break;
  }
}

// ---- Search ----------------------------------------------------------------

/** A canonical key. Tableau columns are interchangeable, so their signatures are
 *  sorted: two positions that differ only by which column a run sits in are the same
 *  position, and collapsing them is a large part of why this terminates. */
function key(s: State): string {
  const cols: string[] = [];
  for (let c = 0; c < 7; c++) cols.push(`${s.down[c].length}:${s.up[c].join(",")}`);
  cols.sort();
  return `${s.found.join(",")}|${cols.join("/")}|${s.stock.join(",")}|${s.waste.join(",")}`;
}

const DEFAULT_MAX_NODES = 200_000;

/** Search a position. Sound in both directions within the budget: `solved` comes with
 *  a line that wins, `unwinnable` means the complete move set was exhausted, and
 *  anything cut short by the budget is `unknown`. */
export function solve(state: GameState, opts: { maxNodes?: number } = {}): SolveResult {
  if (!canAnalyse(state)) return { outcome: "unknown", moves: [], nodes: 0 };

  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
  const s = toState(state);
  const seen = new Set<string>();
  const line: Move[] = [];
  let nodes = 0;
  let exhausted = false;

  const search = (): boolean => {
    if (isWon(s)) return true;
    if (nodes >= maxNodes) {
      exhausted = true;
      return false;
    }
    nodes++;

    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);

    // Forced-safe autoplay: if a card can go home and nothing on the table could still
    // need it, play it and don't branch. Never loses a win, and prunes hard.
    for (const move of legalMoves(s)) {
      const id =
        move.kind === "wasteToFoundation"
          ? s.waste[s.waste.length - 1]
          : move.kind === "tableauToFoundation"
            ? s.up[move.col][s.up[move.col].length - 1]
            : -1;
      if (id >= 0 && safeToFoundation(s, id)) {
        const u = apply(s, move);
        line.push(move);
        if (search()) return true;
        line.pop();
        revert(s, u);
        return false;
      }
    }

    for (const move of order(s, legalMoves(s))) {
      const u = apply(s, move);
      line.push(move);
      if (search()) return true;
      line.pop();
      revert(s, u);
      if (exhausted) return false;
    }
    return false;
  };

  const solved = search();
  return {
    outcome: solved ? "solved" : exhausted ? "unknown" : "unwinnable",
    moves: solved ? [...line] : [],
    nodes,
  };
}

/** Try the moves most likely to lead somewhere first: foundations, then anything that
 *  turns a card up or empties a column, then the rest, with drawing last. */
function order(s: State, moves: Move[]): Move[] {
  const rank = (m: Move): number => {
    switch (m.kind) {
      case "tableauToFoundation":
      case "wasteToFoundation":
        return 0;
      case "tableauToTableau":
        return s.up[m.from].length === m.count && s.down[m.from].length > 0 ? 1 : 3;
      case "wasteToTableau":
        return 2;
      case "draw":
        return 4;
      case "recycle":
        return 5;
      case "foundationToTableau":
        return 6;
    }
  };
  return [...moves].sort((a, b) => rank(a) - rank(b));
}
