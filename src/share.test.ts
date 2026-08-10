// The shared result text. It gets pasted into chat windows, so the shape matters:
// three lines, and the link always the last of them.

import { describe, expect, it } from "vitest";
import { formatClock, shareText, WinSummary } from "./share";

const win = (over: Partial<WinSummary> = {}): WinSummary => ({
  score: 336,
  moves: 118,
  elapsedMs: 252_000,
  url: "https://solitaire.ruchij.com/?deal=UA2WB9",
  code: "UA2WB9",
  ...over,
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [1_000, "0:01"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [252_000, "4:12"],
    [3_600_000, "60:00"], // runs past an hour rather than wrapping to 0:00
  ])("renders %pms as %p", (ms, expected) => {
    expect(formatClock(ms)).toBe(expected);
  });

  it("floors rather than rounds, so the clock never shows a second early", () => {
    expect(formatClock(1_999)).toBe("0:01");
  });

  it("treats a negative elapsed as zero", () => {
    expect(formatClock(-5_000)).toBe("0:00");
  });
});

describe("shareText", () => {
  it("names the deal code when the game wasn't the daily", () => {
    expect(shareText(win())).toBe(
      "Solitaire · Deal UA2WB9\n" +
        "Score 336 · 4:12 · 118 moves\n" +
        "https://solitaire.ruchij.com/?deal=UA2WB9",
    );
  });

  it("leads with the date and carries the streak for a daily", () => {
    expect(shareText(win({ daily: { key: "2026-08-10", streak: 4 } }))).toBe(
      "Solitaire · Daily 2026-08-10\n" +
        "Score 336 · 4:12 · 118 moves  🔥4\n" +
        "https://solitaire.ruchij.com/?deal=UA2WB9",
    );
  });

  it("leaves the flame off a daily with no streak to show", () => {
    const text = shareText(win({ daily: { key: "2026-08-10", streak: 0 } }));
    expect(text).toContain("Daily 2026-08-10");
    expect(text).not.toContain("🔥");
  });

  it("says 'move' for a one-move game", () => {
    expect(shareText(win({ moves: 1 }))).toContain("1 move\n");
  });

  it("always puts the url last and on its own line", () => {
    for (const w of [win(), win({ daily: { key: "2026-08-10", streak: 9 } })]) {
      const lines = shareText(w).split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[2]).toBe(w.url);
    }
  });

  it("carries whatever url it is given, so a shared link matches the address bar", () => {
    const w = win({ url: "http://localhost:5173/?deal=ABC&draw=3", code: "ABC" });
    expect(shareText(w)).toContain("http://localhost:5173/?deal=ABC&draw=3");
  });
});
