// Table themes for the canvas — the felt, the vignette, the empty-pile placeholders
// and the card backs. The toolbar / page chrome is themed from CSS, keyed off the
// `data-theme` attribute this module's names feed (see styles.css).
//
// This is a registry rather than a light/dark pair, so adding a theme is one entry
// here plus one CSS block. Two rules keep that cheap:
//
//   - `ThemeName` is derived from THEMES, so a new entry is immediately a legal
//     ?theme= value and a legal saved preference, with no union to keep in step.
//   - Every theme carries its own **card back**. The back used to be a hardcoded blue
//     in render.ts, identical in both themes, which made it the most-visible thing on
//     the table that a theme couldn't touch — the felt is mostly covered by cards.

export interface CardBack {
  /** Diagonal gradient stops for the back's body. */
  from: string;
  to: string;
  /** Inset border and lattice, over the body. */
  line: string;
  lattice: string;
  /** Centre emblem, drawn as text. */
  emblem: string;
  emblemColor: string;
}

export interface FeltTheme {
  name: ThemeName;
  /** Shown on the theme button, and the label announces the *next* theme. */
  icon: string;
  label: string;
  /** Radial gradient colour stops for the table felt. */
  feltStops: [number, string][];
  /** Vignette darkness at the edges (0..1). */
  vignette: number;
  placeholderFill: string;
  placeholderStroke: string;
  placeholderText: string;
  back: CardBack;
}

/** The classic blue lattice the game shipped with, kept as the default back so the
 *  dark theme looks exactly as it always did. */
const CLASSIC_BACK: CardBack = {
  from: "#2a4cad",
  to: "#16307a",
  line: "rgba(255,255,255,0.55)",
  lattice: "rgba(255,255,255,0.16)",
  emblem: "✦",
  emblemColor: "rgba(255,255,255,0.9)",
};

// `dark` and `light` keep their original keys rather than being renamed to match
// their labels: they are already in saved preferences and in shared ?theme= links.
const THEMES = {
  dark: {
    name: "dark",
    icon: "🌙",
    label: "Midnight",
    feltStops: [
      [0, "#17402c"],
      [0.6, "#0e2e1f"],
      [1, "#071811"],
    ],
    vignette: 0.45,
    placeholderFill: "rgba(0,0,0,0.28)",
    placeholderStroke: "rgba(255,255,255,0.16)",
    placeholderText: "rgba(255,255,255,0.22)",
    back: CLASSIC_BACK,
  },
  light: {
    name: "light",
    icon: "☀️",
    label: "Bright",
    feltStops: [
      [0, "#2fc079"],
      [0.6, "#18a861"],
      [1, "#0c7644"],
    ],
    vignette: 0.22,
    placeholderFill: "rgba(0,0,0,0.12)",
    placeholderStroke: "rgba(255,255,255,0.5)",
    placeholderText: "rgba(255,255,255,0.55)",
    back: CLASSIC_BACK,
  },
  claret: {
    name: "claret",
    icon: "🍷",
    label: "Claret",
    feltStops: [
      [0, "#3d1420"],
      [0.6, "#2a0d16"],
      [1, "#15060b"],
    ],
    vignette: 0.42,
    placeholderFill: "rgba(0,0,0,0.3)",
    placeholderStroke: "rgba(255,255,255,0.14)",
    placeholderText: "rgba(255,255,255,0.2)",
    back: {
      from: "#c9a227",
      to: "#8a6a12",
      line: "rgba(255,255,255,0.5)",
      lattice: "rgba(255,255,255,0.14)",
      emblem: "❧",
      emblemColor: "rgba(255,255,255,0.88)",
    },
  },
  parchment: {
    name: "parchment",
    icon: "📜",
    label: "Parchment",
    feltStops: [
      [0, "#c9b48c"],
      [0.6, "#b39c73"],
      [1, "#8d7852"],
    ],
    vignette: 0.3,
    placeholderFill: "rgba(60,42,20,0.16)",
    placeholderStroke: "rgba(60,42,20,0.32)",
    placeholderText: "rgba(60,42,20,0.35)",
    back: {
      from: "#7b4b2a",
      to: "#4a2a15",
      line: "rgba(255,238,214,0.55)",
      lattice: "rgba(255,238,214,0.18)",
      emblem: "❖",
      emblemColor: "rgba(255,238,214,0.92)",
    },
  },
} as const satisfies Record<string, Omit<FeltTheme, "name"> & { name: string }>;

export type ThemeName = keyof typeof THEMES;

/** Declaration order is also cycle order, so the ☀️/🌙 button walks the list. */
export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(THEMES, v);
}

let current: ThemeName = "dark";

export function getFelt(): FeltTheme {
  return THEMES[current] as FeltTheme;
}

/** Any theme by name, not just the active one — the toggle button has to name the
 *  theme it would switch *to*. */
export function themeInfo(name: ThemeName): FeltTheme {
  return THEMES[name] as FeltTheme;
}

export function getThemeName(): ThemeName {
  return current;
}

export function setTheme(name: ThemeName): void {
  current = name;
}

/** The one after this, wrapping — what the toggle button does and what its label
 *  should promise. */
export function nextTheme(name: ThemeName = current): ThemeName {
  return THEME_NAMES[(THEME_NAMES.indexOf(name) + 1) % THEME_NAMES.length];
}
