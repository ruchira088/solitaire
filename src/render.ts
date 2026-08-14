// All drawing. Cards are rendered procedurally (no image assets) so they stay
// crisp at any size / DPI. The renderer is stateless beyond a couple of cached
// gradients; the scene is redrawn every frame.

import { Card, rankLabel, SUIT_GLYPH, suitColor, Suit } from "./cards";
import { Game, PileId } from "./game";
import { columnOffsets, Layout, Point } from "./layout";
import { Animator, Particle } from "./animation";
import { getFaceArt } from "./courtArt";
import { getCardFace } from "./cardFaces";
import { getFelt, ThemeName } from "./theme";
import { cardPos } from "./positions";
import { samePile } from "./cursor";

const RED = "#d4233a";
const BLACK = "#1b1f27";

/** Where the keyboard cursor is, and what it has picked up. Drawn only while the
 *  keyboard is actually in use — see `keyboardActive` in main.ts — so a mouse player
 *  never sees it. */
export interface CursorView {
  pile: PileId;
  /** Index of the card the cursor points at; the ring covers it and everything on
   *  top of it, which is exactly what would be picked up. */
  depth: number;
  /** The lifted run waiting for a destination, if any. */
  held: { pile: PileId; depth: number } | null;
}

/** A move the solver found, drawn as "these cards go there". Cleared the moment the
 *  board changes — see `hintView` in main.ts — so it can never point at cards that
 *  have moved on. */
export interface HintView {
  from: PileId;
  /** Index of the first card that would move; the ring covers it and everything above. */
  fromIndex: number;
  to: PileId;
}

/** Cyan: not the drop ring's white, not the cursor's yellow, and legible on all four
 *  felts — the two greens, the claret and the parchment. */
const HINT_COLOR = "#5ad2ff";

export interface DragState {
  cards: Card[];
  from: PileId;
  pointer: Point; // current pointer position (CSS px)
  offset: Point; // pointer offset from the top card's top-left
  /** The pile this drag would land on right now, or null when no legal target is
   *  under it. Recomputed once per frame by `Input.updateDropTarget`. */
  target: PileId | null;
}

