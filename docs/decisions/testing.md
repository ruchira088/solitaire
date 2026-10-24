<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Tests, lint and the smoke test

Why the suite is scoped the way it is, and what the smoke test is for.

Vitest, colocated as `src/*.test.ts`. `npm run lint`, `npm test`, `npm run typecheck`
and `npm run smoke` all gate CI ahead of every deploy — see the `build-and-typecheck`
job.

**The lint carries correctness rules only, and no formatting opinions.** oxlint's
`pedantic`/`style` categories were tried and rejected: they wanted `querySelector`
over every `getElementById`, `.at()` over `[i]`, and to hoist every small local
helper — a large diff arguing with deliberate house style, for no defect caught.
`correctness` plus a short hand-picked list (`no-shadow`, `eqeqeq`, `prefer-const`,
`no-throw-literal`) is the part that finds bugs. Formatting stays a separate decision;
there is no Prettier, and adding one would reflow a lot of hand-broken code at once.
`public/sw.js` is excluded because it holds build-time placeholders and is
deliberately not valid JavaScript until `vite build` substitutes them.

Scope is deliberately the **pure** modules: `game.ts`, `cards.ts`, `layout.ts`,
`storage.ts`, `share.ts`, `statsView.ts`, `cursor.ts`, `solver.ts` and `tooltip.ts`'s `parseTip`. `render.ts` / `animation.ts` / `input.ts` / `main.ts` need a canvas,
and mocking one only buys assertions about the mock.

**`npm run smoke` is what covers those instead** (`scripts/smoke.mjs`). It serves the
*built* `dist/` with Vite's preview server and drives real Chrome, so it exercises the
bundle that deploys rather than the dev module graph — which is also why every
assertion goes through the DOM and every interaction through a toolbar button: there
is no `/src/*.ts` to import in a production build, and canvas coordinates would be
fragile across viewports. It is kept out of vitest deliberately, so `npm test` stays
the fast pure suite and doesn't drag Chrome onto its path.

The load-bearing check is that **the canvas actually painted**: card faces are the
only near-white thing on a green table, so the fraction of light pixels separates
"dealt a board" from "drew nothing", which is what a broken render path looks like and
what `tsc` cannot see. The rest — the toolbar not wrapping at 1280, a ✦ stack counting
a move, undo taking it back, the daily dealing and stamping the URL, Escape closing
the stats dialog, no console errors on desktop or phone — is wiring that only breaks
in a browser. Both headline checks were verified by mutation: breaking the media query
so the bar wraps at 1280, and deleting the `drawScene` call, each fail the run.

Conventions worth keeping:

- **Build boards by hand and apply them with `restore()`** rather than dealing, so
  each test states the exact position it cares about. `restore()` does no
  validation, so a fixture may hold fewer than 52 cards when the rest is irrelevant.
- **Mutate one field per rejection test** in `parseGameState.test.ts`, so a failure
  names one branch rather than "the fixture is wrong".
- **`storage.test.ts` reloads the module per case** (`vi.resetModules()`). Its
  `writable` flag is module-level and latches off after the first failed write, so a
  test touching the unavailable-storage path would otherwise silently no-op every
  later write in the file.
- `vitest.config.ts` is kept separate from `vite.config.ts`: `defineConfig` from
  `"vite"` doesn't type a `test` key, and merging them would put test config on the
  path of every production build.
