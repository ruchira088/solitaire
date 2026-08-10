// The keyboard cursor: which pile is focused, how deep into it, and how to say that
// out loud. Pure — it reads a Game but never touches the DOM, the canvas or the
// layout, so the navigation rules and the spoken descriptions are unit-testable.
//
// The board is treated as two rows, matching the landscape layout: the top row is
// stock, waste and the four foundations; the board row is the seven tableau columns
// followed by any ✦ stacks. Left/right walk a row and wrap; up/down swap rows, keeping
// the nearest column. Portrait transposes the board visually, but a phone has no
// arrow keys, so the rows stay defined the landscape way rather than following the
// pixels around.

import { Card } from "./cards";
import { Game, PileId } from "./game";

export interface Cursor {
  pile: PileId;
  /** Index into the pile of the card the cursor points at — the *bottom* of the run
   *  that would be picked up. Always `length - 1` (the top card) for piles you can
   *  only take one card from, and 0 for an empty pile. */
  depth: number;
}

export type Move = "left" | "right" | "up" | "down" | "deeper" | "shallower";

export function samePile(a: PileId, b: PileId): boolean {
  if (a.kind !== b.kind) return false;
  return "index" in a && "index" in b ? a.index === b.index : true;
}

/** Piles you can take a multi-card run from; everywhere else the cursor sits on top. */
function isColumn(pile: PileId): boolean {
  return pile.kind === "tableau" || pile.kind === "spare";
}

export function topRow(): PileId[] {
  return [
    { kind: "stock" },
    { kind: "waste" },
    ...[0, 1, 2, 3].map((index): PileId => ({ kind: "foundation", index })),
  ];
}

export function boardRow(game: Game): PileId[] {
  return [
    ...Array.from({ length: 7 }, (_, index): PileId => ({ kind: "tableau", index })),
    ...game.spares.map((_, index): PileId => ({ kind: "spare", index })),
  ];
}

function locate(game: Game, pile: PileId): { row: PileId[]; index: number; isTop: boolean } {
  const top = topRow();
  const i = top.findIndex((p) => samePile(p, pile));
  if (i >= 0) return { row: top, index: i, isTop: true };
  const board = boardRow(game);
  const j = board.findIndex((p) => samePile(p, pile));
  // A ✦ stack can vanish under the cursor when it empties, so fall back to a column
  // rather than trusting the lookup.
  return { row: board, index: j >= 0 ? j : 0, isTop: false };
}

/** The shallowest index a legal run can start from: the first face-up card whose
 *  run to the bottom of the pile is valid. Equals the top card when only one card
 *  can move, so callers don't need to special-case anything. */
export function minDepth(game: Game, pile: PileId): number {
  const cards = game.getPile(pile);
  if (cards.length === 0) return 0;
  const top = cards.length - 1;
  if (!isColumn(pile)) return top;
  let best = top;
  for (let i = top; i >= 0; i--) {
    if (!cards[i].faceUp) break;
    if (game.isValidRun(cards.slice(i))) best = i;
  }
  return best;
}

/** Snap a cursor back onto something real. Piles shrink, grow and disappear under it —
 *  a ✦ stack empties, a run moves away — so this runs after every change rather than
 *  trusting the stored depth. */
export function clampCursor(game: Game, cursor: Cursor): Cursor {
  const board = boardRow(game);
  let pile = cursor.pile;
  if (pile.kind === "spare" && pile.index >= game.spares.length) {
    pile = board[Math.min(6, board.length - 1)]; // its column is gone; fall back
  }
  const cards = game.getPile(pile);
  if (cards.length === 0) return { pile, depth: 0 };
  const lo = minDepth(game, pile);
  const hi = cards.length - 1;
  return { pile, depth: Math.min(hi, Math.max(lo, cursor.depth)) };
}

export function moveCursor(game: Game, cursor: Cursor, move: Move): Cursor {
  const { row, index, isTop } = locate(game, cursor.pile);

  if (move === "left" || move === "right") {
    const step = move === "left" ? -1 : 1;
    const next = (index + step + row.length) % row.length;
    return clampCursor(game, { pile: row[next], depth: Number.MAX_SAFE_INTEGER });
  }

  if (move === "up" || move === "down") {
    const wantTop = move === "up";
    if (wantTop === isTop) return cursor; // already on that row
    const other = wantTop ? topRow() : boardRow(game);
    const next = other[Math.min(index, other.length - 1)];
    return clampCursor(game, { pile: next, depth: Number.MAX_SAFE_INTEGER });
  }

  // Grab depth: "deeper" takes more cards with it, "shallower" fewer.
  if (!isColumn(cursor.pile)) return cursor;
  const step = move === "deeper" ? -1 : 1;
  return clampCursor(game, { pile: cursor.pile, depth: cursor.depth + step });
}

// ---- Speech ----------------------------------------------------------------

const RANK_WORD: Record<number, string> = {
  1: "ace",
  11: "jack",
  12: "queen",
  13: "king",
};

export function cardName(card: Card): string {
  return `${RANK_WORD[card.rank] ?? String(card.rank)} of ${card.suit}`;
}

/** Foundations are **not** suit-locked: `canMoveToFoundation` lets any ace start any
 *  of them, and the suit is then whatever landed there. So a foundation is named for
 *  the cards on it and numbered while it is empty — calling an empty one "the spades
 *  foundation" (as the decorative placeholder glyph implies) would promise a rule the
 *  game doesn't have. */
export function pileName(game: Game, pile: PileId): string {
  switch (pile.kind) {
    case "stock":
      return "stock";
    case "waste":
      return "waste";
    case "foundation": {
      const cards = game.foundations[pile.index];
      return cards.length ? `${cards[cards.length - 1].suit} foundation` : `foundation ${pile.index + 1}`;
    }
    case "tableau":
      return `column ${pile.index + 1}`;
    case "spare":
      return `stack ${pile.index + 1}`;
  }
}

/** What the live region says when the cursor lands somewhere. Short and front-loaded:
 *  a screen reader reads it on every move, so the pile comes first and the detail
 *  after. */
export function describe(game: Game, cursor: Cursor): string {
  const cards = game.getPile(cursor.pile);
  const where = pileName(game, cursor.pile);
  if (cards.length === 0) return `${where}, empty`;

  if (cursor.pile.kind === "stock") {
    return `${where}, ${cards.length} card${cards.length === 1 ? "" : "s"} face down`;
  }

  const card = cards[cursor.depth];
  if (!card) return `${where}, empty`;
  if (!card.faceUp) return `${where}, face down`;

  const run = cards.length - cursor.depth;
  const hidden = cards.filter((c) => !c.faceUp).length;
  const parts = [`${where}, ${cardName(card)}`];
  if (run > 1) parts.push(`run of ${run}`);
  if (hidden > 0) parts.push(`${hidden} face down`);
  return parts.join(", ");
}

/** What a lifted run is called: one card by name, several by count and the card they
 *  start from. Shared by the pick-up and the move announcements, so the same cards are
 *  described the same way both times. */
export function runName(cards: Card[]): string {
  if (cards.length === 0) return "nothing";
  return cards.length === 1
    ? cardName(cards[0])
    : `${cards.length} cards from ${cardName(cards[0])}`;
}

/** Announced after a move actually happens, so the player hears the outcome rather
 *  than having to re-read the board. */
export function describeMove(game: Game, moved: Card[], to: PileId, flipped: Card | null): string {
  const tail = flipped ? `, turned up ${cardName(flipped)}` : "";
  return `moved ${runName(moved)} to ${pileName(game, to)}${tail}`;
}
