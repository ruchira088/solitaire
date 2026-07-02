// Geometry helpers shared by input (hit-testing) and rendering (animation
// targets). Keeping these in one place ensures the model, the visuals, and the
// pointer math all agree on where every card lives.

import { Game, PileId } from "./game";
import { columnOffsets, Layout, Point } from "./layout";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Top-left position of the card at `index` within the given pile. */
export function cardPos(
  game: Game,
  layout: Layout,
  id: PileId,
  index: number,
): Point {
  switch (id.kind) {
    case "stock":
      return { ...layout.stock };
    case "waste": {
      const len = game.waste.length;
      const fanStart = Math.max(0, len - game.drawCount);
      const fanIndex = Math.max(0, index - fanStart);
      return { x: layout.waste.x + fanIndex * layout.wasteFanDX, y: layout.waste.y };
    }
    case "foundation":
      return { ...layout.foundations[id.index] };
    case "tableau": {
      const base = layout.tableau[id.index];
      const offsets = columnOffsets(game.tableau[id.index], layout);
      const dy = offsets[index] ?? (offsets.length ? offsets[offsets.length - 1] : 0);
      return { x: base.x, y: base.y + dy };
    }
  }
}

/** Bounding rectangle used as a pile's drop / hit zone. */
export function pileRect(game: Game, layout: Layout, id: PileId): Rect {
  const { cardW, cardH } = layout;
  if (id.kind === "tableau") {
    const base = layout.tableau[id.index];
    const col = game.tableau[id.index];
    if (col.length === 0) return { x: base.x, y: base.y, w: cardW, h: cardH };
    const offsets = columnOffsets(col, layout);
    const last = offsets[offsets.length - 1];
    return { x: base.x, y: base.y, w: cardW, h: last + cardH };
  }
  const p = cardPos(game, layout, id, game.getPile(id).length - 1);
  return { x: p.x, y: p.y, w: cardW, h: cardH };
}

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

/** Overlap area between two rects (0 if disjoint). */
export function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/** Which card index within a tableau column sits under (px,py), or -1. */
export function tableauCardAt(
  game: Game,
  layout: Layout,
  col: number,
  px: number,
  py: number,
): number {
  const base = layout.tableau[col];
  const cards = game.tableau[col];
  if (cards.length === 0) return -1;
  if (px < base.x || px > base.x + layout.cardW) return -1;
  const offsets = columnOffsets(cards, layout);
  // Search top-most (last) card first.
  for (let i = cards.length - 1; i >= 0; i--) {
    const top = base.y + offsets[i];
    const bottom = i === cards.length - 1 ? top + layout.cardH : base.y + offsets[i + 1];
    if (py >= top && py <= bottom) return i;
  }
  return -1;
}
