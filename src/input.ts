// Pointer interaction: drag & drop of cards/runs, click-to-draw, and
// double-click / double-tap to auto-send a card to its foundation. Owns the
// live drag state (read by the renderer) and drives move animations.

import { Card } from "./cards";
import { Game, MoveResult, PileId } from "./game";
import { Animator, Easings } from "./animation";
import { Layout, Point } from "./layout";
import { DragState } from "./render";
import {
  cardPos,
  overlapArea,
  pileRect,
  pointInRect,
  Rect,
  spareCardAt,
  tableauCardAt,
} from "./positions";
import { playDraw, playFlip, playPlace } from "./sound";
import { samePile } from "./cursor";

const DRAG_THRESHOLD = 6; // px before a press becomes a drag
const DOUBLE_TAP_MS = 320;

export interface InputCallbacks {
  layout: () => Layout;
  busy: () => boolean; // ignore input while true (dealing / celebrating)
  onChange: () => void; // a successful state change occurred
}

export class Input {
  drag: DragState | null = null;

  private canvas: HTMLCanvasElement;
  private game: Game;
  private animator: Animator;
  private cb: InputCallbacks;

  private pointerId: number | null = null;
  private downPos: Point = { x: 0, y: 0 };
  private startedDrag = false;
  private pickOrigins: Point[] = []; // source positions for snap-back
  private lastTap = { time: 0, x: 0, y: 0 };
  private cursor = "default";
  private lastHover: Point = { x: -1, y: -1 };

