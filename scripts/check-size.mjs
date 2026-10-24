// Fails when the built bundle outgrows its budget.
//
//     npm run build && npm run size
//
// "Zero runtime dependencies" is a constraint about weight as much as about supply
// chain, and nothing else measures it: one stray import of something large passes
// lint, types, tests and the smoke test without a murmur. So each emitted asset is
// gzipped (what a browser actually downloads) and held to a ceiling.
//
// The ceilings sit roughly 15% above what the bundle measured when they were last
// set, so ordinary feature work fits and a new library does not. Raising one is
// allowed — it is a line in this file, reviewed like any other — but it should be a
// decision, made with the number in front of you, rather than something that drifts.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets");

/** Gzipped bytes allowed per asset kind, matched on the hashed file name. */
const BUDGETS = [
  { name: "app script", match: /^index-.*\.js$/, max: 34_000 },
  { name: "solver worker", match: /^solver\.worker-.*\.js$/, max: 5_200 },
  { name: "stylesheet", match: /^index-.*\.css$/, max: 4_400 },
];

let files;
try {
  files = readdirSync(assets);
} catch {
  throw new Error("dist/assets is missing — run `npm run build` first");
}

let failed = false;
for (const budget of BUDGETS) {
  const hits = files.filter((f) => budget.match.test(f));
  // A budget that matches nothing would pass forever — an asset renamed, or split,
  // must not quietly fall out of the check.
  if (hits.length !== 1) {
    console.log(`  FAIL  ${budget.name}: expected one matching asset, found ${hits.length}`);
    failed = true;
    continue;
  }
  const bytes = gzipSync(readFileSync(join(assets, hits[0])), { level: 9 }).length;
  const ok = bytes <= budget.max;
  const pct = Math.round((bytes / budget.max) * 100);
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${budget.name.padEnd(14)} ${(bytes / 1000).toFixed(1).padStart(5)} kB of ${(budget.max / 1000).toFixed(1)} kB (${pct}%)`,
  );
  if (!ok) failed = true;
}

// Anything emitted that no budget covers is unmeasured weight.
const unbudgeted = files.filter(
  (f) => /\.(js|css)$/.test(f) && !BUDGETS.some((b) => b.match.test(f)),
);
for (const f of unbudgeted) {
  console.log(`  FAIL  ${f} has no budget — add one to scripts/check-size.mjs`);
  failed = true;
}

if (failed) process.exit(1);
