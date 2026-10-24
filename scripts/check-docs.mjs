// Fails when the docs disagree with package.json about the toolchain.
//
//     npm run lint   (runs this after oxlint)
//
// CLAUDE.md asks that a dependency change also update its table and three spots in
// README.md, and says outright that "the two files drift silently otherwise, since
// nothing checks them". This is the thing that checks them. It is deliberately narrow
// — names, ranges, majors and the Node floor, which is everything those passages
// state as fact — and ignores the prose around them, which is for people to keep true.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");

const pkg = JSON.parse(read("package.json"));
const claude = read("CLAUDE.md");
const readme = read("README.md");
const dev = pkg.devDependencies ?? {};

const problems = [];

// Zero runtime dependencies is a project constraint, not a habit.
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  problems.push("package.json has a `dependencies` block — the shipped bundle is meant to have none");
}

// ---- CLAUDE.md's dependency table: every row, both directions ----------------
const table = new Map(
  [...claude.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm)].map((m) => [m[1], m[2]]),
);
for (const [name, range] of Object.entries(dev)) {
  if (!table.has(name)) problems.push(`CLAUDE.md's table has no row for ${name}`);
  else if (table.get(name) !== range) {
    problems.push(`CLAUDE.md lists ${name} at ${table.get(name)}, package.json at ${range}`);
  }
}
for (const name of table.keys()) {
  if (!(name in dev)) problems.push(`CLAUDE.md's table lists ${name}, which package.json doesn't`);
}

// ---- README's `npm install` comment names every tool ------------------------
/** How the README's one-line comment refers to each package. A new dev dependency
 *  needs a label here, which is the point: adding one should mean looking at it. */
const LABELS = {
  typescript: "TypeScript",
  vite: "Vite",
  vitest: "Vitest",
  "@vitest/coverage-v8": "coverage",
  svgo: "SVGO",
  oxlint: "oxlint",
  "playwright-core": "playwright-core",
};
const install = readme.match(/^npm install\s+#(.*)$/m)?.[1] ?? "";
if (!install) problems.push("README.md has no `npm install  # …` line to check");
for (const name of Object.keys(dev)) {
  const label = LABELS[name];
  if (!label) problems.push(`${name} has no README label in scripts/check-docs.mjs`);
  else if (install && !install.includes(label)) {
    problems.push(`README's npm install comment doesn't mention ${label} (${name})`);
  }
}

// ---- README's Tech stack majors ----------------------------------------------
const major = (range) => range.match(/\d+/)?.[0];
for (const [name, label] of [["typescript", "TypeScript"], ["vite", "Vite"]]) {
  const stated = readme.match(new RegExp(`\\*\\*${label} (\\d+)`))?.[1];
  if (stated !== major(dev[name])) {
    problems.push(`README's Tech stack says ${label} ${stated ?? "(missing)"}, package.json has ${dev[name]}`);
  }
}

// ---- The Node floor: Vitest's engines field sets it, both files state it -----
// The lowest version the installed Vitest accepts, e.g. "^22.12 || ^24 || >=26" → 22.12.
const engines = JSON.parse(read("node_modules/vitest/package.json")).engines?.node ?? "";
const floor = engines.match(/(\d+(?:\.\d+)?)/)?.[1];
for (const [file, text] of [["README.md", readme], ["CLAUDE.md", claude]]) {
  if (floor && !text.includes(`Node ${floor}+`)) {
    problems.push(`${file} doesn't state the Node ${floor}+ floor that Vitest's engines (${engines}) set`);
  }
}

if (problems.length > 0) {
  console.log("docs out of step with package.json:");
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
