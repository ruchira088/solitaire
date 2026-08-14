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

import { GameState, PileId } from "./game";

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

/** Where a move starts and ends in the *game's* terms, which is what the board can
 *  point at. */
export interface GameMove {
  from: PileId;
  /** Index into the source pile of the first card that moves. */
  fromIndex: number;
  to: PileId;
}

/** Which foundation pile would take this card. The search tracks foundations per suit
 *  because that's canonical, but the game's four piles aren't suit-locked — any ace can
 *  start any of them — so the pile has to be found by asking which one accepts it,
 *  exactly as `foundationTargetFor` does. */
function foundationHolding(state: GameState, suit: number): number {
  for (let i = 0; i < 4; i++) {
    const pile = state.foundations[i];
    if (pile.length > 0 && suitOf(pile[pile.length - 1] % 52) === suit) return i;
  }
  return -1;
}

function foundationAccepting(state: GameState, id: number): number {
  for (let i = 0; i < 4; i++) {
    const pile = state.foundations[i];
    if (pile.length === 0) {
      if (rankOf(id) === 1) return i;
      continue;
    }
    const top = pile[pile.length - 1] % 52;
    if (suitOf(top) === suitOf(id) && rankOf(top) === rankOf(id) - 1) return i;
  }
  return -1;
}

/** Translate a search move into the piles the board draws, so a hint can be shown on
 *  it. Returns null if the move doesn't fit the position — which shouldn't happen for a
 *  line the search just produced from this very state, but the caller is pointing at
 *  the player's board and a wrong arrow is worse than no arrow. */
