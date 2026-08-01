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
  /** True when piles fan horizontally — the phone-portrait "vertical" board,
   *  where the tableau is a list of rows instead of a row of columns. */
  fanX: boolean;
  /** Top-left of each pile. */
  stock: Point;
  waste: Point;
  foundations: Point[]; // 4
  tableau: Point[]; // 7
  /** Temp parking piles: extra columns right of the tableau, extra rows below
   *  it (fanX), or a bottom row on compact landscape boards. Length matches
   *  the live stack count (0–3). */
  spares: Point[];
  /** Spacing between fanned tableau cards, along the fan axis. */
  faceDownStep: number;
  faceUpStep: number;
  /** Horizontal fan spacing for the waste pile (draw-3). */
  wasteFanDX: number;
  /** Max coordinate (y, or x when fanX) a tableau fan may reach before the
   *  steps are compressed. */
  fanLimit: number;
  /** Fan limit for spare stacks (differs when they have their own row). */
  spareFanLimit: number;
}

const CARD_RATIO = 1.4; // height / width
const COLS = 7;

// Fan metrics, as fractions of card extent along the fan axis (height for
// column fans, width for the phone-portrait row fans).
const FACE_DOWN_STEP = 0.16;
const FACE_UP_STEP = 0.29;
const TOP_GAP = 0.26; // gap between the top row and the tableau

// Fan room a column is sized to hold before `columnOffsets` has to compress it:
// its 6 face-down cards plus this many face-up ones. Reserving the true worst
// case (a full 13-card run) is what it looks like when the table is mostly empty
// green — height binds at every ordinary aspect ratio, so every unused step goes
// straight into shrinking the cards. Deeper columns still fit, compressed.
const RESERVED_FACE_DOWN = 6;
const RESERVED_FACE_UP = 4;

/** Extra gutter, as a fraction of card width, that height-capped cards may spend
 *  leftover width on rather than huddling in the middle of the table. */
const MAX_EXTRA_GAP = 0.12;

// Bottom spare row (compact landscape boards), as fractions of card height.
const SPARE_ROW_FAN = 0.5; // fan room reserved below the spare row's cards
const SPARE_ROW_GAP = 0.12; // gap between the tableau limit and the spare row

// Clearance under the stock for the drawn/total counter (fanX header).
const COUNTER_GAP = 0.18;

export function computeLayout(width: number, height: number, spareCount = 0): Layout {
  if (width < 520 && height > width) return verticalLayout(width, height, spareCount);

  // Compact (phone-landscape) boards get slimmer margins and gaps so the 7
  // columns keep a usable card size, and spare stacks move to their own
  // bottom row instead of squeezing in extra columns.
  const compact = width < 520;
  const margin = compact
    ? Math.max(8, Math.round(width * 0.02))
    : Math.round(Math.min(width, height) * 0.022) + 8;
  const gapX = Math.max(compact ? 5 : 8, Math.round(width * 0.012));

  // Fit the columns across the available width (an extra one per live temp
  // stack, unless the spares live in the bottom row).
  const spareRow = compact && spareCount > 0;
  const cols = COLS + (spareRow ? 0 : spareCount);
  let cardW = (width - margin * 2 - gapX * (cols - 1)) / cols;
  let cardH = cardW * CARD_RATIO;

  // Don't let cards get so tall that stacks run out of room: reserve space for
  // the top row plus a column deep enough to cover the common case (see
  // RESERVED_FACE_UP) before offset compression has to kick in — plus the spare
  // row when it sits below the tableau.
  const deepColumnH =
    1 + TOP_GAP + 1 +
    RESERVED_FACE_DOWN * FACE_DOWN_STEP + RESERVED_FACE_UP * FACE_UP_STEP +
    (spareRow ? 1 + SPARE_ROW_FAN + SPARE_ROW_GAP : 0);
  const maxCardH = (height - margin * 2) / deepColumnH;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = cardH / CARD_RATIO;
  }

  // Cards capped by height leave width unspent — widen the gutters with some of
  // it, so the row spreads over the table instead of clustering mid-screen. Only
  // ever spends slack that's already there, so the row still fits.
  const slack = width - margin * 2 - cardW * cols - gapX * (cols - 1);
  const gap =
    slack > 0 ? gapX + Math.min(cardW * MAX_EXTRA_GAP, slack / (cols - 1)) : gapX;

  const totalRowW = cardW * cols + gap * (cols - 1);
  const originX = (width - totalRowW) / 2;
  const colX = (i: number) => originX + i * (cardW + gap);

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

  const spares: Point[] = [];
  let fanLimit = height - margin;
  if (spareRow) {
    const spareY = height - margin - cardH * (1 + SPARE_ROW_FAN);
    const spareW = spareCount * cardW + (spareCount - 1) * gap;
    const x0 = (width - spareW) / 2;
    for (let i = 0; i < spareCount; i++) spares.push({ x: x0 + i * (cardW + gap), y: spareY });
    fanLimit = spareY - cardH * SPARE_ROW_GAP;
  } else {
    for (let i = 0; i < spareCount; i++) spares.push({ x: colX(COLS + i), y: tableauY });
  }

  return {
    width,
    height,
    cardW,
    cardH,
    radius: Math.max(6, cardW * 0.075),
    fanX: false,
    stock: { x: colX(0), y: topY },
    waste: { x: colX(1), y: topY },
    foundations,
    tableau,
    spares,
    faceDownStep: cardH * FACE_DOWN_STEP,
    faceUpStep: cardH * FACE_UP_STEP,
    wasteFanDX: cardW * 0.28,
    fanLimit,
    spareFanLimit: height - margin,
  };
}