  constructor(
    canvas: HTMLCanvasElement,
    game: Game,
    animator: Animator,
    cb: InputCallbacks,
  ) {
    this.canvas = canvas;
    this.game = game;
    this.animator = animator;
    this.cb = cb;

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("dblclick", this.onDblClick);
    canvas.addEventListener("pointerleave", this.onLeave);
    // A right-press over the board would otherwise start a drag and pop the OS menu
    // on top of it.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private eventPos(e: PointerEvent | MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---- Pointer handlers --------------------------------------------------

  private onDown = (e: PointerEvent): void => {
    if (this.cb.busy()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return; // primary button only
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.downPos = this.eventPos(e);
    this.startedDrag = false;

    const pick = this.hitPickable(this.downPos);
    if (pick) {
      const layout = this.cb.layout();
      const origin = cardPos(this.game, layout, pick.from, pick.index);
      this.drag = {
        cards: pick.cards,
        from: pick.from,
        pointer: { ...this.downPos },
        offset: { x: this.downPos.x - origin.x, y: this.downPos.y - origin.y },
        target: null,
      };
      this.pickOrigins = pick.cards.map((_, i) =>
        cardPos(this.game, layout, pick.from, pick.index + i),
      );
      this.setCursor("grabbing");
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.pointerId === null) {
      this.onHover(e);
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const p = this.eventPos(e);
    if (!this.startedDrag) {
      const dx = p.x - this.downPos.x;
      const dy = p.y - this.downPos.y;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) this.startedDrag = true;
    }
    if (this.drag) this.drag.pointer = p;
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const p = this.eventPos(e);
    this.release();
    this.setCursor("default");

    if (this.drag && this.startedDrag) {
      this.dropDrag(p);
    } else {
      this.handleTap(p, e.pointerType === "touch");
    }
    this.drag = null;
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.cancelDrag();
  };

  private onLeave = (): void => {
    if (this.pointerId === null) this.setCursor("default");
  };

  /** Abort a live drag, flying the cards home. True if there was one — so callers
   *  can tell whether Escape was consumed. */
  cancelDrag(): boolean {
    this.release();
    if (!this.drag) {
      this.setCursor("default");
      return false;
    }
    this.snapBack();
    this.drag = null;
    this.startedDrag = false;
    this.setCursor("default");
    return true;
  }

  /** Recompute the live drop target from the stored pointer. Driven once per frame
   *  by the game loop rather than from pointermove: a high-rate mouse fires several
   *  times per frame and would just recompute the same answer. */
  updateDropTarget(): void {
    const d = this.drag;
    if (!d) return;
    d.target = this.startedDrag
      ? this.bestTarget(this.dragTopRect(d, this.cb.layout()), d.from)
      : null; // a stationary press shouldn't glow
  }

  private dragTopRect(drag: DragState, layout: Layout): Rect {
    return {
      x: drag.pointer.x - drag.offset.x,
      y: drag.pointer.y - drag.offset.y,
      w: layout.cardW,
      h: layout.cardH,
    };
  }

  private onHover(e: PointerEvent): void {
    if (e.pointerType !== "mouse") return; // touch and pen have no hover state
    const p = this.eventPos(e);
    if (Math.hypot(p.x - this.lastHover.x, p.y - this.lastHover.y) < 3) return;
    this.lastHover = p;
    if (this.cb.busy()) {
      this.setCursor("default");
      return;
    }
    const layout = this.cb.layout();
    if (this.hitPickable(p)) this.setCursor("grab");
    else if (pointInRect(p.x, p.y, { ...layout.stock, w: layout.cardW, h: layout.cardH })) {
      this.setCursor("pointer"); // the stock is a click action, not a grab
    } else this.setCursor("default");
  }

  private setCursor(c: string): void {
    if (this.cursor === c) return;
    this.cursor = c;
    this.canvas.style.cursor = c;
  }

  private onDblClick = (e: MouseEvent): void => {
    if (this.cb.busy()) return;
    this.tryAutoMove(this.eventPos(e));
  };

  private release(): void {
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
  }

  // ---- Hit testing -------------------------------------------------------

  private hitPickable(
    p: Point,
  ): { from: PileId; index: number; cards: Card[] } | null {
    const layout = this.cb.layout();
    const g = this.game;

    // Tableau columns (top-most cards take priority since they overlap).
    for (let c = 0; c < 7; c++) {
      const idx = tableauCardAt(g, layout, c, p.x, p.y);
      if (idx >= 0) {
        const col = g.tableau[c];
        const card = col[idx];
        if (!card.faceUp) return null;
        const run = col.slice(idx);
        if (!g.isValidRun(run)) return null;
        return { from: { kind: "tableau", index: c }, index: idx, cards: run };
      }
    }

    // Temp stacks — any suffix of a parked run can be picked up.
    for (let s = 0; s < g.spares.length; s++) {
      const idx = spareCardAt(g, layout, s, p.x, p.y);
      if (idx >= 0) {
        const run = g.spares[s].slice(idx);
        if (!g.isValidRun(run)) return null;
        return { from: { kind: "spare", index: s }, index: idx, cards: run };
      }
    }

    // Waste top card.
    if (g.waste.length > 0) {
      const top = g.waste.length - 1;
      if (pointInRect(p.x, p.y, this.cardRect(layout, { kind: "waste" }, top))) {
        return { from: { kind: "waste" }, index: top, cards: [g.waste[top]] };
      }
    }

    // Foundation top cards (can be dragged back down).
    for (let i = 0; i < 4; i++) {
      const pile = g.foundations[i];
      if (pile.length === 0) continue;
      const top = pile.length - 1;
      if (pointInRect(p.x, p.y, this.cardRect(layout, { kind: "foundation", index: i }, top))) {
        return { from: { kind: "foundation", index: i }, index: top, cards: [pile[top]] };
      }
    }
    return null;
  }

  private cardRect(layout: Layout, id: PileId, index: number): Rect {
    const pos = cardPos(this.game, layout, id, index);
    return { x: pos.x, y: pos.y, w: layout.cardW, h: layout.cardH };
  }

  // ---- Drop --------------------------------------------------------------

  private dropDrag(pointer: Point): void {
    const drag = this.drag!;
    const layout = this.cb.layout();
    // Recomputed from the pointerup position rather than reusing drag.target: on
    // touch, up can land several px from the last move.
    const topRect = this.dragTopRect({ ...drag, pointer }, layout);

    const target = this.bestTarget(topRect, drag.from);
    const fromIndex = this.game.getPile(drag.from).length - drag.cards.length;

    if (target) {
      const srcPositions = drag.cards.map((_, i) => ({
        x: topRect.x + (layout.fanX ? i * layout.faceUpStep : 0),
        y: topRect.y + (layout.fanX ? 0 : i * layout.faceUpStep),
      }));
      const before = this.game.getPile(target).length;
      const result = this.game.moveCards(drag.from, fromIndex, target);
      if (result) {
        // onChange first: emptying a temp stack changes the column count, so
        // the layout must be refreshed before flight targets are computed.
        // result.to carries the index adjusted for any removed stack.
        this.cb.onChange();
        this.animateLanding(srcPositions, result.to, before, result);
        return;
      }
    }
    this.snapBack();
  }

  /** Pick the legal pile with the greatest overlap with the dragged card. */
  private bestTarget(topRect: Rect, from: PileId): PileId | null {
    const layout = this.cb.layout();
    const g = this.game;
    const candidates: PileId[] = [];
    for (let i = 0; i < 7; i++) candidates.push({ kind: "tableau", index: i });
    for (let i = 0; i < 4; i++) candidates.push({ kind: "foundation", index: i });
    for (let i = 0; i < g.spares.length; i++) candidates.push({ kind: "spare", index: i });

    let best: PileId | null = null;
    let bestArea = 0;
    const top = this.drag!.cards[0];
    for (const c of candidates) {
      if (samePile(c, from)) continue;
      const legal =
        c.kind === "tableau"
          ? g.canMoveToTableau(top, c.index)
          : c.kind === "spare"
            ? g.canMoveToSpare(c.index)
            : c.kind === "foundation"
              ? this.drag!.cards.length === 1 && g.canMoveToFoundation(top, c.index)
              : false;
      if (!legal) continue;
      const area = overlapArea(topRect, pileRect(g, layout, c));
      if (area > bestArea) {
        bestArea = area;
        best = c;
      }
    }
    return best;
  }

  // ---- Tap / double interactions -----------------------------------------

  private handleTap(p: Point, isTouch: boolean): void {
    const layout = this.cb.layout();

    // Click the stock to draw / recycle.
    if (pointInRect(p.x, p.y, { ...layout.stock, w: layout.cardW, h: layout.cardH })) {
      this.drawStock();
      return;
    }

    // Touch double-tap → auto move (mouse uses native dblclick).
    if (isTouch) {
      const now = performance.now();
      const isDouble =
        now - this.lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24;
      this.lastTap = { time: now, x: p.x, y: p.y };
      if (isDouble) this.tryAutoMove(p);
    }
  }

  private tryAutoMove(p: Point): void {
    const layout = this.cb.layout();
    const g = this.game;
    let from: PileId | null = null;
    let index = -1;

    for (let c = 0; c < 7; c++) {
      const idx = tableauCardAt(g, layout, c, p.x, p.y);
      if (idx >= 0) {
        from = { kind: "tableau", index: c };
        index = idx;
        break;
      }
    }
    if (!from) {
      for (let s = 0; s < g.spares.length; s++) {
        const idx = spareCardAt(g, layout, s, p.x, p.y);
        if (idx >= 0) {
          from = { kind: "spare", index: s };
          index = idx;
          break;
        }
      }
    }
    if (!from && g.waste.length > 0) {
      const top = g.waste.length - 1;
      if (pointInRect(p.x, p.y, this.cardRect(layout, { kind: "waste" }, top))) {
        from = { kind: "waste" };
        index = top;
      }
    }
    if (!from) return;

    const pile = g.getPile(from);
    if (index !== pile.length - 1) return; // only the top card auto-moves

    const src = cardPos(g, layout, from, index);
    const card = pile[index];
    const fTarget = g.foundationTargetFor(card);
    if (fTarget < 0) return;
    const dest: PileId = { kind: "foundation", index: fTarget };
    const before = g.getPile(dest).length;
    const result = g.autoMoveToFoundation(from);
    if (result) {
      // onChange first so a temp stack emptied by this move re-lays-out the
      // board before the flight target is computed.
      this.cb.onChange();
      this.animateLanding([src], dest, before, result);
    }
  }

  private drawStock(): void {
    const layout = this.cb.layout();
    const g = this.game;
    const recycling = g.stock.length === 0;
    const result = g.drawFromStock();
    if (!result) return;

    playDraw();

    if (recycling) {
      // Whole waste snaps back to the stock; a quick fade is enough.
      this.cb.onChange();
      return;
    }

    // Fly each drawn card from the stock to its place in the waste fan,
    // flipping face-up mid-flight.
    const moved = result.moved;
    for (let i = 0; i < moved.length; i++) {
      const card = moved[i];
      const destIndex = g.waste.length - moved.length + i;
      const dest = cardPos(g, layout, { kind: "waste" }, destIndex);
      this.animator.flyCard(card, layout.stock, dest, {
        duration: 230,
        delay: i * 60,
        easing: Easings.easeOutCubic,
        flip: true,
        faceShown: false,
        onDone: this.cb.onChange,
      });
    }
    this.cb.onChange();
  }

  // ---- Animation helpers -------------------------------------------------

  private animateLanding(
    srcPositions: Point[],
    dest: PileId,
    destStartIndex: number,
    result: MoveResult,
  ): void {
    const layout = this.cb.layout();
    const moved = result.moved;
    playPlace();
    for (let i = 0; i < moved.length; i++) {
      const to = cardPos(this.game, layout, dest, destStartIndex + i);
      this.animator.flyCard(moved[i], srcPositions[i], to, {
        duration: 200,
        easing: Easings.easeOutCubic,
      });
    }
    // Flip the newly revealed tableau card.
    if (result.flipped && result.from.kind === "tableau") {
      const col = this.game.tableau[result.from.index];
      const pos = cardPos(this.game, layout, result.from, col.length - 1);
      this.animator.flyCard(result.flipped, pos, pos, {
        duration: 260,
        delay: 120,
        flip: true,
        faceShown: false,
        onDone: playFlip,
      });
    }
  }

  private snapBack(): void {
    const drag = this.drag;
    if (!drag) return;
    const layout = this.cb.layout();
    const startX = drag.pointer.x - drag.offset.x;
    const startY = drag.pointer.y - drag.offset.y;
    for (let i = 0; i < drag.cards.length; i++) {
      const from = {
        x: startX + (layout.fanX ? i * layout.faceUpStep : 0),
        y: startY + (layout.fanX ? 0 : i * layout.faceUpStep),
      };
      this.animator.flyCard(drag.cards[i], from, this.pickOrigins[i], {
        duration: 200,
        easing: Easings.easeOutCubic,
      });
    }
  }
}
