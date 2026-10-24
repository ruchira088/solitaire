# Project guide

Klondike Solitaire — TypeScript + HTML5 Canvas 2D, bundled with Vite. **Zero
runtime dependencies**; the shipped bundle is pure vanilla JS/Canvas.

This file states the rules. The reasoning behind each — what went wrong, what was
measured — lives in **`docs/decisions/`**, linked from the rule. Read the linked note
before changing what a rule protects.

## Dependencies

**There is no `dependencies` block in `package.json`, and adding one is a
decision, not a detail.** Everything installed is dev/build tooling:

| Package | Range | Used for |
| --- | --- | --- |
| `typescript` | `^7.0.2` | strict-mode checking (`npm run typecheck`) and the `tsc` step ahead of `vite build` |
| `vite` | `^8.3.0` | dev server + production bundle; `preview` serves `dist/` for the smoke test |
| `vitest` | `^5.0.0` | the pure-logic suite (`npm test`). Its `engines` field sets the **Node 22.12+** floor (`.nvmrc` pins 24) |
| `@vitest/coverage-v8` | `^5.0.5` | `npm run test:coverage` — a report, not a gate. Pins Vitest's exact version as a peer, so the two move together |
| `svgo` | `^4.1.0` | one-off pip/ace face optimisation (`npm run cards:optimize`) |
| `oxlint` | `^1.82.0` | linting (`npm run lint`). **Not ESLint on purpose** — `typescript-eslint` refuses TypeScript 7 (typescript-eslint#10940) |
| `playwright-core` | `^1.63.0` | drives *system* Chrome for `scripts/smoke.mjs` (CI), the screenshots and card rasterising. `-core`: no browser downloads |

**When any of this changes, update the table *and* README** (the `npm install` comment,
the Node requirement, the Tech stack list). `npm run lint` runs
`scripts/check-docs.mjs`, which fails when they disagree with `package.json` — a new
package also needs a label there.

Dependabot groups minor/patch bumps per ecosystem and leaves majors ungrouped, on
purpose; its branches stop before deploy. `cdk-deploy`'s `aws-cdk-lib` bundles its own
dependencies (`npm update aws-cdk-lib` is the lever, not `overrides`), and
`react-app-cdk-deploy` is a git dependency on a moving `#v1` tag with npm 12 gates
keyed on the resolved commit. → [dependencies](docs/decisions/dependencies.md)

## Commands

```bash
npm run dev           # Vite dev server with hot reload
npm run lint          # oxlint (correctness rules only), then the docs-vs-package.json check
npm run typecheck     # tsc --noEmit (strict mode)
npm test              # vitest run — the pure-logic suite
npm run test:watch    # vitest in watch mode
npm run test:coverage # the suite with a coverage report (coverage/, gitignored)
npm run build         # tsc + vite build → dist/
npm run size          # gzipped size budget per built asset (needs a build; CI runs it)
npm run preview       # serve the production build
npm run smoke         # boot dist/ in Chrome and check the game works (needs a build)
npm run screenshots   # reshoot screenshots/*.png (one-off; output is committed)
```

After changes, run `npm run typecheck` and `npm test`, and when the change is
visual or behavioural, run the app and look at it (see Verifying).

### Tests

`npm run lint`, `npm test`, `npm run typecheck`, `npm run size` and `npm run smoke` all
gate CI ahead of every deploy (the `build-and-typecheck` job).

- **Vitest covers the pure modules only**: `game`, `cards`, `rng`, `layout`, `storage`,
  `share`, `statsView`, `cursor`, `solver`, `theme`, `challenges`, `keyboard`,
  `deadCheck`, `replay`, and `tooltip.ts`'s `parseTip`. Canvas/DOM modules aren't
  mocked — that only buys assertions about the mock.
- **`npm run smoke` covers the rest**, against the *built* bundle in real Chrome, every
  assertion through the DOM and every action through a toolbar button or key. Its
  load-bearing check is that the canvas painted. Kept out of vitest on purpose.
- **Lint is correctness rules only**, no formatting opinions and no Prettier;
  `public/sw.js` is excluded (build-time placeholders).
- Build boards by hand and apply them with `restore()` (no validation, so a fixture may
  hold fewer than 52 cards). Mutate one field per rejection test in
  `parseGameState.test.ts`. `storage.test.ts` reloads the module per case — `writable`
  latches off after a failed write. `vitest.config.ts` stays separate from
  `vite.config.ts`.

→ [testing](docs/decisions/testing.md) (including coverage, the size budget and the docs check)

## Architecture

One `requestAnimationFrame` loop drives a single HiDPI-scaled canvas, with game
logic, rendering, animation, and input kept cleanly separated.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Bootstrap, HiDPI canvas sizing, the game loop, deal / auto-complete / win / replay sequences, toolbar wiring |
| `src/game.ts` | Klondike rules, draw modes, Vegas passes, undo snapshots, win / auto-complete — **pure, no DOM** |
| `src/cards.ts` | Card model, deck construction, Fisher–Yates shuffle |
| `src/rng.ts` | Seeded PRNG, deal codes + the daily deal's date→seed — **a frozen wire format** |
| `src/layout.ts` | Responsive pile positions, tall-column offset compression |
| `src/positions.ts` | Shared geometry: hit-testing + animation targets |
| `src/render.ts` | Drawing: card bodies, table felt, SVG-face compositing |
| `src/cardFaces.ts` | Loads & caches the SVG card faces from `public/cards/` |
| `src/courtArt.ts` | Procedural J/Q/K + Ace fallback art (used until SVGs decode) |
| `src/animation.ts` | Tween engine, card flights, win-celebration physics |
| `src/input.ts` | Pointer drag & drop, click-to-draw, double-click auto-move |
| `src/keyboard.ts` | What a key press means, and when it means nothing — **pure** |
| `src/theme.ts` | Theme registry (felt, placeholders, card backs) and the Auto preference |
| `src/preferences.ts` | Theme, sound, toolbar fold, rail side: the buttons and their saved values |
| `src/sound.ts` / `src/haptics.ts` | WebAudio effects; the vibration tick that rides on them |
| `src/storage.ts` | `localStorage`: preferences, the game save, stats, received challenges |
| `src/share.ts` | The shared result's text, links and `win=` payload — **pure** |
| `src/challenges.ts` | Challenge links opened, and whether they've been beaten — **pure** |
| `src/statsView.ts` | The stats dialog's rows and formatting — **pure** |
| `src/statsDialog.ts` / `src/winPanel.ts` / `src/startOverlay.ts` | The three DOM panels |
| `src/cursor.ts` | Keyboard cursor: navigation and spoken descriptions — **pure** |
| `src/tooltip.ts` | The custom tooltip on every `data-tip` trigger; `parseTip` is **pure** |
| `src/solver.ts` | Can this position be won? Iterative DFS; `toGameLine` for replays — **pure** |
| `src/solver.worker.ts` | Runs the solver off the main thread |
| `src/deadCheck.ts` | The dead-board warning's bookkeeping, behind an injected `ask` |
| `src/replay.ts` | Paces a winning line out on the board |

### Key design invariants

**Rules and the model**

- **`countMove()` is the only place `moves` advances.** Every move costs `MOVE_COST`
  (1 point), so the counter and the charge live together and no new kind of move gets
  in free. A foundation move nets +9; the score floors at 0.
- **`game.ts` stays pure.** Rules, validation, scoring and undo snapshots have no
  DOM/canvas dependencies. New rules logic goes here, tested in isolation.
- **Model updates instantly; the view catches up.** A move mutates the model, then
  `Animator.flyCard` animates from old screen positions to new. Logic never waits.
- **Foundations are not suit-locked.** Any ace starts any foundation; the ♠♥♦♣ glyphs
  are decoration, so `pileName` numbers an empty foundation rather than naming a suit.
- **Vegas: the dollars are derived from the board, the passes ride in every undo
  snapshot, and the switch changes the deal in play only before its first move.** A
  game settles into the bank once, when it ends, and only if it was played.
  → [vegas](docs/decisions/vegas.md)

**Rendering**

- **The board is painted only when it changes.** **Anything that changes what the
  canvas should show must call `invalidate()`** — including a draw-mode switch and
  *every* pointer release. `wasAnimating` is read before `animator.update()`; the
  `pendingCheck` sweep sits outside the paint gate; `onCardFaceLoad` repaints late
  faces. The toolbar clock compares before writing.
- **Flights double as a visibility mask** (`animator.isFlying` / `hideCards`) — which
  is also how the deal is held hidden behind the start overlay.
- **The drop target is computed once per frame**, not per `pointermove`; `dropDrag`
  recomputes from the pointer-*up* position.
- **Everything is DPI-aware**; all drawing is in CSS pixels.
- **`#board` needs `min-height: 0` / `min-width: 0` — not cosmetic.** Without them the
  canvas's intrinsic ratio inflates its flex share and `resize()` makes it permanent.
- **One debounced path rebuilds the board** (`scheduleResize` → `applyResize` →
  `refreshAfterResize`), which owns the jobs the cleared animator held. Not before the
  overlay is dismissed. `syncSpareLayout` stays synchronous.

→ [rendering](docs/decisions/rendering.md)

**Keyboard and dialogs**

- **The board is playable without a pointer.** A cursor's `depth` is the bottom of the
  run you'd pick up; the cursor is re-seated after every change (`clampCursor`) and
  drawn only while `keyboardActive`.
- **Key precedence is `keyCommand`'s** (keyboard.ts, tested): Escape first, nothing
  else while the stats dialog is open, board keys only with no dialog up, no single
  letters with a modifier held.
- **The stats dialog is modal in fact**: no shortcut fires through it, and `#app` is
  inert while it's up — which is why `#stats-overlay` is a sibling of `#app`. The win
  panel is deliberately *not* modal.

→ [keyboard and dialogs](docs/decisions/keyboard-and-dialogs.md)

**The solver**

- **The solver keeps its own board; `solver.test.ts` stops the rules drifting.** A move
  class absent from both sides of that comparison is unchecked, not agreed.
- **"Unwinnable" is a claim, so the move set must be complete** — including
  foundation→tableau onto an empty column, deduplicated *per card*. Anything a budget
  cuts short is `unknown`. ✦ stacks, easy mode and Vegas aren't modelled: `canAnalyse`
  is false and the UI says so.
- **Three budgets, all failing to `unknown`; the search keeps its own stack** (never
  recursion — a worker's stack is smaller than Node's) and the visited key stays an
  exact string.
- **The dead-board warning runs unasked, and only a proof shows it** — fast pass only,
  on its own worker, scheduled by `bumpBoard()`, the one place `boardVersion` moves.
  Dead → dead is silent; a skipped check takes it down.
- **A hint is the first move of a line that wins, or it is nothing.**
- **A winnable deal is screened, not generated**, at the current draw count, and never
  under Vegas.
- **"Show a solution" replays a line from the *deal*, and nothing it does counts**
  (`demoGame`: no start, save, win, Vegas settlement or challenge mark; no auto-complete
  sweep under it). Escape re-deals the same board fresh.

→ [solver](docs/decisions/solver.md)

**Sharing, the daily and stats**

- **A shared win links back with its result attached, and the address bar never keeps
  it.** `parseResult` treats `win=` as untrusted; `dealUrl()` deletes `win`, and only
  `shareUrl()` adds it back. Every challenge opened is kept (`challenges.ts`) and marked
  beaten per board — seed, draw count *and* rules.
  → [sharing](docs/decisions/sharing.md)
- **The archive can't back-fill a streak**: `recordWin` takes
  `daily: { key, extendsStreak }` and only main.ts decides which case it is.
  → [daily and stats](docs/decisions/daily-and-stats.md)

**Offline, themes, layout, chrome**

- **Offline is a hand-written service worker**: navigations network-first, everything
  else cache-first, and **every lookup passes `ignoreVary: true`**. The build fails if
  the stamped `sw.js` isn't valid JavaScript. → [offline](docs/decisions/offline.md)
- **Themes are a registry, and they own the card back.** A new theme is one `THEMES`
  entry plus one `body[data-theme]` CSS block. **Auto is a preference, not a theme**,
  resolved to Bright/Midnight from the OS and followed live.
- **Three pile highlights answer different questions** (drop target, keyboard cursor,
  hint) and differ in colour, weight *and* extent.
- **The ☰ toggle only exists when the bar wraps**, measured with the button in flow; a
  hidden toolbar still leaves a fake-felt strip, on purpose.
- **Dark-in-every-theme surfaces re-declare the dark button palette**: the win panel,
  the stats panel, and the toast's action button.

→ [themes and chrome](docs/decisions/themes-and-chrome.md)

- **Card size is set by the fan reserve, not the width**; **the portrait board is the
  landscape one transposed**, and `leftHanded` mirrors the rail *and* its fan limit.
  → [layout](docs/decisions/layout.md)

**Busy, sweeps and the win**

- **`boardBusy()` is the one answer to "are the cards moving?"** — the deal, the
  auto-complete sweep, the cascade and the replay. Every in-place mutation asks it;
  actions that *replace* the board don't. `Game.autoCompleteSource()` is the single
  definition of the sweep's order, and 🏠 is that sweep started early, ending through
  `onChange` only when it moved something. → [board busy](docs/decisions/board-busy.md)
- **The cascade is three effects at once, and the canvas is never cleared** — the
  trails are the look. **The win dialog is DOM**, centred in the board via `--bar-h`,
  opened from `startCelebration` and closed in `beginGame`.
  → [win celebration](docs/decisions/win-celebration.md)
- **Audio needs a user gesture**, which is why the deal waits behind the start overlay.

### Persisted to `localStorage`

All through `src/storage.ts`, best-effort.

- **Settings**: theme (`solitaire-theme`, may be `auto`), sound, toolbar fold, rail
  side, and Vegas for the next deal (`solitaire-vegas`). `?theme=`, `?animate=off`,
  `?deal=`, `?draw=1|3` (only `3` is ever written), `?vegas=1` and `?win=` (read only).
- **Easy mode is not a setting** — per-game, off on every fresh deal.
- **The game in progress** (`solitaire-game`, schema-versioned `SCHEMA`): validated by
  `parseGameState`, rejected saves dropped; history capped at `PERSISTED_HISTORY` (40)
  and held to the same `parseBoardState`; optional fields (`history`, `vegas`,
  `recycles`) need no bump. The save exists exactly while there's a game in progress.
- **Lifetime stats** (`solitaire-stats`, `STATS_SCHEMA` only for changes of *meaning*):
  a deal is *played* from its first move; `pending` persists across sessions; every
  field is sanitised on read; the daily streak is read through `currentDailyStreak`.
- **Challenges received** (`solitaire-challenges`), newest 20; Reset stats clears them.

→ [persistence](docs/decisions/persistence.md), [daily and stats](docs/decisions/daily-and-stats.md)

### Seeded deals and the daily

- **`rng.ts` plus the shuffle loop in `cards.ts` is a wire format**, and so is
  `dailySeed`: changing either reinterprets every shared code and recorded streak.
  `rng.test.ts` pins both.
- Boot rule: a saved game resumes unless `?deal=` names a *different* layout.
- A daily **is** an ordinary seeded deal, recognised from its seed, never stored;
  `dailyKey` reads the local date; 📅 mid-way through today's deal does nothing.

## Verifying visual changes

No `chromium-cli` or Playwright browsers are installed here, but system Chrome
is. Drive a Vite dev server with Playwright pointed at the Chrome executable
(`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`),
navigate, click `#start-btn` to deal, and screenshot. Always check the browser
console for errors before declaring success. Check **both** a dark and a light theme
and a phone viewport for anything drawn over the board — a dark-on-dark button was
only ever caught that way.

### The README screenshots

`npm run screenshots` (`scripts/shoot-screenshots.mjs`) — committed, not run in CI, and
it also writes `public/og.png`. **Any change to the toolbar dates every board shot**:
rerun the script, don't patch an image. It pins `colorScheme: "dark"` (headless Chrome
reports light, and Auto would follow it). → [screenshots](docs/decisions/screenshots.md)

