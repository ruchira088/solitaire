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
      return {
        x: layout.waste.x + fanIndex * layout.wasteFan.x,
        y: layout.waste.y + fanIndex * layout.wasteFan.y,
      };
    }
    case "foundation":
      return { ...layout.foundations[id.index] };
    case "tableau":
    case "spare": {
      const spare = id.kind === "spare";
      const base = spare ? layout.spares[id.index] : layout.tableau[id.index];
      const limit = spare ? layout.spareFanLimit : layout.fanLimit;
      const offsets = columnOffsets(game.getPile(id), layout, layout.fanX ? base.x : base.y, limit);
      const d = offsets[index] ?? (offsets.length ? offsets[offsets.length - 1] : 0);
      return layout.fanX ? { x: base.x + d, y: base.y } : { x: base.x, y: base.y + d };
    }
  }
}

/** Bounding rectangle used as a pile's drop / hit zone. */
export function pileRect(game: Game, layout: Layout, id: PileId): Rect {
  const { cardW, cardH } = layout;
  if (id.kind === "tableau" || id.kind === "spare") {
    const spare = id.kind === "spare";
    const base = spare ? layout.spares[id.index] : layout.tableau[id.index];
    const col = game.getPile(id);
    if (col.length === 0) return { x: base.x, y: base.y, w: cardW, h: cardH };
    const limit = spare ? layout.spareFanLimit : layout.fanLimit;
    const offsets = columnOffsets(col, layout, layout.fanX ? base.x : base.y, limit);
    const last = offsets[offsets.length - 1];
    return layout.fanX
      ? { x: base.x, y: base.y, w: last + cardW, h: cardH }
      : { x: base.x, y: base.y, w: cardW, h: last + cardH };
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

/** Which card index within a fanned stack sits under (px,py), or -1. */
function stackCardAt(
  cards: { faceUp: boolean }[],
  base: Point,
  layout: Layout,
  px: number,
  py: number,
  limit = layout.fanLimit,
): number {
  if (cards.length === 0) return -1;
  const fanX = layout.fanX;
  const cross = fanX ? py - base.y : px - base.x;
  if (cross < 0 || cross > (fanX ? layout.cardH : layout.cardW)) return -1;
  const fanBase = fanX ? base.x : base.y;
  const p = fanX ? px : py;
  const offsets = columnOffsets(cards, layout, fanBase, limit);
  // Search top-most (last) card first.
  for (let i = cards.length - 1; i >= 0; i--) {
    const lo = fanBase + offsets[i];
    const hi =
      i === cards.length - 1
        ? lo + (fanX ? layout.cardW : layout.cardH)
        : fanBase + offsets[i + 1];
    if (p >= lo && p <= hi) return i;
  }
  return -1;
}

/** Which card index within a tableau column sits under (px,py), or -1. */
export function tableauCardAt(
  game: Game,
  layout: Layout,
  col: number,
  px: number,
  py: number,
): number {
  return stackCardAt(game.tableau[col], layout.tableau[col], layout, px, py);
}

/** Which card index within a temp stack sits under (px,py), or -1. */
export function spareCardAt(
  game: Game,
  layout: Layout,
  spareIndex: number,
  px: number,
  py: number,
): number {
  return stackCardAt(game.spares[spareIndex], layout.spares[spareIndex], layout, px, py, layout.spareFanLimit);
}
