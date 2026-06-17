// Light / dark table themes for the canvas. The toolbar / page chrome is themed
// via a body class in CSS; this module covers everything drawn on the canvas
// (the felt, vignette, and empty-pile placeholders).

export type ThemeName = "dark" | "light";

export interface FeltTheme {
  name: ThemeName;
  /** Radial gradient colour stops for the table felt. */
  feltStops: [number, string][];
  /** Vignette darkness at the edges (0..1). */
  vignette: number;
  placeholderFill: string;
  placeholderStroke: string;
  placeholderText: string;
}

const DARK: FeltTheme = {
  name: "dark",
  feltStops: [
    [0, "#17402c"],
    [0.6, "#0e2e1f"],
    [1, "#071811"],
  ],
  vignette: 0.45,
  placeholderFill: "rgba(0,0,0,0.28)",
  placeholderStroke: "rgba(255,255,255,0.16)",
  placeholderText: "rgba(255,255,255,0.22)",
};

const LIGHT: FeltTheme = {
  name: "light",
  feltStops: [
    [0, "#2fc079"],
    [0.6, "#18a861"],
    [1, "#0c7644"],
  ],
  vignette: 0.22,
  placeholderFill: "rgba(0,0,0,0.12)",
  placeholderStroke: "rgba(255,255,255,0.5)",
  placeholderText: "rgba(255,255,255,0.55)",
};

let current: ThemeName = "dark";

export function getFelt(): FeltTheme {
  return current === "dark" ? DARK : LIGHT;
}

export function getThemeName(): ThemeName {
  return current;
}

export function setTheme(name: ThemeName): void {
  current = name;
}
