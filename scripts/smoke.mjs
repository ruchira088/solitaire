// Boots the built bundle in real Chrome and checks the game actually works.
//
// Why: `npm test` covers the pure modules by design — game, cards, layout, storage —
// which leaves render.ts, input.ts, animation.ts and main.ts, well over half the
// source, gated by nothing but the type checker. Everything those files can get wrong
// is invisible to tsc: a canvas that never paints, a listener wired to a button that
// no longer exists, a toolbar that silently wraps onto a second row. This is the
// cheapest net that catches that class.
//
//     npm run build && npm run smoke
//
// It serves dist/ with Vite's preview server on a free port, so it exercises the
// bundle that actually deploys rather than the dev server's module graph. That is
// also why every assertion goes through the DOM: there is no /src/*.ts to import in a
// production build, so nothing here may reach into the app's modules. Interactions
// are driven from the toolbar for the same reason — no canvas coordinates, which
// would be fragile across viewports.
//
// Deliberately not a vitest file: vitest.config.ts scopes `npm test` to the pure
// suite, and mixing a browser run into it would put Chrome on the path of every
// `npm test`.

import { chromium } from "playwright-core";
import { preview } from "vite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** System Chrome, wherever this is running — a mac desktop or a CI runner.
 *  playwright-core downloads no browsers, which is the whole point of `-core`. */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `no system Chrome found. Tried:\n  ${candidates.join("\n  ")}\nSet CHROME_PATH to override.`,
    );
  }
  return found;
}

if (!existsSync(join(root, "dist", "index.html"))) {
  throw new Error("dist/index.html is missing — run `npm run build` first");
}

const failures = [];
let checks = 0;

