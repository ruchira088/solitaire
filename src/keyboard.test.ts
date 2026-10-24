// Key precedence: what each press means, and above all what it must *not* mean while
// a dialog is up or a control has focus.

import { describe, expect, it } from "vitest";
import { KeyContext, keyCommand, KeyPress } from "./keyboard";

const press = (key: string, over: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

const BOARD: KeyContext = { modalOpen: false, boardHasKeys: true, focusOwnsActivation: false };
const MODAL: KeyContext = { modalOpen: true, boardHasKeys: false, focusOwnsActivation: false };
const WIN_PANEL: KeyContext = { modalOpen: false, boardHasKeys: false, focusOwnsActivation: false };

describe("keyCommand", () => {
  it("maps the arrows, and Shift with up/down to taking more or fewer cards", () => {
    expect(keyCommand(press("ArrowLeft"), BOARD)).toEqual({ kind: "navigate", move: "left" });
    expect(keyCommand(press("ArrowUp", { shiftKey: true }), BOARD)).toEqual({
      kind: "navigate",
      move: "deeper",
    });
    expect(keyCommand(press("ArrowDown", { shiftKey: true }), BOARD)).toEqual({
      kind: "navigate",
      move: "shallower",
    });
  });

  it("jumps to columns 1–7 and nothing past them", () => {
    expect(keyCommand(press("1"), BOARD)).toEqual({ kind: "column", index: 0 });
    expect(keyCommand(press("7"), BOARD)).toEqual({ kind: "column", index: 6 });
    expect(keyCommand(press("8"), BOARD)).toBeNull();
  });

  it("gives Space and Enter to a focused control rather than the board", () => {
    expect(keyCommand(press(" "), BOARD)).toEqual({ kind: "activate" });
    expect(keyCommand(press("Enter"), { ...BOARD, focusOwnsActivation: true })).toBeNull();
  });

  it("lets Escape through a modal dialog, and nothing else", () => {
    expect(keyCommand(press("Escape"), MODAL)).toEqual({ kind: "escape" });
    for (const k of ["n", "ArrowLeft", " ", "f", "3"]) expect(keyCommand(press(k), MODAL)).toBeNull();
    expect(keyCommand(press("z", { ctrlKey: true }), MODAL)).toBeNull();
  });

  it("keeps the letters and undo live behind the win panel, which isn't modal", () => {
    expect(keyCommand(press("n"), WIN_PANEL)).toEqual({ kind: "newGame" });
    expect(keyCommand(press("z", { metaKey: true }), WIN_PANEL)).toEqual({ kind: "undo" });
    expect(keyCommand(press("ArrowLeft"), WIN_PANEL)).toBeNull();
  });

  it("reads Ctrl/Cmd+Z as undo, with Shift or Ctrl+Y as redo", () => {
    expect(keyCommand(press("z", { ctrlKey: true }), BOARD)).toEqual({ kind: "undo" });
    expect(keyCommand(press("Z", { metaKey: true, shiftKey: true }), BOARD)).toEqual({ kind: "redo" });
    expect(keyCommand(press("y", { ctrlKey: true }), BOARD)).toEqual({ kind: "redo" });
  });

  it("leaves modified letters to the browser — Cmd+N must not also deal", () => {
    expect(keyCommand(press("n", { metaKey: true }), BOARD)).toBeNull();
    expect(keyCommand(press("a", { altKey: true }), BOARD)).toBeNull();
  });

  it("maps every single-letter shortcut", () => {
    const letters = { n: "newGame", d: "daily", h: "hint", w: "winnable", a: "home", t: "chrome" };
    for (const [k, kind] of Object.entries(letters)) {
      expect(keyCommand(press(k), BOARD), k).toEqual({ kind });
      expect(keyCommand(press(k.toUpperCase()), BOARD), k).toEqual({ kind });
    }
  });
});
