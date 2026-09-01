// What the statistics dialog says. The rows were built inside main.ts, where nothing
// could reach them; they're pure, so they get tested like every other pure module.

import { describe, expect, it } from "vitest";
import { fmtDuration, statGroups } from "./statsView";
import { Stats } from "./storage";

const stats = (over: Partial<Stats> = {}): Stats => ({
  played: 0,
  won: 0,
  streak: 0,
  bestStreak: 0,
  bestScore: 0,
  fastestMs: 0,
  fewestMoves: 0,
  totalMs: 0,
  pending: false,
  dailyWins: 0,
  dailyStreak: 0,
  bestDailyStreak: 0,
  lastDailyWin: "",
  dailyWonDays: [],
  ...over,
});

/** The value shown against a label, within a group. */
function row(s: Stats, today: string, group: string, label: string): string | undefined {
  const g = statGroups(s, today).find((x) => x.title === group);
  return g?.rows.find(([l]) => l === label)?.[1];
}

describe("fmtDuration", () => {
  it("shows a dash for zero, which means never rather than instantly", () => {
    expect(fmtDuration(0)).toBe("—");
    expect(fmtDuration(-1)).toBe("—");
  });

  it("is m:ss below an hour, with a padded seconds field", () => {
    expect(fmtDuration(9_000)).toBe("0:09");
    expect(fmtDuration(69_000)).toBe("1:09");
    expect(fmtDuration(3_599_000)).toBe("59:59");
  });

  it("switches to hours and minutes at an hour, since a lifetime total runs long", () => {
    expect(fmtDuration(3_600_000)).toBe("1h 0m");
    expect(fmtDuration(45_296_000)).toBe("12h 34m");
  });
});

describe("statGroups", () => {
  it("splits the lifetime record from the daily one", () => {
    expect(statGroups(stats(), "2026-09-01").map((g) => g.title)).toEqual(["Games", "Daily deal"]);
  });

  it("shows a dash rather than a rate when nothing has been played", () => {
    expect(row(stats(), "2026-09-01", "Games", "Win rate")).toBe("—");
  });

  it("rounds the win rate", () => {
    expect(row(stats({ played: 3, won: 1 }), "2026-09-01", "Games", "Win rate")).toBe("33%");
    expect(row(stats({ played: 8, won: 8 }), "2026-09-01", "Games", "Win rate")).toBe("100%");
  });

  it("dashes the bests that never happened, and prints the ones that did", () => {
    const fresh = stats();
    expect(row(fresh, "2026-09-01", "Games", "Best score")).toBe("—");
    expect(row(fresh, "2026-09-01", "Games", "Fewest moves")).toBe("—");
    expect(row(fresh, "2026-09-01", "Games", "Fastest win")).toBe("—");
    const played = stats({ bestScore: 812, fewestMoves: 97, fastestMs: 252_000 });
    expect(row(played, "2026-09-01", "Games", "Best score")).toBe("812");
    expect(row(played, "2026-09-01", "Games", "Fewest moves")).toBe("97");
    expect(row(played, "2026-09-01", "Games", "Fastest win")).toBe("4:12");
  });

  it("counts a played game of zero as 0, not a dash — it did happen", () => {
    expect(row(stats({ played: 4 }), "2026-09-01", "Games", "Won")).toBe("0");
  });

  // The point of routing through `currentDailyStreak`: the stored number can't say
  // whether the run is still live, and nothing runs at midnight to expire it.
  it("shows the live daily streak, not the stored one", () => {
    const live = stats({ dailyStreak: 6, lastDailyWin: "2026-08-31" });
    expect(row(live, "2026-09-01", "Daily deal", "Current streak")).toBe("6");
    expect(row(live, "2026-09-02", "Daily deal", "Current streak")).toBe("0"); // lapsed
    expect(row(live, "2026-08-31", "Daily deal", "Current streak")).toBe("6"); // won today
  });

  it("keeps the best daily streak even after the run lapses", () => {
    const lapsed = stats({ dailyStreak: 6, bestDailyStreak: 9, lastDailyWin: "2026-01-01" });
    expect(row(lapsed, "2026-09-01", "Daily deal", "Current streak")).toBe("0");
    expect(row(lapsed, "2026-09-01", "Daily deal", "Best streak")).toBe("9");
  });
});