function check(label, ok, detail = "") {
  checks++;
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

const server = await preview({ root, preview: { port: 0 } });
const base = server.resolvedUrls?.local?.[0];
if (!base) throw new Error("vite preview did not report a local url");

const browser = await chromium.launch({
  executablePath: findChrome(),
  // Hosted runners vary on whether the sandbox can start; it buys nothing here, where
  // the only page loaded is our own bundle off localhost.
  args: process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
});

/** Anything the page logs as an error, or throws, fails the run. A broken image, a
 *  dead import or an exception in the frame loop all surface here. */
function watch(page, where) {
  const seen = [];
  page.on("pageerror", (e) => seen.push(`${where}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") seen.push(`${where}: ${m.text()}`); });
  return seen;
}

try {
  // ---- desktop -------------------------------------------------------------
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const logged = watch(page, "desktop");

  await page.goto(base, { waitUntil: "networkidle" });
  check("the page boots and shows the start overlay", await page.isVisible("#start-btn"));

  await page.click("#start-btn");
  await page.waitForTimeout(2500); // the opening deal is animated

  // The single most valuable assertion here: the canvas has actually painted cards.
  // Card faces are the only near-white thing on screen — the felt is dark green in
  // either theme — so counting light pixels distinguishes "dealt a board" from "drew
  // nothing at all", which is what a broken render path looks like.
  const white = await page.evaluate(() => {
    const c = document.getElementById("board");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let light = 0, total = 0;
    for (let i = 0; i < d.length; i += 4 * 97) { // stride: a sample, not every pixel
      total++;
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
    }
    return light / total;
  });
  check(
    "the canvas painted a dealt board",
    white > 0.05 && white < 0.95,
    `${(white * 100).toFixed(1)}% of sampled pixels are card-white`,
  );

  // The regression this file exists for: at 1280 the bar must stay on one row.
  check(
    "the toolbar fits on one row at 1280x820",
    !(await page.evaluate(() => document.getElementById("toolbar").classList.contains("needs-toggle"))),
  );

  const moves = () => page.textContent("#stat-moves");
  const disabled = (sel) => page.evaluate((s) => document.querySelector(s).disabled, sel);

  check("a fresh game starts at zero moves", (await moves()) === "0");
  check("undo starts disabled", await disabled("#btn-undo"));

  // Hash of sampled canvas pixels: enough to tell "the picture moved" from "the
  // picture is stale", which is the failure mode main.ts's paint gate can cause.
  const canvasSig = () => page.evaluate(() => {
    const c = document.getElementById("board");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4 * 31) {
      h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7;
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  });

  // A full round trip through game -> layout -> render, driven from the toolbar so no
  // canvas coordinates are involved: buying a ✦ stack is a counted move and adds a
  // board column.
  const sigBefore = await canvasSig();
  await page.click("#btn-add-stack");
  await page.waitForTimeout(500);
  check("buying a ✦ stack counts a move", (await moves()) === "1", `moves = ${await moves()}`);
  // main.ts only repaints when something marked the board dirty. A missed invalidate
  // leaves the player looking at a board that no longer matches the game.
  check("the board repaints after a move", (await canvasSig()) !== sigBefore);
  check("undo is enabled after a move", !(await disabled("#btn-undo")));

  await page.click("#btn-undo");
  await page.waitForTimeout(500);
  check("undo takes the move back", (await moves()) === "0", `moves = ${await moves()}`);

  // The daily deal is wired end to end: it deals, and it puts its code in the address.
  await page.click("#btn-daily");
  await page.waitForTimeout(800);
  check(
    "the daily deal deals and marks itself active",
    /[?&]deal=/.test(page.url()) &&
      (await page.evaluate(() => document.getElementById("btn-daily").classList.contains("is-active"))),
    page.url(),
  );

  // Both dialogs, including the Escape path that runs ahead of the drag cancel.
  await page.click("#btn-stats");
  await page.waitForTimeout(300);
  check("the stats dialog opens", await page.isVisible("#stats-panel"));
  const archive = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".archive-day")];
    return { count: cells.length, today: cells.filter((c) => c.classList.contains("is-today")).length };
  });
  check("the daily archive shows four weeks with today marked",
    archive.count === 28 && archive.today === 1, `${archive.count} cells, ${archive.today} marked today`);

  // Regression: the dialog claims aria-modal="true", so it has to behave like it.
  // `boardHasKeys` used to gate only the arrows, Space, F and the digits, which let
  // the single letters straight through — `n` behind an open dialog dealt a new game
  // and left the panel sitting over it reporting the record it had just abandoned.
  const dealBeforeN = new URL(page.url()).searchParams.get("deal");
  await page.keyboard.press("n");
  await page.waitForTimeout(600);
  check(
    "a board shortcut doesn't fire through the open stats dialog",
    new URL(page.url()).searchParams.get("deal") === dealBeforeN && (await page.isVisible("#stats-panel")),
    `deal ${dealBeforeN} -> ${new URL(page.url()).searchParams.get("deal")}`,
  );

  // The other half of modality: Tab used to walk out of the panel straight into the
  // toolbar behind it, so for anyone driving the page by keyboard it wasn't modal at
  // all. #app is inerted while the dialog is up, which also hides it from a reader.
  await page.evaluate(() => document.getElementById("stats-close").focus());
  const tabbed = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    tabbed.push(await page.evaluate(() => document.activeElement?.id ?? ""));
  }
  check(
    "Tab stays inside the modal dialog",
    tabbed.every((id) => id === "" || id === "stats-reset" || id === "stats-close"),
    tabbed.join(" -> "),
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes the stats dialog", !(await page.isVisible("#stats-panel")));

  // The theme button cycles a registry rather than flipping a boolean, so this
  // asserts it moved to *a different* theme, not to one particular one.
  const themeNow = () => page.evaluate(() => document.body.dataset.theme);
  const themeBefore = await themeNow();
  await page.click("#btn-theme");
  await page.waitForTimeout(300);
  check("the theme button moves to another theme", (await themeNow()) !== themeBefore,
    `${themeBefore} -> ${await themeNow()}`);
  check("every theme in the cycle is reachable and repaints", await page.evaluate(async () => {
    const seen = new Set();
    const btn = document.getElementById("btn-theme");
    for (let i = 0; i < 12; i++) {
      seen.add(document.body.dataset.theme);
      btn.click();
      await new Promise((r) => setTimeout(r, 60));
      if (seen.has(document.body.dataset.theme) && seen.size > 1) break;
    }
    return seen.size >= 3;
  }), "expected the cycle to visit at least 3 themes");

  // ---- keyboard play ----
  // Focus the canvas rather than clicking it: a click would put the keyboard cursor
  // away again, and might land on the stock.
  await page.focus("#board");
  const spoken = () => page.textContent("#a11y-status");
  check("the live region exists for screen readers", await page.evaluate(() =>
    document.getElementById("a11y-status")?.getAttribute("aria-live") === "polite"));
  check("nothing is announced before a key is pressed", (await spoken()) === "");

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  check("an arrow key wakes the cursor and announces where it is", (await spoken()).length > 0, await spoken());

  // A whole move played from the keyboard: column 1 up to the stock, then draw.
  await page.keyboard.press("1");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp"); // column 1 sits under the stock
  await page.waitForTimeout(150);
  const beforeDraw = await moves();
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  check("space draws from the stock", (await spoken()).startsWith("drew"), await spoken());
  check("the keyboard draw counted as a move", (await moves()) !== beforeDraw, `${beforeDraw} -> ${await moves()}`);

  await page.keyboard.press("1");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  check("space picks a card up", (await spoken()).startsWith("picked up"), await spoken());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("escape puts it back down", (await spoken()) === "put down", await spoken());

  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // Regression (review): the board must not swallow Space/Enter from a focused
  // control, or every toolbar button becomes unusable by keyboard.
  const movesPreEnter = await moves();
  await page.click("#btn-add-stack");
  await page.waitForTimeout(400);
  await page.focus("#btn-undo");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  check("Enter still activates a focused toolbar button", (await moves()) === movesPreEnter,
    `${movesPreEnter} -> ${await moves()}`);

  // Regression (review): F must not reach into the face-down stock.
  await page.focus("#board");
  await page.keyboard.press("1");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowUp"); // column 1 sits under the stock
  await page.waitForTimeout(150);
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  check("F is refused on the stock", (await spoken()).includes("draw the card first"), await spoken());

  // ...and the other half of that bargain: once nothing is happening, it must stop
  // drawing. Counting real drawImage calls, since an idle loop that repaints an
  // identical frame is invisible to a pixel hash. Update this deliberately if the
  // board ever gains something that animates continuously.
  const idleDraws = await page.evaluate(async () => {
    const ctx = document.getElementById("board").getContext("2d");
    const orig = ctx.drawImage.bind(ctx);
    let n = 0;
    ctx.drawImage = (...a) => { n++; return orig(...a); };
    await new Promise((r) => setTimeout(r, 1000));
    ctx.drawImage = orig;
    return n;
  });
  check("an idle board stops drawing entirely", idleDraws === 0, `${idleDraws} card draws in 1s while idle`);

  // ---- the solver ----
  // A verdict at all is the check: the worker has to start, the search has to finish,
  // and the answer has to come back. Which of the three verdicts it is depends on the
  // deal, so it isn't asserted.
  await page.click("#btn-analyse");
  check("analysing disables the button while it thinks",
    await page.evaluate(() => document.getElementById("btn-analyse").disabled));
  await page.waitForFunction(
    () => !document.getElementById("toast").textContent.includes("Looking"),
    null,
    { timeout: 30000 },
  );
  const verdict = await page.textContent("#toast");
  check("the solver returns a verdict",
    /can still be won|can't be won|Couldn't tell|Already won/.test(verdict), verdict);

  // ---- a shared win ----
  // What the Share button copies now opens on the sender's result rather than straight
  // into a deal, so the numbers have to survive the round trip through the URL. The
  // second assertion matters as much: accepting the challenge must leave no `win=`
  // behind, or a mid-game reload would greet the player with a stale score to beat.
  await page.goto(`${base}?deal=DWLVHU&win=527-154-278&animate=off`, { waitUntil: "load" });
  const challenge = await page.evaluate(() => ({
    shown: !document.getElementById("challenge").hidden,
    score: document.getElementById("challenge-score").textContent,
    time: document.getElementById("challenge-time").textContent,
    moves: document.getElementById("challenge-moves").textContent,
    deal: document.getElementById("challenge-deal").textContent,
    title: document.querySelector(".start-title").textContent,
  }));
  check(
    "a shared win opens on the score to beat",
    challenge.shown &&
      challenge.score === "527" &&
      challenge.time === "4:38" &&
      challenge.moves === "154" &&
      challenge.deal === "Deal DWLVHU · Draw 1" &&
      challenge.title === "Can you beat 527?",
    JSON.stringify(challenge),
  );
  await page.click("#start-btn");
  await page.waitForSelector("#start-overlay", { state: "detached" });
  check(
    "accepting it plays that deal and drops the result from the address bar",
    /[?&]deal=DWLVHU/.test(page.url()) && !/win=/.test(page.url()),
    page.url(),
  );

  // A *deep* search, specifically. Seed 8 can't be decided inside the fast budget, so
  // asking about it escalates to the 2M-node pass — several thousand levels down, on a
  // worker thread. That is exactly where the search used to die: it recursed once per
  // move, and a worker's stack is smaller than the main thread's, which is smaller than
  // Node's. The verdict above never reached that depth, so a stack overflow shipped
  // green locally and only failed in CI. The search keeps its own stack now, which is
  // why this can hold. `💡` shares the same worker and budget, so it is covered too.
  await page.goto(`${base}?deal=8&draw=1&animate=off`, { waitUntil: "load" });
  await page.click("#start-btn");
  await page.waitForSelector("#start-overlay", { state: "detached" });
  await page.click("#btn-analyse");
  await page.waitForFunction(
    () => !document.getElementById("toast").textContent.includes("Looking"),
    null,
    { timeout: 120000 },
  );
  const deepVerdict = await page.textContent("#toast");
  check("a search deep enough to escalate still returns an answer",
    /can still be won|can't be won|Couldn't tell/.test(deepVerdict), deepVerdict);

  // ---- auto-complete, and undo pressed into it ------------------------------
  // Regression, and the reason `boardBusy()` exists. The sweep's loop *is* the
  // `onDone` of the flight it just launched, and `animator.clear()` drops callbacks;
  // `doUndo` checked only `busy` and `celebration.active`, so an undo mid-sweep threw
  // that callback away and left `autoCompleting` latched on for good — which, through
  // the same flag, killed every pointer and key for the rest of the game. The board
  // below is A..J home with the queens and kings still out, so resuming it starts the
  // sweep; Ctrl+Z is fired into the middle of it and the win still has to arrive.
  await page.goto(base, { waitUntil: "load" });
  await page.evaluate(() => {
    // Written out rather than built through the app: a production bundle has no
    // /src/*.ts to import. It is the same eight-card finish `win.png` is shot from,
    // and parseGameState is what would reject it if it ever stopped being a legal board.
    const up = (id) => id + 52;
    const state = {
      seed: 7, drawCount: 1, easy: false, moves: 114, score: 908,
      stock: [], waste: [],
      foundations: [0, 1, 2, 3].map((s) => Array.from({ length: 11 }, (_, r) => up(s * 13 + r))),
      tableau: [[up(11)], [up(24)], [up(37)], [up(50)], [up(12)], [up(25)], [up(38), up(51)]],
      spares: [],
    };
    localStorage.setItem("solitaire-game", JSON.stringify({ v: 2, elapsed: 60000, state }));
  });
  // Plain `base`, never a `?deal=`: one naming a different layout makes the boot rule
  // discard the save. The resume label is what proves it was picked up.
  await page.goto(base, { waitUntil: "load" });
  check(
    "the auto-complete board resumed rather than dealing fresh",
    (await page.textContent(".start-title")) === "Resume game",
    await page.textContent(".start-title"),
  );
  await page.click("#start-btn");
  await page.waitForTimeout(450); // the sweep is under way — 8 cards at 150ms each
  check("undo is disabled while the board auto-completes", await disabled("#btn-undo"));
  await page.keyboard.press("Control+z"); // past the disabled button, straight at doUndo
  await page.waitForFunction(
    () => !document.getElementById("win-overlay").hidden,
    null,
    { timeout: 15000 },
  ).catch(() => {});
  check("undo during auto-complete doesn't strand the sweep",
    await page.isVisible("#win-panel"));

  // ---- offline ----
  // The worker registering is the load-bearing bit: register() rejects silently in the
  // app (offline play is a bonus, never a requirement), so nothing else would notice a
  // worker that stopped parsing.
  const sw = await page.evaluate(async () => {
    const r = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((res) => setTimeout(() => res(null), 8000)),
    ]);
    if (!r) return { active: false, cached: 0 };
    const names = (await caches.keys()).filter((n) => n.startsWith("solitaire-"));
    const cache = names.length ? await caches.open(names[0]) : null;
    return { active: !!r.active, caches: names.length, cached: cache ? (await cache.keys()).length : 0 };
  });
  check("the service worker registers and precaches", sw.active && sw.cached > 50,
    `active=${sw.active} caches=${sw.caches} entries=${sw.cached}`);

  check("no console errors on desktop", logged.length === 0, logged.join(" | "));
  await page.close();

  // ---- phone portrait ------------------------------------------------------
  // The vertical layout is a separate code path in layout.ts, so it gets its own boot.
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const phoneLogged = watch(phone, "phone");
  await phone.goto(base, { waitUntil: "networkidle" });
  await phone.click("#start-btn");
  await phone.waitForTimeout(2500);
  const phoneWhite = await phone.evaluate(() => {
    const c = document.getElementById("board");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let light = 0, total = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      total++;
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
    }
    return light / total;
  });
  check(
    "the phone-portrait board paints",
    phoneWhite > 0.05 && phoneWhite < 0.95,
    `${(phoneWhite * 100).toFixed(1)}% card-white`,
  );
  check("no console errors on phone", phoneLogged.length === 0, phoneLogged.join(" | "));
  await phone.close();
} finally {
  await browser.close();
  await server.httpServer.close();
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nall ${checks} smoke checks passed`);