## Git workflow

**"Push to remote" means: commit the working changes to the current branch, then
push it.** It is not a request to push already-made commits — staging and
committing whatever is outstanding is part of the ask.

**Commit to `main`.** Don't create a branch unless explicitly asked to work on a
separate one; the usual "branch before committing to the default branch" reflex
does not apply here.

Since a push to `main` triggers the deploy pipeline below, `npm run typecheck` and
`npm test` should pass before pushing — and behavioural changes should have been
looked at in a browser (see "Verifying visual changes").

## Deployment

CI/CD (GitHub Actions → S3 + CloudFront via AWS CDK) is documented in detail in
`README.md` ("Deployment"). The CDK app lives in `cdk-deploy/`; Ansible build/
upload playbooks in `playbooks/`. App-specific config (stack name, domain,
artifact bucket) is in `cdk-deploy/bin/cdk-deploy.ts`.

## Conventions

- TypeScript strict mode. Match the existing terse, comment-light-but-purposeful
  style — file headers and non-obvious invariants get a comment; mechanics don't.
- Motion respects `prefers-reduced-motion` from **both** sides (main.ts watches it live;
  `styles.css` has the matching block).
- Card faces are the public-domain *vector-playing-cards* set — check licensing before
  replacing. Courts ship as WebP, pips as SVGO'd SVG; regenerate with
  `npm run cards:rasterize` / `npm run cards:optimize` (one-off, output committed).
- **Button icons are decoration, and they cost width.** Labels keep the accessible
  name (`<span class="ico" aria-hidden="true">`); icon-only buttons need an
  `aria-label`. Below 1340px `.btn .ico` is hidden — that is what keeps 1280 on one
  row, which the smoke test checks. A new toolbar button needs a measurement first; the
  Vegas switch went into the stats dialog for that reason.
- **Tooltips are `data-tip`, never `title`** (the smoke test checks); dynamic text goes
  through `setTip`. Never shown on touch.
- **Only the pip faces are preloaded**; `getCardFace` returning null is normal.

→ [conventions, in full](docs/decisions/conventions.md)
