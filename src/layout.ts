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

// Tableau stack metrics, as fractions of card height.
const FACE_DOWN_DY = 0.16;
const FACE_UP_DY = 0.29;
const TOP_GAP = 0.34; // gap between the top row and the tableau

export function computeLayout(width: number, height: number): Layout {
  const margin = Math.round(Math.min(width, height) * 0.03) + 10;
  const gapX = Math.max(8, Math.round(width * 0.012));

  // Fit 7 columns across the available width.
  let cardW = (width - margin * 2 - gapX * (COLS - 1)) / COLS;
  let cardH = cardW * CARD_RATIO;

  // Don't let cards get so tall that stacks run out of room: reserve space
  // for the top row plus a deep column (6 face-down + ~8 face-up offsets +
  // one full card) before offset compression has to kick in.
  const deepColumnH = 1 + TOP_GAP + 1 + 6 * FACE_DOWN_DY + 8 * FACE_UP_DY;
  const maxCardH = (height - margin * 2) / deepColumnH;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = cardH / CARD_RATIO;
  }

  const totalRowW = cardW * COLS + gapX * (COLS - 1);
  const originX = (width - totalRowW) / 2;
  const colX = (i: number) => originX + i * (cardW + gapX);

  const topY = margin;
  const tableauY = topY + cardH + Math.round(cardH * TOP_GAP);

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
    faceDownDY: cardH * FACE_DOWN_DY,
    faceUpDY: cardH * FACE_UP_DY,
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