export function toGameMove(state: GameState, m: Move): GameMove | null {
  const last = (p: number[]): number => p.length - 1;
  switch (m.kind) {
    case "draw":
      return state.stock.length === 0
        ? null
        : { from: { kind: "stock" }, fromIndex: last(state.stock), to: { kind: "waste" } };
    case "recycle":
      return state.waste.length === 0
        ? null
        : { from: { kind: "waste" }, fromIndex: 0, to: { kind: "stock" } };
    case "wasteToTableau":
      return state.waste.length === 0
        ? null
        : {
            from: { kind: "waste" },
            fromIndex: last(state.waste),
            to: { kind: "tableau", index: m.col },
          };
    case "wasteToFoundation": {
      if (state.waste.length === 0) return null;
      const index = foundationAccepting(state, state.waste[last(state.waste)] % 52);
      return index < 0
        ? null
        : { from: { kind: "waste" }, fromIndex: last(state.waste), to: { kind: "foundation", index } };
    }
    case "tableauToFoundation": {
      const col = state.tableau[m.col];
      if (!col?.length) return null;
      const index = foundationAccepting(state, col[last(col)] % 52);
      return index < 0
        ? null
        : {
            from: { kind: "tableau", index: m.col },
            fromIndex: last(col),
            to: { kind: "foundation", index },
          };
    }
    case "tableauToTableau": {
      const col = state.tableau[m.from];
      const fromIndex = (col?.length ?? 0) - m.count;
      return fromIndex < 0
        ? null
        : {
            from: { kind: "tableau", index: m.from },
            fromIndex,
            to: { kind: "tableau", index: m.to },
          };
    }
    case "foundationToTableau": {
      const index = foundationHolding(state, m.suit);
      return index < 0
        ? null
        : {
            from: { kind: "foundation", index },
            fromIndex: last(state.foundations[index]),
            to: { kind: "tableau", index: m.col },
          };
    }
  }
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

/** One printable character per card. The visited set *is* the search's memory
 *  footprint — one entry per node explored — so the length of this string is what
 *  decides whether a deep search fits in a phone's tab or takes it down with it.
 *  Cards are 0..51, so 35 + id lands inside '#'..'V' and never collides with the
 *  separators below. A decimal-with-commas key ran ~150 characters; this one is
 *  ~65, and it hashes faster for being shorter. */
const CH = (n: number): string => String.fromCharCode(35 + n);
/** Between the sections, and between columns. Card characters start at 35, so these
 *  can never be read as one — and they have to be there: a column's length isn't
 *  otherwise recoverable from the run of characters, and two different positions
 *  sharing a key is the one mistake this set must never make. */
const SEP = String.fromCharCode(1);
const COL_SEP = String.fromCharCode(2);

/** A canonical key. Tableau columns are interchangeable, so their signatures are
 *  sorted: two positions that differ only by which column a run sits in are the same
 *  position, and collapsing them is a large part of why this terminates.
 *
 *  A column contributes its face-down *count* rather than its face-down cards, which
 *  is lossless here: those cards never move, only get revealed, so a column's hidden
 *  stack is fixed by the deal. Two columns can only produce the same signature if
 *  their face-up cards are identical — impossible unless both are empty, and an empty
 *  face-up half with cards still face down can't occur, because `flipIfNeeded` turns
 *  one up as part of the move that emptied it. */
function key(s: State): string {
  const cols: string[] = [];
  for (let c = 0; c < 7; c++) {
    let sig = CH(s.down[c].length);
    for (const id of s.up[c]) sig += CH(id);
    cols.push(sig);
  }
  cols.sort();
  let k = CH(s.found[0]) + CH(s.found[1]) + CH(s.found[2]) + CH(s.found[3]);
  k += SEP + cols.join(COL_SEP) + SEP;
  for (const id of s.stock) k += CH(id);
  k += SEP;
  for (const id of s.waste) k += CH(id);
  return k;
}

const DEFAULT_MAX_NODES = 200_000;

/** How many visited positions to remember. Forgetting one only costs pruning — the
 *  search re-explores a branch it has seen — so this bounds memory without ever
 *  changing an answer, which a lossy *hash* of the key would not: two positions
 *  colliding would prune an unexplored branch and could call a winnable board dead.
 *  Sized so a search at several times the default budget still fits comfortably in a
 *  phone's tab, where an unbounded set measured over 400 MB. */
const SEEN_CAP = 600_000;

/** A ceiling on how deep the line may go. Treated exactly like the node budget, so
 *  hitting it reports `unknown` and never `unwinnable`.
 *
 *  This bounds *memory* — one move list per level — and nothing else, because the
 *  search below keeps its own stack rather than recursing. It used to recurse, and the
 *  depth limit was load-bearing: a search deep enough threw `RangeError: Maximum call
 *  stack size exceeded` instead of returning an answer. Sizing that limit was guesswork
 *  in the worst way, since the ceiling isn't ours — a worker's stack is smaller than
 *  the main thread's, and both are smaller than Node's, so a value verified locally
 *  still died in CI's browser. The longest winning line measured over 40 deals is 559
 *  moves, so any cap low enough to be *safe* against an unknown stack was in danger of
 *  being low enough to lose real solutions. An explicit stack has no such ceiling. */
const MAX_DEPTH = 2_000;

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

  /** One entered position: the moves still to try from it, and how to leave it. `undo`
   *  is null only for the root, which nothing has to step back out of. */
  interface Level {
    moves: Move[];
    next: number;
    undo: Undo | null;
  }
  const stack: Level[] = [];

  /** Step into the position the board is now in. Returns whether it won, is a dead end
   *  (already seen, or out of budget), or has been pushed with moves to try. */
  const enter = (undo: Undo | null): "won" | "dead" | "open" => {
    if (isWon(s)) return "won";
    if (nodes >= maxNodes || stack.length >= MAX_DEPTH) {
      exhausted = true;
      return "dead";
    }
    nodes++;

    const k = key(s);
    if (seen.has(k)) return "dead";
    // Past the cap, stop remembering rather than stop searching: a forgotten position
    // costs re-exploration, never an answer.
    if (seen.size < SEEN_CAP) seen.add(k);

    // One move list per node, shared by the autoplay scan and the branching below.
    // Generating it twice was a second full allocation on the hottest path in the
    // search, for an identical list.
    const moves = legalMoves(s);

    // Forced-safe autoplay: if a card can go home and nothing on the table could still
    // need it, play it and don't branch — the level gets that one move and no other.
    // Never loses a win, and prunes hard.
    for (const move of moves) {
      const id =
        move.kind === "wasteToFoundation"
          ? s.waste[s.waste.length - 1]
          : move.kind === "tableauToFoundation"
            ? s.up[move.col][s.up[move.col].length - 1]
            : -1;
      if (id >= 0 && safeToFoundation(s, id)) {
        stack.push({ moves: [move], next: 0, undo });
        return "open";
      }
    }

    stack.push({ moves: order(s, moves), next: 0, undo });
    return "open";
  };

  let solved = enter(null) === "won";
  while (!solved && stack.length > 0) {
    const level = stack[stack.length - 1];
    // Out of moves here, or the budget ran out mid-search: step back out. Reverting on
    // the way up is what lets the next branch start from a clean board.
    if (exhausted || level.next >= level.moves.length) {
      stack.pop();
      if (level.undo) {
        line.pop();
        revert(s, level.undo);
      }
      continue;
    }
    const move = level.moves[level.next++];
    const undo = apply(s, move);
    line.push(move);
    const result = enter(undo);
    if (result === "won") {
      solved = true;
    } else if (result === "dead") {
      // Nothing was pushed, so unwind this one move here rather than on the way up.
      line.pop();
      revert(s, undo);
    }
  }
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
