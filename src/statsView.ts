// The lifetime record as the statistics dialog shows it: the durations formatted, and
// the rows grouped. Pure — it takes a `Stats` and the day, and returns strings — so
// what the dialog claims is testable without a DOM. main.ts keeps only the part that
// turns these rows into elements.

import { currentDailyStreak, Stats } from "./storage";

/** Durations for the stats list: minutes and seconds up to an hour, then hours and
 *  minutes, since a lifetime total runs long. A zero means *never*, which is why it
 *  shows a dash rather than a misleading 0:00. */
export function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
}

/** A count, or a dash when it never happened — the same reading of 0 as `fmtDuration`
 *  gives a duration, so a fresh record reads consistently down the column. */
function dash(n: number): string {
  return n > 0 ? String(n) : "—";
}

export interface StatGroup {
  title: string;
  rows: [string, string][];
}

/** The record, in two groups. Twelve rows in one list read as a wall, and the daily
 *  counters answer a different question from the lifetime ones — so they get their own
 *  heading rather than trailing off the bottom of the same column. */
export function statGroups(s: Stats, today: string): StatGroup[] {
  return [
    {
      title: "Games",
      rows: [
        ["Played", String(s.played)],
        ["Won", String(s.won)],
        ["Win rate", s.played === 0 ? "—" : `${Math.round((s.won / s.played) * 100)}%`],
        ["Current streak", String(s.streak)],
        ["Best streak", String(s.bestStreak)],
        ["Best score", dash(s.bestScore)],
        ["Fastest win", fmtDuration(s.fastestMs)],
        ["Fewest moves", dash(s.fewestMoves)],
        ["Time played", fmtDuration(s.totalMs)],
      ],
    },
    {
      title: "Daily deal",
      rows: [
        // The live streak, not the stored one: a run that lapsed reads as 0 here
        // without anything having to run at midnight to expire it.
        ["Current streak", String(currentDailyStreak(s, today))],
        ["Best streak", String(s.bestDailyStreak)],
        ["Dailies won", String(s.dailyWins)],
      ],
    },
  ];
}
