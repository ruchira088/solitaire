// What a key press means. Pure: it takes the key and the two facts about the page that
// change the answer, and names a command — main.ts does the command. Split out of the
// keydown handler so the precedence rules below can be tested rather than re-derived
// every time a key is added.
//
// The order is the substance:
//   - Escape first, since closing the dialog is the one key a modal dialog owns.
//   - Then nothing at all while the stats dialog is open: it is `aria-modal`, and
//     `n` behind it used to deal a new game under the panel.
//   - Board keys (arrows, Space/Enter, F, 1–7) only while no dialog is up, and
//     Space/Enter only when no focused control would take them instead.
//   - Ctrl/Cmd shortcuts, and *no* single letters when a modifier is held: Cmd+N
//     used to deal a new game as well as opening a window.

import { Move as CursorMove } from "./cursor";

export type Command =
  | { kind: "escape" }
  | { kind: "navigate"; move: CursorMove }
  | { kind: "activate" }
  | { kind: "toFoundation" }
  | { kind: "column"; index: number }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "newGame" }
  | { kind: "daily" }
  | { kind: "hint" }
  | { kind: "winnable" }
  | { kind: "home" }
  | { kind: "chrome" }
  | { kind: "vegas" };

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface KeyContext {
  /** The stats dialog is up — modal, so it gets Escape and nothing else. */
  modalOpen: boolean;
  /** No dialog is up, so the arrows, Space, F and the digits are the board's. */
  boardHasKeys: boolean;
  /** A focused button or field would take Space/Enter as activation. */
  focusOwnsActivation: boolean;
}

const ARROWS: Record<string, CursorMove> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const LETTERS: Record<string, Command> = {
  n: { kind: "newGame" },
  d: { kind: "daily" },
  h: { kind: "hint" },
  w: { kind: "winnable" },
  a: { kind: "home" },
  t: { kind: "chrome" },
  v: { kind: "vegas" },
};

/** The command a key press asks for, or null for one the game leaves alone. A non-null
 *  answer for anything but Escape and the letters also means "prevent the default". */
export function keyCommand(e: KeyPress, ctx: KeyContext): Command | null {
  if (e.key === "Escape") return { kind: "escape" };
  if (ctx.modalOpen) return null;

  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (!mod && !e.altKey && ctx.boardHasKeys) {
    const arrow = ARROWS[e.key];
    if (arrow) {
      // Shift turns up/down into "take more / fewer cards with me", which is a
      // different question from "which pile", and needs its own gesture.
      const deeper = e.shiftKey && (arrow === "up" || arrow === "down");
      return { kind: "navigate", move: deeper ? (arrow === "up" ? "deeper" : "shallower") : arrow };
    }
    if (e.key === " " || e.key === "Enter") {
      return ctx.focusOwnsActivation ? null : { kind: "activate" };
    }
    if (key === "f") return { kind: "toFoundation" };
    if (key >= "1" && key <= "7" && key.length === 1) return { kind: "column", index: Number(key) - 1 };
  }

  if (mod && key === "z") return e.shiftKey ? { kind: "redo" } : { kind: "undo" };
  if (mod && key === "y") return { kind: "redo" }; // the Windows convention
  if (mod || e.altKey) return null; // leave browser shortcuts alone
  return LETTERS[key] ?? null;
}