/** Phone-portrait board: piles are listed vertically and cards fan to the
 *  right — stock + waste header on top, foundations down the left edge, and
 *  the tableau (plus any spare stacks) as rows beside them. */
function verticalLayout(width: number, height: number, spareCount: number): Layout {
  const margin = Math.max(8, Math.round(height * 0.012));
  const gapX = Math.max(5, Math.round(width * 0.012));
  const gapY = Math.max(5, Math.round(height * 0.008));

  // The header (one card + counter clearance) and the pile rows must fit the
  // height; very squat screens fall back to a width cap that keeps a couple
  // of card-widths of fan room per row.
  const rows = COLS + spareCount;
  let cardH = (height - margin * 2 - rows * gapY) / (rows + 1 + COUNTER_GAP);
  let cardW = cardH / CARD_RATIO;
  const maxCardW = (width - margin * 2 - gapX * 2) / 4.6;
  if (cardW > maxCardW) {
    cardW = maxCardW;
    cardH = cardW * CARD_RATIO;
  }

  const topY = margin;
  const rowY0 = topY + cardH * (1 + COUNTER_GAP) + gapY;
  const rowY = (i: number) => rowY0 + i * (cardH + gapY);
  const rowX = margin + cardW + gapX * 2;

  // Foundations sit beside the bottom four rows, flush with the board's end.
  const foundations: Point[] = [];
  for (let i = 0; i < 4; i++) foundations.push({ x: margin, y: rowY(rows - 4 + i) });
  const tableau: Point[] = [];
  for (let i = 0; i < COLS; i++) tableau.push({ x: rowX, y: rowY(i) });
  const spares: Point[] = [];
  for (let i = 0; i < spareCount; i++) spares.push({ x: rowX, y: rowY(COLS + i) });

  return {
    width,
    height,
    cardW,
    cardH,
    radius: Math.max(6, cardW * 0.075),
    fanX: true,
    stock: { x: margin, y: topY },
    waste: { x: margin + cardW + gapX, y: topY },
    foundations,
    tableau,
    spares,
    faceDownStep: cardW * FACE_DOWN_STEP,
    faceUpStep: cardW * FACE_UP_STEP,
    wasteFanDX: cardW * 0.28,
    fanLimit: width - margin,
    spareFanLimit: width - margin,
  };
}

/** Compute the per-card offsets along the fan axis for a fanned stack,
 *  compressing the spacing if the natural fan would overflow its limit.
 *  Defaults fit tableau piles; spare piles pass their own base and limit. */
export function columnOffsets(
  cards: { faceUp: boolean }[],
  layout: Layout,
  base = layout.fanX ? layout.tableau[0].x : layout.tableau[0].y,
  limit = layout.fanLimit,
): number[] {
  const offsets: number[] = [];
  let downStep = layout.faceDownStep;
  let upStep = layout.faceUpStep;

  const naturalExtent = () => {
    let d = 0;
    for (let i = 0; i < cards.length - 1; i++) {
      d += cards[i].faceUp ? upStep : downStep;
    }
    return d;
  };

  const available = limit - base - (layout.fanX ? layout.cardW : layout.cardH);
  const nat = naturalExtent();
  if (nat > available && nat > 0) {
    const scale = available / nat;
    downStep *= scale;
    upStep *= scale;
  }

  let d = 0;
  for (let i = 0; i < cards.length; i++) {
    offsets.push(d);
    d += cards[i].faceUp ? upStep : downStep;
  }
  return offsets;
}
