// The received-challenges list: filing what arrives, remembering what beat it, and
// reading it back out of storage.

import { describe, expect, it } from "vitest";
import {
  Challenge,
  CHALLENGES_KEPT,
  challengeRow,
  isBeaten,
  parseChallenges,
  receiveChallenge,
  recordBoardWin,
} from "./challenges";
import { dailySeed } from "./rng";

const TODAY = "2026-10-24";

function arrival(over: Partial<Challenge> = {}): Omit<Challenge, "best"> {
  return {
    seed: 1234,
    drawCount: 1,
    vegas: false,
    score: 500,
    moves: 120,
    elapsedMs: 300_000,
    received: TODAY,
    ...over,
  };
}

describe("receiveChallenge", () => {
  it("puts the newest first", () => {
    let list = receiveChallenge([], arrival({ seed: 1 }));
    list = receiveChallenge(list, arrival({ seed: 2 }));
    expect(list.map((c) => c.seed)).toEqual([2, 1]);
  });

  it("files the same link opened twice once, keeping its best", () => {
    let list = receiveChallenge([], arrival());
    list = recordBoardWin(list, arrival(), 600);
    list = receiveChallenge(list, arrival({ seed: 9 }));
    list = receiveChallenge(list, arrival());
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ seed: 1234, best: 600 });
  });

  it("starts a new result on a known board from your best there", () => {
    let list = receiveChallenge([], arrival());
    list = recordBoardWin(list, arrival(), 600);
    list = receiveChallenge(list, arrival({ score: 700 }));
    expect(list[0]).toMatchObject({ score: 700, best: 600 });
  });

  it(`keeps only the newest ${CHALLENGES_KEPT}`, () => {
    let list: Challenge[] = [];
    for (let i = 0; i < CHALLENGES_KEPT + 5; i++) list = receiveChallenge(list, arrival({ seed: i }));
    expect(list).toHaveLength(CHALLENGES_KEPT);
    expect(list[0].seed).toBe(CHALLENGES_KEPT + 4);
  });
});

describe("recordBoardWin", () => {
  it("touches only challenges on the same deal, draw count and rules", () => {
    let list = receiveChallenge([], arrival());
    list = receiveChallenge(list, arrival({ drawCount: 3 }));
    list = receiveChallenge(list, arrival({ vegas: true }));
    list = recordBoardWin(list, { seed: 1234, drawCount: 1, vegas: false }, 650);
    expect(list.map((c) => c.best)).toEqual([0, 0, 650]);
  });

  it("never lowers a best", () => {
    let list = recordBoardWin(receiveChallenge([], arrival()), arrival(), 650);
    list = recordBoardWin(list, arrival(), 300);
    expect(list[0].best).toBe(650);
  });
});

describe("isBeaten", () => {
  it("needs strictly more — a tie isn't a win", () => {
    expect(isBeaten({ ...arrival(), best: 500 })).toBe(false);
    expect(isBeaten({ ...arrival(), best: 501 })).toBe(true);
  });
});

describe("parseChallenges", () => {
  it("round-trips a good list", () => {
    const list = recordBoardWin(receiveChallenge([], arrival()), arrival(), 650);
    expect(parseChallenges(JSON.parse(JSON.stringify(list)))).toEqual(list);
  });

  it("drops a bad entry and keeps the rest", () => {
    const good = { ...arrival(), best: 0 };
    const bad = [
      { ...good, seed: -1 },
      { ...good, drawCount: 2 },
      { ...good, vegas: "no" },
      { ...good, score: 1.5 },
      { ...good, received: "yesterday" },
      { ...good, best: undefined },
      null,
      "x",
    ];
    expect(parseChallenges([...bad, good])).toEqual([good]);
  });

  it("reads anything that isn't a list as empty", () => {
    expect(parseChallenges({})).toEqual([]);
    expect(parseChallenges(null)).toEqual([]);
  });
});

describe("challengeRow", () => {
  it("names today's daily and the score to beat", () => {
    const c = { ...arrival({ seed: dailySeed(TODAY) }), best: 0 };
    expect(challengeRow(c, TODAY)).toEqual({
      board: "Today's daily deal · Draw 1",
      standing: "500 to beat",
    });
  });

  it("says when it's been beaten, and by what", () => {
    expect(challengeRow({ ...arrival(), best: 612 }, TODAY).standing).toBe(
      "500 to beat · beaten with 612 ✓",
    );
  });

  it("shows a best that hasn't beaten it yet", () => {
    expect(challengeRow({ ...arrival(), best: 400 }, TODAY).standing).toBe(
      "500 to beat · your best 400",
    );
  });
});
