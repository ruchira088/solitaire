// Rasterises the court-card art (jack/queen/king) from art/cards-src/*.svg into
// public/cards/*.webp.
//
// Why: the source SVGs are auto-traced and enormous — a single one is up to 1.1 MB
// with ~5,000 coordinate pairs in one path — totalling 7.7 MB for twelve cards,
// against a 49 KB JS bundle. Lossless SVG optimisation only reaches ~44% because
// the cost is node count, not coordinate precision. Cards render at most ~340
// device pixels wide, so a 512 px raster is indistinguishable and ~90% smaller.
//
// Pip cards and aces are deliberately NOT rasterised: they are simple enough that
// SVG is already smaller (an ace is 24 KB as SVG, 26 KB as WebP).
//
// This is a one-off; the output is committed. Re-run it only when the source art or
// the target size changes:
//
//     npm run cards:rasterize            # 512 px, quality 0.85
//     WIDTH=384 QUALITY=0.8 npm run cards:rasterize
//
// Chrome is the renderer because Chrome is what draws these for real users.

import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "art/cards-src");
const OUT = join(root, "public/cards");

const WIDTH = Number(process.env.WIDTH ?? 512);
const QUALITY = Number(process.env.QUALITY ?? 0.85);
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sources = readdirSync(SRC).filter((f) => f.endsWith(".svg")).sort();
if (sources.length === 0) throw new Error(`no SVG sources in ${SRC}`);

const browser = await chromium.launch({ executablePath: CHROME });
const page = await (await browser.newContext()).newPage();

let before = 0;
let after = 0;

for (const file of sources) {
  const svg = readFileSync(join(SRC, file), "utf8");
  const dataUrl = await page.evaluate(
    async ({ svg: source, width, quality }) => {
      const img = new Image();
      img.src =
        "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(source)));
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round((width * img.naturalHeight) / img.naturalWidth);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", quality);
    },
    { svg, width: WIDTH, quality: QUALITY },
  );

  const out = file.replace(/\.svg$/, ".webp");
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  writeFileSync(join(OUT, out), bytes);

  const src = statSync(join(SRC, file)).size;
  before += src;
  after += bytes.length;
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(8);
  console.log(`  ${out.padEnd(22)} ${kb(src)} SVG ->${kb(bytes.length)} WebP`);
}

await browser.close();

const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
console.log(
  `\n${sources.length} cards at ${WIDTH}px q${QUALITY}: ` +
    `${mb(before)} -> ${mb(after)} (${(100 * (1 - after / before)).toFixed(1)}% smaller)`,
);
