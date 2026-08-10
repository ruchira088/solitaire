// Regenerates screenshots/*.png — the images the README embeds.
//
// Why a script: every one of these shows the toolbar, so adding or removing a single
// button dates the whole set at once, and reshooting by hand invites a board that
// quietly differs between shots. One deal (MID_SEED) carries the five board shots, so
// they read as one game seen five ways.
//
// This is a one-off; the output is committed. Re-run it when the toolbar, the board
// layout or the dialogs change:
//
//     npm run screenshots
//     ONLY=win,stats npm run screenshots     # just those two
//
// It starts its own Vite dev server on a free port, so nothing needs to be running
// first and it can't collide with `npm run dev`. Chrome is the renderer because
// Chrome is what draws these for real users.
//
// cards.png is card art, produced by cards:rasterize, and is not touched here.
//
// Three things make a run reproducible rather than fiddly, and all three have gone
// wrong at least once:
//
//   1. Boards are built with the real `Game`, through its own API, and injected as a
//      v:2 save. A hand-written pile is not necessarily a state parseGameState
//      accepts; one built by playing legal moves always is.
//   2. After injecting, `goto` the clean URL again — never reload(). By then
//      syncDealUrl() has written a ?deal= into the address, and a ?deal= naming a
//      different layout makes the boot rule throw the save away for a fresh deal.
//      Hence the "Resume game" assertion: without it a run silently photographs a
//      random board.
//   3. Draw one card after dismissing the overlay. A resumed game carries no undo
//      history, so otherwise every shot shows Undo and Redo greyed out.
//
// Six of the seven come out byte-identical run to run. win.png cannot: the cascade is
// physics seeded with Math.random() and sampled on a wall-clock delay, so re-running
// it always produces a diff. That is expected, not a regression — don't chase it.

import { chromium } from "playwright-core";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "screenshots");

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Chosen by scoring seeds on foundation progress, face-down count, column balance
 *  and stock left, for a board that looks like a real game in progress. */
const MID_SEED = 116;
const MID_MOVES = 40;

// A resumed game shows the clock it was saved with, so these are the times on the
// shots rather than anything the run measures.
const MID_ELAPSED = 97_000; // 1:37
const WIN_ELAPSED = 402_000; // 6:42

const DAILY_KEY = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const STATS = JSON.stringify({
  v: 1, played: 42, won: 17, streak: 3, bestStreak: 6, bestScore: 1240,
  fastestMs: 268_000, fewestMoves: 104, totalMs: 9_480_000, pending: false,
  dailyWins: 9, dailyStreak: 4, bestDailyStreak: 7, lastDailyWin: DAILY_KEY,
});

/** Best score set below what the win board scores, so the panel shows the record line. */
const STATS_PRE_WIN = JSON.stringify({
  v: 1, played: 41, won: 16, streak: 2, bestStreak: 6, bestScore: 900,
  fastestMs: 268_000, fewestMoves: 104, totalMs: 9_000_000, pending: false,
});

const SHOTS = {
  gameplay: { w: 1280, h: 820, board: "mid", draw: true },
  "gameplay-light": { w: 1280, h: 820, board: "mid", draw: true, query: "?theme=light" },
  "spare-pile": { w: 1280, h: 820, board: "spares", draw: true },
  "toolbar-hidden": { w: 1000, h: 700, board: "mid", draw: true, prefs: { "solitaire-chrome": "hidden" } },
  stats: { w: 1000, h: 700, board: "mid", prefs: { "solitaire-stats": STATS }, dialog: "#btn-stats" },
  win: { w: 1280, h: 706, board: "won", elapsed: WIN_ELAPSED, prefs: { "solitaire-stats": STATS_PRE_WIN }, settle: 9000 },
  iphone: { w: 390, h: 844, dpr: 2, mobile: true, board: "mid", draw: true },
};

const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const names = Object.keys(SHOTS).filter((n) => !only || only.includes(n));
if (names.length === 0) throw new Error(`ONLY matched no shots; known: ${Object.keys(SHOTS).join(", ")}`);

/** Build the board in the page and leave it in localStorage as a v:2 save. Everything
 *  here runs in the browser, against the app's own modules. */
