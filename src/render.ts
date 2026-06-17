// All drawing. Cards are rendered procedurally (no image assets) so they stay
// crisp at any size / DPI. The renderer is stateless beyond a couple of cached
// gradients; the scene is redrawn every frame.

import { Card, rankLabel, SUIT_GLYPH, suitColor, Suit } from "./cards";
import { Game, PileId } from "./game";
import { columnOffsets, Layout, Point } from "./layout";
import { Animator } from "./animation";
import { getFaceArt } from "./courtArt";
import { getCardFace } from "./cardFaces";
import { getFelt, ThemeName } from "./theme";

const RED = "#d4233a";
const BLACK = "#1b1f27";

export interface DragState {
  cards: Card[];
  from: PileId;
  pointer: Point; // current pointer position (CSS px)
  offset: Point; // pointer offset from the top card's top-left
}

export interface HintHighlight {
  from: PileId;
  to: PileId;
  /** ms timestamp when the hint was issued, for the pulse animation. */
  since: number;
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
    roundRectPath(ctx, x, y, w, h, r);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "#2a4cad");
    g.addColorStop(1, "#16307a");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";

    // Inset border.
    const m = w * 0.08;
    roundRectPath(ctx, x + m, y + m, w - m * 2, h - m * 2, r * 0.7);
    ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.stroke();

    // Diagonal lattice pattern, clipped to the inset.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
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
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(h * 0.22)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText("✦", x + w / 2, y + h / 2 + h * 0.01);
    ctx.restore();
  }

  // ---- Scene -------------------------------------------------------------

  drawScene(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
    animator: Animator,
    drag: DragState | null,
    hint: HintHighlight | null,
    now: number,
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

    // Waste (fan the last few cards for draw-3 feel).
    this.drawPlaceholder(ctx, layout.waste, layout);
    const wasteFan = Math.min(3, game.waste.length);
    const startFan = game.waste.length - wasteFan;
    for (let i = 0; i < wasteFan; i++) {
      const card = game.waste[startFan + i];
      if (hidden(card)) continue;
      const wx = layout.waste.x + i * layout.wasteFanDX;
      this.drawCard(ctx, card, wx, layout.waste.y, layout);
    }

    // Tableau columns.
    for (let c = 0; c < 7; c++) {
      const col = game.tableau[c];
      const base = layout.tableau[c];
      this.drawPlaceholder(ctx, base, layout);
      const offsets = columnOffsets(col, layout);
      for (let i = 0; i < col.length; i++) {
        const card = col[i];
        if (hidden(card)) continue;
        this.drawCard(ctx, card, base.x, base.y + offsets[i], layout);
      }
    }

    // Hint highlight (pulsing outline on source + destination).
    if (hint) {
      const pulse = 0.5 + 0.5 * Math.sin((now - hint.since) / 220);
      this.highlightPile(ctx, game, layout, hint.from, pulse, true);
      this.highlightPile(ctx, game, layout, hint.to, pulse, false);
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
      for (let i = 0; i < drag.cards.length; i++) {
        this.drawCard(ctx, drag.cards[i], x, y + i * layout.faceUpDY, layout, {
          scale: 1.04,
          lift: true,
        });
      }
    }
  }

  private pileAnchor(game: Game, layout: Layout, id: PileId): Point {
    switch (id.kind) {
      case "stock":
        return layout.stock;
      case "waste": {
        const fan = Math.min(2, Math.max(0, game.waste.length - 1));
        return { x: layout.waste.x + fan * layout.wasteFanDX, y: layout.waste.y };
      }
      case "foundation":
        return layout.foundations[id.index];
      case "tableau": {
        const base = layout.tableau[id.index];
        const col = game.tableau[id.index];
        const offsets = columnOffsets(col, layout);
        const dy = offsets.length ? offsets[offsets.length - 1] : 0;
        return { x: base.x, y: base.y + dy };
      }
    }
  }

  private highlightPile(
    ctx: CanvasRenderingContext2D,
    game: Game,
    layout: Layout,
    id: PileId,
    pulse: number,
    isSource: boolean,
  ): void {
    const p = this.pileAnchor(game, layout, id);
    ctx.save();
    roundRectPath(ctx, p.x - 2, p.y - 2, layout.cardW + 4, layout.cardH + 4, layout.radius);
    ctx.lineWidth = 3 + pulse * 2;
    ctx.strokeStyle = isSource
      ? `rgba(255,211,78,${0.55 + pulse * 0.4})`
      : `rgba(120,230,170,${0.55 + pulse * 0.4})`;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12 + pulse * 12;
    ctx.stroke();
    ctx.restore();
  }
}
