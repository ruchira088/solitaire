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