async function inject(page, spec) {
  return page.evaluate(async (spec) => {
    const { Game, parseGameState } = await import("/src/game.ts");

    // A greedy player: foundation moves, then a tableau run that reveals a face-down
    // card or lands a King, then the waste, then draw. `findHint` used to serve this
    // purpose and was removed with the Hint button, so it lives here now.
    const step = (g) => {
      const srcs = [{ kind: "waste" }, ...g.tableau.map((_, i) => ({ kind: "tableau", index: i }))];
      for (const s of srcs) {
        const pile = g.getPile(s);
        if (!pile.length) continue;
        const f = g.foundationTargetFor(pile[pile.length - 1]);
        if (f >= 0) return g.moveCards(s, pile.length - 1, { kind: "foundation", index: f });
      }
      for (let c = 0; c < 7; c++) {
        const col = g.tableau[c];
        const first = col.findIndex((x) => x.faceUp);
        if (first < 0) continue;
        const run = col.slice(first);
        if (!g.isValidRun(run)) continue;
        for (let d = 0; d < 7; d++) {
          if (d === c || !g.canMoveToTableau(run[0], d)) continue;
          const fromEmpty = first === 0 && g.tableau[d].length > 0;
          if (first > 0 || (run[0].rank === 13 && !fromEmpty)) {
            return g.moveCards({ kind: "tableau", index: c }, first, { kind: "tableau", index: d });
          }
        }
      }
      if (g.waste.length) {
        const c = g.waste[g.waste.length - 1];
        for (let d = 0; d < 7; d++) {
          if (g.canMoveToTableau(c, d)) {
            return g.moveCards({ kind: "waste" }, g.waste.length - 1, { kind: "tableau", index: d });
          }
        }
      }
      if (g.stock.length || g.waste.length) return g.drawFromStock();
      return null;
    };
    const play = (g, maxMoves) => {
      for (let i = 0; i < 4000 && g.moves < maxMoves; i++) if (!step(g)) break;
      return g;
    };

    let g = new Game(1, spec.seed);
    if (spec.board === "mid" || spec.board === "spares") {
      play(g, spec.midMoves);
    }
    if (spec.board === "spares") {
      // Park the longest face-up run on a ✦ stack — preferring one that empties its
      // column outright — then buy a second, empty stack to show alongside it.
      g.addTempStack();
      let best = -1, bestFirst = 0, bestScore = 0;
      for (let c = 0; c < 7; c++) {
        const col = g.tableau[c];
        const first = col.findIndex((x) => x.faceUp);
        if (first < 0) continue;
        const run = col.slice(first);
        if (!g.isValidRun(run)) continue;
        const score = run.length + (first === 0 ? 10 : 0);
        if (score > bestScore) { bestScore = score; best = c; bestFirst = first; }
      }
      if (best < 0) throw new Error("no run available to park on a ✦ stack");
      g.moveCards({ kind: "tableau", index: best }, bestFirst, { kind: "spare", index: 0 });
      g.addTempStack();
    }
    if (spec.board === "won") {
      // The greedy player above cannot win a game — over 200 seeds its best result is
      // 40 of 52 cards home — so this one board is assembled rather than played, and
      // checked against parseGameState instead, which is the property that matters.
      // A..J are home and the queens and kings are still out; the app's own
      // auto-complete sweeps the last eight and starts the cascade. At +10 a card and
      // -1 a move that lands the finished game on 122 moves and 980 points.
      const up = (id) => id + 52;
      const state = {
        seed: spec.seed, drawCount: 1, easy: false, moves: 114, score: 908,
        stock: [], waste: [],
        foundations: [0, 1, 2, 3].map((s) => Array.from({ length: 11 }, (_, r) => up(s * 13 + r))),
        tableau: [
          [up(11)], [up(24)], [up(37)], [up(50)],
          [up(12)], [up(25)], [up(38), up(51)],
        ],
        spares: [],
      };
      if (!parseGameState(state)) throw new Error("assembled win board is not a state the game accepts");
      g.restore(state);
    }

    localStorage.setItem(
      "solitaire-game",
      JSON.stringify({ v: 2, elapsed: spec.elapsed, state: g.serialize() }),
    );
    for (const [k, v] of Object.entries(spec.prefs ?? {})) localStorage.setItem(k, v);
  }, spec);
}

/** Click the stock, so the resumed game has one undoable move behind it. The position
 *  comes from the app's own computeLayout, so this is right at every viewport. */
async function drawOne(page) {
  const at = await page.evaluate(async () => {
    const { computeLayout } = await import("/src/layout.ts");
    const r = document.getElementById("board").getBoundingClientRect();
    const save = JSON.parse(localStorage.getItem("solitaire-game") ?? "{}");
    const L = computeLayout(r.width, r.height, save?.state?.spares?.length ?? 0);
    return { x: r.left + L.stock.x + L.cardW / 2, y: r.top + L.stock.y + L.cardH / 2 };
  });
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(350);
}

const server = await createServer({ root, server: { port: 0 }, logLevel: "warn" });
await server.listen();
const base = server.resolvedUrls?.local?.[0];
if (!base) throw new Error("vite did not report a local url");

const browser = await chromium.launch({ executablePath: CHROME });
const problems = [];

try {
  for (const name of names) {
    const spec = SHOTS[name];
    const url = base + (spec.query ?? "");
    const page = await browser.newPage({
      viewport: { width: spec.w, height: spec.h },
      deviceScaleFactor: spec.dpr ?? 1,
      isMobile: !!spec.mobile,
      hasTouch: !!spec.mobile,
    });
    page.on("pageerror", (e) => problems.push(`${name}: pageerror ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: ${m.text()}`); });

    await page.goto(url, { waitUntil: "networkidle" });
    await inject(page, {
      board: spec.board,
      seed: spec.board === "won" ? 8675309 : MID_SEED,
      midMoves: MID_MOVES,
      elapsed: spec.elapsed ?? MID_ELAPSED,
      prefs: spec.prefs,
    });
    await page.goto(url, { waitUntil: "networkidle" }); // clean url — never reload()

    const title = await page.textContent(".start-title");
    if (title !== "Resume game") {
      throw new Error(`${name}: the injected save was dropped — overlay said "${title}"`);
    }
    await page.click("#start-btn");
    await page.waitForTimeout(spec.settle ?? 400);
    if (spec.draw) await drawOne(page);
    if (spec.dialog) {
      await page.click(spec.dialog);
      await page.waitForTimeout(400);
    }

    await page.screenshot({ path: join(OUT, `${name}.png`) });
    const s = await page.evaluate(() => ({
      moves: document.getElementById("stat-moves").textContent,
      score: document.getElementById("stat-score").textContent,
    }));
    console.log(`  ${`${name}.png`.padEnd(22)} ${`${spec.w}x${spec.h}`.padEnd(10)} ${s.moves} moves, ${s.score} points`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.error(`\n${problems.length} console error(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\n${names.length} screenshot(s) written to screenshots/, no console errors.`);
}
