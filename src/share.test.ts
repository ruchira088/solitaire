// The shared result text. It gets pasted into chat windows, so the shape matters:
// three lines, and the link always the last of them.

import { describe, expect, it } from "vitest";
import {
  boardLine,
  encodeResult,
  formatClock,
  parseResult,
  resultLine,
  shareText,
  WinSummary,
} from "./share";

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

describe("resultLine", () => {
  it("is the line shareText carries, so the two can't disagree", () => {
    const w = win();
    expect(shareText(w)).toContain(`\n${resultLine(w)}\n`);
  });
});

// The `win=` payload. It is read straight off a URL anyone can edit, so what it
// rejects matters as much as what it round-trips.
describe("encodeResult / parseResult", () => {
  it("round-trips a result, to the second", () => {
    expect(parseResult(encodeResult({ score: 527, moves: 154, elapsedMs: 278_400 }))).toEqual({
      score: 527,
      moves: 154,
      elapsedMs: 278_000,
    });
  });

  it("encodes score, moves and whole seconds, in that order", () => {
    expect(encodeResult({ score: 527, moves: 154, elapsedMs: 278_400 })).toBe("527-154-278");
  });

  it("floors the clock the same way formatClock does", () => {
    const r = parseResult(encodeResult({ score: 1, moves: 1, elapsedMs: 59_999 }))!;
    expect(formatClock(r.elapsedMs)).toBe("0:59");
  });

  it("clamps rather than emitting something unparseable", () => {
    expect(encodeResult({ score: -20, moves: 0, elapsedMs: -1 })).toBe("0-0-0");
    expect(parseResult(encodeResult({ score: 1e12, moves: 3, elapsedMs: 0 }))).toEqual({
      score: 9_999_999,
      moves: 3,
      elapsedMs: 0,
    });
    expect(encodeResult({ score: NaN, moves: 2, elapsedMs: 0 })).toBe("0-2-0");
  });

  it.each([
    ["", "empty"],
    ["527-154", "two fields"],
    ["527-154-278-1", "four fields"],
    ["527_154_278", "wrong separator"],
    ["-1-154-278", "a negative"],
    ["1.5-154-278", "a fraction"],
    ["a-b-c", "letters"],
    ["12345678-1-1", "past the field width"],
    ["<script>", "junk"],
  ])("rejects %p (%s)", (payload) => {
    expect(parseResult(payload)).toBeNull();
  });

  it("rejects a missing param rather than inventing a zero score", () => {
    expect(parseResult(null)).toBeNull();
    expect(parseResult(undefined)).toBeNull();
  });

  it("tolerates the whitespace a pasted link can pick up", () => {
    expect(parseResult(" 527-154-278 ")).toEqual({ score: 527, moves: 154, elapsedMs: 278_000 });
  });
});

// Which board the challenge is on. Whether it was a daily is derived from the seed
// by the caller, so this only has to say it well.
describe("boardLine", () => {
  it("names the deal code for an ordinary board", () => {
    expect(boardLine({ code: "DWLVHU", drawCount: 1 })).toBe("Deal DWLVHU · Draw 1");
  });

  it("carries the draw mode, since a score only compares within one", () => {
    expect(boardLine({ code: "DWLVHU", drawCount: 3 })).toBe("Deal DWLVHU · Draw 3");
  });

  it("says today's daily when the board is today's", () => {
    expect(
      boardLine({ code: "X", drawCount: 1, dailyKey: "2026-08-20", todayKey: "2026-08-20" }),
    ).toBe("Today's daily deal · Draw 1");
  });

  it("dates an older daily rather than claiming it is today's", () => {
    expect(
      boardLine({ code: "X", drawCount: 1, dailyKey: "2026-08-19", todayKey: "2026-08-20" }),
    ).toBe("Daily deal · 2026-08-19 · Draw 1");
  });

  it("falls back to the code when the board is no daily at all", () => {
    expect(boardLine({ code: "UA2WB9", drawCount: 1, dailyKey: null, todayKey: "2026-08-20" })).toBe(
      "Deal UA2WB9 · Draw 1",
    );
  });
});
