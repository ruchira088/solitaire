// Responsive board layout. All coordinates are in CSS pixels; the renderer
// applies the devicePixelRatio scale so everything stays crisp on HiDPI.

export interface Point {
  x: number;
  y: number;
}

export interface Layout {
  width: number;
  height: number;
  cardW: number;
  cardH: number;
  radius: number;
  /** Top-left of each pile. */
  stock: Point;
  waste: Point;
  foundations: Point[]; // 4
  tableau: Point[]; // 7
  /** Vertical spacing between stacked tableau cards. */
  faceDownDY: number;
  faceUpDY: number;
  /** Horizontal fan spacing for the waste pile (draw-3). */
  wasteFanDX: number;
  /** Max y a tableau column may extend to before offsets are compressed. */
  tableauBottom: number;
}

const CARD_RATIO = 1.4; // height / width
const COLS = 7;

export function computeLayout(width: number, height: number): Layout {
  const margin = Math.round(Math.min(width, height) * 0.03) + 10;
  const gapX = Math.max(8, Math.round(width * 0.012));

  // Fit 7 columns across the available width.
  let cardW = (width - margin * 2 - gapX * (COLS - 1)) / COLS;
  let cardH = cardW * CARD_RATIO;

  // Don't let cards get absurdly large on very wide screens.
  const maxCardH = height * 0.26;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = cardH / CARD_RATIO;
  }

  const totalRowW = cardW * COLS + gapX * (COLS - 1);
  const originX = (width - totalRowW) / 2;
  const colX = (i: number) => originX + i * (cardW + gapX);

  const topY = margin;
  const tableauY = topY + cardH + Math.round(cardH * 0.34);

  const foundations: Point[] = [
    { x: colX(3), y: topY },
    { x: colX(4), y: topY },
    { x: colX(5), y: topY },
    { x: colX(6), y: topY },
  ];

  const tableau: Point[] = [];
  for (let i = 0; i < COLS; i++) tableau.push({ x: colX(i), y: tableauY });

  return {
    width,
    height,
    cardW,
    cardH,
    radius: Math.max(6, cardW * 0.075),
    stock: { x: colX(0), y: topY },
    waste: { x: colX(1), y: topY },
    foundations,
    tableau,
    faceDownDY: cardH * 0.16,
    faceUpDY: cardH * 0.29,
    wasteFanDX: cardW * 0.28,
    tableauBottom: height - margin,
  };
}

/** Compute the per-card vertical offsets for a tableau column, compressing the
 *  spacing if the natural stack would overflow the board. */
export function columnOffsets(
  cards: { faceUp: boolean }[],
  layout: Layout,
): number[] {
  const offsets: number[] = [];
  let downDY = layout.faceDownDY;
  let upDY = layout.faceUpDY;

  const naturalHeight = () => {
    let h = 0;
    for (let i = 0; i < cards.length - 1; i++) {
      h += cards[i].faceUp ? upDY : downDY;
    }
    return h;
  };

  const available = layout.tableauBottom - layout.tableau[0].y - layout.cardH;
  let nat = naturalHeight();
  if (nat > available && nat > 0) {
    const scale = available / nat;
    downDY *= scale;
    upDY *= scale;
  }

  let y = 0;
  for (let i = 0; i < cards.length; i++) {
    offsets.push(y);
    y += cards[i].faceUp ? upDY : downDY;
  }
  return offsets;
}