// Normalised pip positions (x,y in 0..1 of the inner face region) per rank.
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0.14], [0.5, 0.86]],
  3: [[0.5, 0.14], [0.5, 0.5], [0.5, 0.86]],
  4: [[0.3, 0.14], [0.7, 0.14], [0.3, 0.86], [0.7, 0.86]],
  5: [[0.3, 0.14], [0.7, 0.14], [0.5, 0.5], [0.3, 0.86], [0.7, 0.86]],
  6: [[0.3, 0.14], [0.7, 0.14], [0.3, 0.5], [0.7, 0.5], [0.3, 0.86], [0.7, 0.86]],
  7: [[0.3, 0.14], [0.7, 0.14], [0.5, 0.3], [0.3, 0.5], [0.7, 0.5], [0.3, 0.86], [0.7, 0.86]],
  8: [[0.3, 0.14], [0.7, 0.14], [0.5, 0.3], [0.3, 0.5], [0.7, 0.5], [0.5, 0.7], [0.3, 0.86], [0.7, 0.86]],
  9: [[0.3, 0.14], [0.7, 0.14], [0.3, 0.38], [0.7, 0.38], [0.5, 0.5], [0.3, 0.62], [0.7, 0.62], [0.3, 0.86], [0.7, 0.86]],
  10: [[0.3, 0.14], [0.7, 0.14], [0.5, 0.26], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.5, 0.74], [0.3, 0.86], [0.7, 0.86]],
};

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class Renderer {
  private feltCache:
    | { w: number; h: number; theme: ThemeName; grad: CanvasGradient }
    | null = null;

  // ---- Background --------------------------------------------------------

  drawBoard(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const { width, height } = layout;
    const felt = getFelt();
    if (
      !this.feltCache ||
      this.feltCache.w !== width ||
      this.feltCache.h !== height ||
      this.feltCache.theme !== felt.name
    ) {
      const grad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.32,
        Math.min(width, height) * 0.1,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85,
      );
      for (const [offset, color] of felt.feltStops) grad.addColorStop(offset, color);
      this.feltCache = { w: width, h: height, theme: felt.name, grad };
    }
    ctx.fillStyle = this.feltCache.grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle vignette for depth.
    const vg = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.3,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.75,
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, `rgba(0,0,0,${felt.vignette})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, width, height);
  }

  private drawPlaceholder(
    ctx: CanvasRenderingContext2D,
    p: Point,
    layout: Layout,
    glyph?: string,
  ): void {
    const { cardW, cardH, radius } = layout;
    const felt = getFelt();
    ctx.save();
    roundRectPath(ctx, p.x, p.y, cardW, cardH, radius);
    ctx.fillStyle = felt.placeholderFill;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, cardW * 0.02);
    ctx.strokeStyle = felt.placeholderStroke;
    ctx.stroke();
    if (glyph) {
      ctx.fillStyle = felt.placeholderText;
      ctx.font = `${Math.round(cardH * 0.4)}px -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, p.x + cardW / 2, p.y + cardH / 2 + cardH * 0.02);
    }
    ctx.restore();
  }

  // ---- Cards -------------------------------------------------------------

  /** Draw a card whose top-left would be (x,y), scaled about its centre. */
  drawCard(
    ctx: CanvasRenderingContext2D,
    card: Card,
    x: number,
    y: number,
    layout: Layout,
    opts: {
      scale?: number;
      flipX?: number;
      faceShown?: boolean;
      lift?: boolean;
      flat?: boolean;
      /** Radians, about the card's centre. Used by the win cascade. */
      angle?: number;
    } = {},
  ): void {
    const scale = opts.scale ?? 1;
    const flipX = opts.flipX ?? 1;
    const faceShown = opts.faceShown ?? card.faceUp;
    const { cardW, cardH, radius } = layout;
    const cx = x + cardW / 2;
    const cy = y + cardH / 2;

    ctx.save();
    ctx.translate(cx, cy);
    if (opts.angle) ctx.rotate(opts.angle);
    ctx.scale(scale * flipX, scale);

    // Drop shadow (stronger when lifted while dragging; none for trail frames).
    if (!opts.flat) {
      ctx.shadowColor = opts.lift ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.28)";
      ctx.shadowBlur = opts.lift ? cardW * 0.28 : cardW * 0.12;
      ctx.shadowOffsetY = opts.lift ? cardH * 0.06 : cardH * 0.03;
    }

    if (faceShown) {
      const svg = getCardFace(card);
      if (svg) {
        this.drawSvgFace(ctx, svg, -cardW / 2, -cardH / 2, cardW, cardH, radius);
      } else {
        this.drawFace(ctx, card, -cardW / 2, -cardH / 2, cardW, cardH, radius);
      }
    } else {
      this.drawBack(ctx, -cardW / 2, -cardH / 2, cardW, cardH, radius);
    }
    ctx.restore();
  }

  /** Draw a static SVG card face on a rounded white body. */
  private drawSvgFace(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    // White rounded body forms the visible card edge and carries the drop
    // shadow already configured by the caller.
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.shadowColor = "transparent";
    // Scale the artwork into an inset region so it has padding inside the card.
    const padX = w * 0.05;
    const padY = h * 0.05;
    const ix = x + padX;
    const iy = y + padY;
    const iw = w - padX * 2;
    const ih = h - padY * 2;
    const ir = Math.max(0, r - Math.min(padX, padY));

    ctx.save();
    roundRectPath(ctx, ix, iy, iw, ih, ir);
    ctx.clip();
    // Draw the full artwork (no overscan, so nothing is clipped off).
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.restore();

    // Mask the SVG's own thin black border (which sits at the inset edge) with
    // white, so the card reads as a clean white edge — without cropping the art.
    ctx.lineWidth = w * 0.016;
    ctx.strokeStyle = "#ffffff";
    roundRectPath(ctx, ix, iy, iw, ih, ir);
    ctx.stroke();
  }

  private drawFace(
    ctx: CanvasRenderingContext2D,
    card: Card,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    // Body with a faint top-down sheen.
    roundRectPath(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#eef1f6");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(1, w * 0.012);
    ctx.strokeStyle = "rgba(20,30,50,0.18)";
    ctx.stroke();

    const color = suitColor(card.suit) === "red" ? RED : BLACK;
    const glyph = SUIT_GLYPH[card.suit];
    const label = rankLabel(card.rank);

    // Clip to the rounded card so face-card art never spills out.
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.clip();

    this.drawCorner(ctx, label, glyph, color, x, y, w, h, false);
    this.drawCorner(ctx, label, glyph, color, x, y, w, h, true);

    if (card.rank === 1) {
      this.drawAce(ctx, card, glyph, color, x, y, w, h);
    } else if (card.rank >= 2 && card.rank <= 10) {
      this.drawPips(ctx, card.rank, glyph, color, x, y, w, h);
    } else {
      this.drawCourt(ctx, card, color, glyph, x, y, w, h);
    }
    ctx.restore();
  }

  private drawCorner(
    ctx: CanvasRenderingContext2D,
    label: string,
    glyph: string,
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
    flipped: boolean,
  ): void {
    ctx.save();
    if (flipped) {
      ctx.translate(x + w, y + h);
      ctx.rotate(Math.PI);
    } else {
      ctx.translate(x, y);
    }
    const pad = w * 0.07;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${Math.round(h * 0.185)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(label, pad + w * 0.045, pad + h * 0.155);
    ctx.font = `${Math.round(h * 0.16)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(glyph, pad + w * 0.045, pad + h * 0.31);
    ctx.restore();
  }

  private drawCenterGlyph(
    ctx: CanvasRenderingContext2D,
    glyph: string,
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
  ): void {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(h * size)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(glyph, x + w / 2, y + h / 2 + h * 0.02);
    ctx.restore();
  }

  private drawPips(
    ctx: CanvasRenderingContext2D,
    rank: number,
    glyph: string,
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const pips = PIPS[rank];
    if (!pips) return;
    // Inner region (inside the corner indices).
    const ix = x + w * 0.16;
    const iy = y + h * 0.13;
    const iw = w * 0.68;
    const ih = h * 0.74;
    const size = h * 0.175;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(size)}px "Helvetica Neue", Arial, sans-serif`;
    for (const [nx, ny] of pips) {
      const px = ix + nx * iw;
      const py = iy + ny * ih;
      ctx.save();
      ctx.translate(px, py);
      if (ny > 0.5) ctx.rotate(Math.PI); // invert lower-half pips
      ctx.fillText(glyph, 0, size * 0.04);
      ctx.restore();
    }
  }

  // Art region inside a card, inset so the corner rank/suit indices stay clear
  // (matches the illustration's ~0.667 aspect ratio).
  private artRect(x: number, y: number, w: number, h: number) {
    return { ax: x + w * 0.2, ay: y + h * 0.179, aw: w * 0.6, ah: h * 0.643 };
  }

  private drawAce(
    ctx: CanvasRenderingContext2D,
    card: Card,
    glyph: string,
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const img = getFaceArt(card);
    if (img) {
      const { ax, ay, aw, ah } = this.artRect(x, y, w, h);
      ctx.drawImage(img, ax, ay, aw, ah);
    } else {
      this.drawCenterGlyph(ctx, glyph, color, x, y, w, h, 0.46);
    }
  }

  private drawCourt(
    ctx: CanvasRenderingContext2D,
    card: Card,
    color: string,
    glyph: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const { ax, ay, aw, ah } = this.artRect(x, y, w, h);
    // Framed cream window for the portrait.
    roundRectPath(ctx, ax, ay, aw, ah, w * 0.05);
    const g = ctx.createLinearGradient(ax, ay, ax, ay + ah);
    g.addColorStop(0, "#fffdf6");
    g.addColorStop(1, "#f3ecda");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, w * 0.022);
    ctx.strokeStyle = "#c9a23a"; // gold border
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, w * 0.008);
    ctx.strokeStyle = "rgba(201,162,58,0.5)";
    roundRectPath(ctx, ax + w * 0.03, ay + w * 0.03, aw - w * 0.06, ah - w * 0.06, w * 0.04);
    ctx.stroke();

    const img = getFaceArt(card);
    if (img) {
      ctx.save();
      roundRectPath(ctx, ax, ay, aw, ah, w * 0.05);
      ctx.clip();
      ctx.drawImage(img, ax, ay, aw, ah);
      ctx.restore();
    } else {
      this.drawFaceCard(ctx, card, color, glyph, x, y, w, h);
    }
  }

  private drawFaceCard(
    ctx: CanvasRenderingContext2D,
    card: Card,
    color: string,
    glyph: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    // Decorative inner panel.
    const pad = w * 0.16;
    const px = x + pad;
    const py = y + h * 0.16;
    const pw = w - pad * 2;
    const ph = h - h * 0.32;
    const isRed = color === RED;

    roundRectPath(ctx, px, py, pw, ph, w * 0.06);
    const panel = ctx.createLinearGradient(px, py, px, py + ph);
    if (isRed) {
      panel.addColorStop(0, "#fde6ea");
      panel.addColorStop(1, "#f8c9d2");
    } else {
      panel.addColorStop(0, "#e9edf6");
      panel.addColorStop(1, "#cdd6e6");
    }
    ctx.fillStyle = panel;
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.strokeStyle = isRed ? "rgba(180,40,60,0.5)" : "rgba(40,55,90,0.5)";
    ctx.stroke();

    // Large court letter.
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(h * 0.34)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(rankLabel(card.rank), x + w / 2, y + h * 0.46);

    // Suit glyph beneath the letter.
    ctx.font = `${Math.round(h * 0.16)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(glyph, x + w / 2, y + h * 0.66);
  }

  private drawBack(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const back = getFelt().back;
    roundRectPath(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, back.from);
    g.addColorStop(1, back.to);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";

    // Inset border.
    const m = w * 0.08;
    roundRectPath(ctx, x + m, y + m, w - m * 2, h - m * 2, r * 0.7);
    ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.strokeStyle = back.line;
    ctx.stroke();

    // Diagonal lattice pattern, clipped to the inset.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = back.lattice;
    ctx.lineWidth = Math.max(0.75, w * 0.012);
    const step = w * 0.18;
    ctx.beginPath();
    for (let d = -h; d < w + h; d += step) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
      ctx.moveTo(x + d, y + h);
      ctx.lineTo(x + d + h, y);
    }
    ctx.stroke();
    ctx.restore();

    // Centre emblem.
    ctx.save();
    ctx.fillStyle = back.emblemColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(h * 0.22)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(back.emblem, x + w / 2, y + h / 2 + h * 0.01);
    ctx.restore();
  }

  // ---- Scene -------------------------------------------------------------

  drawScene(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
    animator: Animator,
    drag: DragState | null,
    cursor: CursorView | null,
    hint: HintView | null = null,
  ): void {
    this.drawBoard(ctx, layout);

    const dragIds = new Set(drag ? drag.cards.map((c) => c.id) : []);
    const hidden = (c: Card) => dragIds.has(c.id) || animator.isFlying(c.id);

    // Foundations.
    for (let i = 0; i < 4; i++) {
      const p = layout.foundations[i];
      this.drawPlaceholder(ctx, p, layout, SUIT_GLYPH[(["spades", "hearts", "diamonds", "clubs"] as Suit[])[i]]);
      const pile = game.foundations[i];
      const top = pile[pile.length - 1];
      if (top && !hidden(top)) this.drawCard(ctx, top, p.x, p.y, layout);
    }

    // Stock.
    this.drawPlaceholder(ctx, layout.stock, layout, game.stock.length === 0 ? "↻" : undefined);
    const stockTop = game.stock[game.stock.length - 1];
    if (stockTop && !hidden(stockTop)) {
      this.drawCard(ctx, stockTop, layout.stock.x, layout.stock.y, layout, { faceShown: false });
    }
    this.drawStockCounter(ctx, game, layout);

    // Waste (fan the last few cards in draw-3; a single card in draw-1).
    this.drawPlaceholder(ctx, layout.waste, layout);
    const wasteFan = Math.min(game.drawCount, game.waste.length);
    const startFan = game.waste.length - wasteFan;
    for (let i = 0; i < wasteFan; i++) {
      const card = game.waste[startFan + i];
      if (hidden(card)) continue;
      const wx = layout.waste.x + i * layout.wasteFan.x;
      const wy = layout.waste.y + i * layout.wasteFan.y;
      this.drawCard(ctx, card, wx, wy, layout);
    }

    // Temp parking stacks: each renders like an extra tableau pile.
    for (let s = 0; s < game.spares.length; s++) {
      const spare = game.spares[s];
      const base = layout.spares[s];
      this.drawPlaceholder(ctx, base, layout, "✦");
      const spareOffsets = columnOffsets(
        spare,
        layout,
        layout.fanX ? base.x : base.y,
        layout.spareFanLimit,
      );
      for (let i = 0; i < spare.length; i++) {
        const card = spare[i];
        if (hidden(card)) continue;
        const d = spareOffsets[i];
        this.drawCard(ctx, card, base.x + (layout.fanX ? d : 0), base.y + (layout.fanX ? 0 : d), layout);
      }
    }

    // Tableau piles.
    for (let c = 0; c < 7; c++) {
      const col = game.tableau[c];
      const base = layout.tableau[c];
      this.drawPlaceholder(ctx, base, layout);
      const offsets = columnOffsets(col, layout);
      for (let i = 0; i < col.length; i++) {
        const card = col[i];
        if (hidden(card)) continue;
        const d = offsets[i];
        this.drawCard(ctx, card, base.x + (layout.fanX ? d : 0), base.y + (layout.fanX ? 0 : d), layout);
      }
    }

    // The keyboard cursor. Yellow and tight to the cards, against the drop ring's
    // wide steady white — two different questions ("where am I" vs "where will this
    // land"), so they have to stay tellable apart when both are on screen.
    if (cursor) {
      if (cursor.held) this.highlightRun(ctx, game, layout, cursor.held.pile, cursor.held.depth, true);
      const onHeld = cursor.held && samePile(cursor.held.pile, cursor.pile);
      if (!onHeld) this.highlightRun(ctx, game, layout, cursor.pile, cursor.depth, false);
    }

    // The suggested move, under the drop ring: while a drag is live the player has
    // already decided, and the ring they're steering by has to win the foreground.
    if (hint) this.drawHint(ctx, game, layout, hint);

    // Where the live drag would land. Drawn under the dragged stack, hence the
    // wide ring and glow.
    if (drag?.target) {
      this.highlightPile(ctx, game, layout, drag.target);
    }

    // Cards in flight (above the static piles).
    for (const f of animator.activeFlights()) {
      this.drawCard(ctx, f.card, f.pos.x, f.pos.y, layout, {
        scale: f.scale,
        flipX: f.flipX,
        faceShown: f.faceShown,
      });
    }

    // Dragged stack on top of everything.
    if (drag) {
      const x = drag.pointer.x - drag.offset.x;
      const y = drag.pointer.y - drag.offset.y;
      const dx = layout.fanX ? layout.faceUpStep : 0;
      const dy = layout.fanX ? 0 : layout.faceUpStep;
      for (let i = 0; i < drag.cards.length; i++) {
        this.drawCard(ctx, drag.cards[i], x + i * dx, y + i * dy, layout, {
          scale: 1.04,
          lift: true,
        });
      }
    }
  }

  /** "drawn/total" tally under the stock: how far through the draw pile the
   *  player is. Total shrinks as waste cards are played onto the board. */
  private drawStockCounter(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
  ): void {
    const total = game.stock.length + game.waste.length;
    if (total === 0) return;
    const felt = getFelt();
    ctx.save();
    ctx.fillStyle = felt.placeholderStroke;
    ctx.font = `600 ${Math.round(layout.cardH * 0.11)}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      `${game.waste.length}/${total}`,
      layout.stock.x + layout.cardW / 2,
      layout.stock.y + layout.cardH + layout.cardH * 0.06,
    );
    ctx.restore();
  }

  private pileAnchor(game: Game, layout: Layout, id: PileId): Point {
    switch (id.kind) {
      case "stock":
        return layout.stock;
      case "waste": {
        const fan = Math.min(game.drawCount - 1, Math.max(0, game.waste.length - 1));
        return {
          x: layout.waste.x + fan * layout.wasteFan.x,
          y: layout.waste.y + fan * layout.wasteFan.y,
        };
      }
      case "foundation":
        return layout.foundations[id.index];
      case "tableau":
      case "spare": {
        const spare = id.kind === "spare";
        const base = spare ? layout.spares[id.index] : layout.tableau[id.index];
        const col = game.getPile(id);
        const limit = spare ? layout.spareFanLimit : layout.fanLimit;
        const offsets = columnOffsets(col, layout, layout.fanX ? base.x : base.y, limit);
        const d = offsets.length ? offsets[offsets.length - 1] : 0;
        return layout.fanX ? { x: base.x + d, y: base.y } : { x: base.x, y: base.y + d };
      }
    }
  }

  /** Confetti and sparks. Drawn after the cards so a burst reads as being in front,
   *  and with no shadow: hundreds of shadowed sprites a frame is the one thing here
   *  expensive enough to notice. */
  drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
    ctx.save();
    ctx.shadowColor = "transparent";
    for (const p of particles) {
      ctx.globalAlpha = Math.min(1, p.life / (p.maxLife * 0.6));
      ctx.fillStyle = p.color;
      if (p.ribbon) {
        // A tumbling scrap: the squash as it turns is what sells the spin.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Ring the run the keyboard cursor covers: from the focused card to the bottom of
   *  the fan, so the outline is literally the cards that would move. `held` cards get
   *  a heavier, glowing version — they are lifted, waiting for somewhere to go. */
  private highlightRun(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
    id: PileId,
    depth: number,
    held: boolean,
  ): void {
    const cards = game.getPile(id);
    const top = cards.length ? cardPos(game, layout, id, Math.min(depth, cards.length - 1)) : this.pileAnchor(game, layout, id);
    const end = cards.length ? cardPos(game, layout, id, cards.length - 1) : top;
    const pad = 4;
    const x = Math.min(top.x, end.x) - pad;
    const y = Math.min(top.y, end.y) - pad;
    const w = Math.abs(end.x - top.x) + layout.cardW + pad * 2;
    const h = Math.abs(end.y - top.y) + layout.cardH + pad * 2;

    ctx.save();
    roundRectPath(ctx, x, y, w, h, layout.radius);
    if (held) {
      ctx.fillStyle = "rgba(255,211,78,0.16)";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.shadowColor = "rgba(255,211,78,0.8)";
      ctx.shadowBlur = 16;
    } else {
      ctx.lineWidth = 3;
    }
    ctx.strokeStyle = "#ffd34e";
    ctx.stroke();
    ctx.restore();
  }

  /** The suggested move: the cards to pick up, where they go, and an arrow between.
   *
   *  This is the third pile highlight, and the other two are a standing warning that a
   *  third needs to be tellable apart from both — so it differs in all three of the
   *  ways they differ from each other. Colour: cyan, against the drop ring's white and
   *  the cursor's yellow. Weight: dashed, where both of those are solid. Extent: it
   *  marks a *pair* of piles and joins them, which neither of the others ever does —
   *  a hint answers "from here to there", not "here". */
  private drawHint(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
    hint: HintView,
  ): void {
    const cards = game.getPile(hint.from);
    const first = cards.length
      ? cardPos(game, layout, hint.from, Math.min(hint.fromIndex, cards.length - 1))
      : this.pileAnchor(game, layout, hint.from);
    const last = cards.length ? cardPos(game, layout, hint.from, cards.length - 1) : first;
    const dest = this.pileAnchor(game, layout, hint.to);

    const pad = 5;
    const x = Math.min(first.x, last.x) - pad;
    const y = Math.min(first.y, last.y) - pad;
    const w = Math.abs(last.x - first.x) + layout.cardW + pad * 2;
    const h = Math.abs(last.y - first.y) + layout.cardH + pad * 2;

    ctx.save();
    ctx.strokeStyle = HINT_COLOR;
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 6]);
    ctx.shadowColor = "rgba(90,210,255,0.55)";
    ctx.shadowBlur = 12;

    roundRectPath(ctx, x, y, w, h, layout.radius);
    ctx.stroke();
    roundRectPath(ctx, dest.x - pad, dest.y - pad, layout.cardW + pad * 2, layout.cardH + pad * 2, layout.radius);
    ctx.stroke();

    // From the middle of the run to the middle of the destination. Solid, so the arrow
    // reads as one object rather than as more dashes.
    ctx.setLineDash([]);
    const from = { x: x + w / 2, y: y + h / 2 };
    const to = { x: dest.x + layout.cardW / 2, y: dest.y + layout.cardH / 2 };
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    // Stop short of the destination card so the head sits on its edge, not its face.
    const inset = Math.min(layout.cardW, layout.cardH) * 0.42;
    const tip = { x: to.x - Math.cos(angle) * inset, y: to.y - Math.sin(angle) * inset };
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    const head = Math.max(9, layout.cardW * 0.12);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - Math.cos(angle - Math.PI / 7) * head,
      tip.y - Math.sin(angle - Math.PI / 7) * head,
    );
    ctx.lineTo(
      tip.x - Math.cos(angle + Math.PI / 7) * head,
      tip.y - Math.sin(angle + Math.PI / 7) * head,
    );
    ctx.closePath();
    ctx.fillStyle = HINT_COLOR;
    ctx.fill();
    ctx.restore();
  }

  /** Ring the pile a live drag would land on. Steady and white on purpose — it reads
   *  as "here", not as an animation demanding attention. */
  private highlightPile(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
    id: PileId,
  ): void {
    const p = this.pileAnchor(game, layout, id);
    // The dragged stack is drawn on top at 1.04 scale, so the ring sits well out and
    // glows hard to stay visible around it.
    ctx.save();
    roundRectPath(ctx, p.x - 8, p.y - 8, layout.cardW + 16, layout.cardH + 16, layout.radius);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.shadowColor = "rgba(255,255,255,0.85)";
    ctx.shadowBlur = 22;
    ctx.stroke();
    ctx.restore();
  }
}
