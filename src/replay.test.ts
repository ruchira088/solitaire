// The replay's pacing: it waits for the board to settle, stops on a refused move, and
// a stop really stops.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Replay, REPLAY_PAUSE_MS } from "./replay";
import type { GameMove } from "./solver";

const MOVE: GameMove = { from: { kind: "waste" }, fromIndex: 0, to: { kind: "tableau", index: 0 } };
const line = (n: number): GameMove[] => Array.from({ length: n }, () => MOVE);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis); // the module schedules through window.setTimeout
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function harness(over: { step?: () => boolean; settled?: () => boolean } = {}) {
  const ends: boolean[] = [];
  let steps = 0;
  const replay = new Replay({
    step: () => {
      steps++;
      return over.step ? over.step() : true;
    },
    settled: over.settled ?? (() => true),
    onEnd: (finished) => ends.push(finished),
  });
  return { replay, ends, steps: () => steps };
}

describe("Replay", () => {
  it("plays every move, then reports a finished line", () => {
    const h = harness();
    h.replay.start(line(3));
    expect(h.replay.active).toBe(true);
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 10);
    expect(h.steps()).toBe(3);
    expect(h.ends).toEqual([true]);
    expect(h.replay.active).toBe(false);
  });

  it("makes no move while the cards are still moving", () => {
    let settled = false;
    const h = harness({ settled: () => settled });
    h.replay.start(line(2));
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 10);
    expect(h.steps()).toBe(0);
    settled = true;
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 10);
    expect(h.steps()).toBe(2);
  });

  it("stops, unfinished, at a move the board refuses", () => {
    const h = harness({ step: () => false });
    h.replay.start(line(5));
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 10);
    expect(h.steps()).toBe(1);
    expect(h.ends).toEqual([false]);
  });

  it("goes quiet on stop: no more moves and no end report", () => {
    const h = harness();
    h.replay.start(line(5));
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 2 + 1);
    h.replay.stop();
    const made = h.steps();
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 10);
    expect(h.steps()).toBe(made);
    expect(h.ends).toEqual([]);
  });

  it("lets a new line replace one still running", () => {
    const h = harness();
    h.replay.start(line(50));
    vi.advanceTimersByTime(REPLAY_PAUSE_MS + 1);
    h.replay.start(line(1));
    vi.advanceTimersByTime(REPLAY_PAUSE_MS * 10);
    expect(h.ends).toEqual([true]);
    expect(h.steps()).toBe(2);
  });
});
