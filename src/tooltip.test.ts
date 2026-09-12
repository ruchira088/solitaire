// The tooltip's one piece of pure logic: peeling a trailing keyboard shortcut off a
// tip so it can be drawn as a key chip. The DOM half is covered by `npm run smoke`.

import { describe, expect, it } from "vitest";
import { parseTip } from "./tooltip";

describe("parseTip", () => {
  it("splits a trailing single-key shortcut into a chip", () => {
    expect(parseTip("Hide the toolbar (T)")).toEqual({ label: "Hide the toolbar", key: "T" });
  });

  it("keeps modifier combinations as one chip", () => {
    expect(parseTip("Undo last move (Ctrl+Z)")).toEqual({ label: "Undo last move", key: "Ctrl+Z" });
    expect(parseTip("Redo (Ctrl+Shift+Z)")).toEqual({ label: "Redo", key: "Ctrl+Shift+Z" });
  });

  it("leaves a tip with no shortcut alone", () => {
    expect(parseTip("Can this deal still be won?")).toEqual({
      label: "Can this deal still be won?",
      key: null,
    });
  });

  it("does not mistake other parenthesised text for a shortcut", () => {
    // A date, and a prose aside — both end in ")" and neither is a key.
    expect(parseTip("Today's deal — won (2026-09-13)")).toEqual({
      label: "Today's deal — won (2026-09-13)",
      key: null,
    });
    const stack = "Add a temporary ✦ stack (−50 points, max 3; it disappears when emptied)";
    expect(parseTip(stack)).toEqual({ label: stack, key: null });
  });

  it("only treats a shortcut at the very end as a chip", () => {
    expect(parseTip("(T) is the key")).toEqual({ label: "(T) is the key", key: null });
  });
});
