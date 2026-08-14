# CLAUDE.md

Klondike Solitaire — TypeScript + HTML5 Canvas 2D, bundled with Vite. **Zero
runtime dependencies**; the shipped bundle is pure vanilla JS/Canvas.

## Dependencies

**There is no `dependencies` block in `package.json`, and adding one is a
decision, not a detail.** Zero runtime dependencies is a project constraint —
the shipped bundle stays pure vanilla JS/Canvas.

Everything installed is dev/build tooling:

| Package | Range | Used for |
| --- | --- | --- |
| `typescript` | `^7.0.2` | strict-mode checking (`npm run typecheck`) and the `tsc` step ahead of `vite build` |
| `vite` | `^8.1.5` | dev server + production bundle; `createServer` serves the app for the screenshot script and `preview` serves `dist/` for the smoke test. Its `engines` field is what sets the **Node 20.19+ / 22.12+** floor (`.nvmrc` pins 24) |
| `vitest` | `^4.1.10` | the pure-logic suite (`npm test`), configured separately in `vitest.config.ts` |
| `svgo` | `^4.0.2` | one-off pip/ace face optimisation (`npm run cards:optimize`) |
| `oxlint` | `^1.78.0` | linting (`npm run lint`), gating CI. **Not ESLint on purpose** — `typescript-eslint` hard-errors on TypeScript 7 (it checks the version and refuses; see typescript-eslint#10940), and the only workaround is running a second, older TypeScript side by side. oxlint parses TS itself and has no `typescript` peer dependency, so it costs one binary and no version coupling |
| `playwright-core` | `^1.62.0` | drives *system* Chrome — `scripts/smoke.mjs` (which runs in CI), `scripts/rasterize-cards.mjs`, `scripts/shoot-screenshots.mjs` and the visual checks below. `-core` on purpose: no browser binaries are downloaded, so CI uses the runner's preinstalled Chrome |

**When any of this changes — a package added, removed, or moved across a major
version — update the table above *and* the matching spots in `README.md`:** the
`npm install` comment and Node requirement under "Getting started", and the
"Tech stack" list. The two files drift silently otherwise, since nothing checks
them.

`.github/dependabot.yml` watches three ecosystems — this lockfile, `cdk-deploy`'s,
and the workflow actions — and **groups minor/patch bumps into one PR per ecosystem
while leaving majors ungrouped, deliberately**: a major is exactly the case that
drags the table above and README along with it, and that review shouldn't arrive
buried in a five-package bump. Dependabot branches are linted, typechecked, tested
and smoke-tested like any other but stop at `upload-bundle`, which skips them — and
skips `deploy-to-dev` with it. Each dev environment is a real CloudFront
distribution, `pr-cleanup.yml` only tears down a *merged* PR's stack, and a
Dependabot-triggered run gets a restricted token that couldn't assume the deploy
role anyway.

`cdk-deploy` pins `aws-cdk-lib` through its lockfile rather than `package.json` (it
arrives as a peer dependency of `react-app-cdk-deploy`), and **`aws-cdk-lib` bundles
its own dependencies** — so an advisory against something nested inside it can't be
fixed with an `overrides` entry or by `npm audit fix`, which will happily *downgrade*
`aws-cdk-lib` and still land in the vulnerable range. `npm update aws-cdk-lib` is the
lever: a newer release carries a newer bundle.

## Commands

```bash
npm run dev         # Vite dev server with hot reload
npm run lint        # oxlint — correctness rules, no formatting opinions
npm run typecheck   # tsc --noEmit (strict mode)
npm test            # vitest run — the pure-logic suite
npm run test:watch  # vitest in watch mode
npm run build       # tsc + vite build → dist/
npm run preview     # serve the production build
npm run smoke       # boot dist/ in Chrome and check the game works (needs a build)
npm run screenshots # reshoot screenshots/*.png (one-off; output is committed)
```

After changes, run `npm run typecheck` and `npm test`, and when the change is
visual or behavioural, run the app and look at it (see Verifying).

### Tests

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
`storage.ts`, `share.ts`, `cursor.ts` and `solver.ts`. `render.ts` / `animation.ts` / `input.ts` / `main.ts` need a canvas,
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

## Architecture

One `requestAnimationFrame` loop drives a single HiDPI-scaled canvas, with game
logic, rendering, animation, and input kept cleanly separated.

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Bootstrap, HiDPI canvas sizing, the game loop, deal / auto-complete / win sequences, toolbar wiring |
| `src/game.ts` | Klondike rules, draw modes, undo snapshots, win / auto-complete — **pure, framework-free, no DOM** |
| `src/cards.ts` | Card model, deck construction, Fisher–Yates shuffle |
| `src/rng.ts` | Seeded PRNG, deal codes + the daily deal's date→seed — **a frozen wire format**, see below |
| `src/layout.ts` | Responsive pile positions, tall-column offset compression |
| `src/positions.ts` | Shared geometry: hit-testing + animation targets |
| `src/render.ts` | Drawing: card bodies, table felt, SVG-face compositing |
| `src/cardFaces.ts` | Loads & caches the SVG card faces from `public/cards/` |
| `src/courtArt.ts` | Procedural J/Q/K + Ace fallback art (used until SVGs decode) |
| `src/animation.ts` | Tween engine, card flights, win-celebration physics |
| `src/input.ts` | Pointer drag & drop, click-to-draw, double-click auto-move |
| `src/theme.ts` | Theme registry: felt, placeholders **and card backs** |
| `src/sound.ts` | WebAudio sound effects (deal tick, etc.) |
| `src/storage.ts` | `localStorage`: UI preferences + the in-progress game save |
| `src/share.ts` | The result text the win dialog copies — **pure**, no DOM |
| `src/cursor.ts` | Keyboard cursor: navigation and the spoken descriptions — **pure**, no DOM |
| `src/solver.ts` | Can this position be won? Depth-first search — **pure**, no DOM |
| `src/solver.worker.ts` | Runs the solver off the main thread |

### Key design invariants

- **`countMove()` is the only place `moves` advances.** Every move costs
  `MOVE_COST` (1 point), which is what makes winning in fewer moves score better — so
  the counter and the charge live together and a new kind of move can't quietly get in
  free. A foundation move nets +9 after it, and the score's floor at 0 means moves are
  effectively free while a game sits at zero.
- **`game.ts` stays pure.** Rules, move validation, scoring, and undo snapshots
  have no DOM/canvas dependencies. Keep new rules logic here and testable in
  isolation.
- **The board is painted only when it changes.** Solitaire spends most of its life
  as a static picture while the player thinks, and repainting it at 120 Hz to produce
  an identical frame is pure battery — measured at ~750 card-face `drawImage` calls a
  second on an idle board before this. `frame` paints when `dirty` is set, while the
  animator is running, while a drag is live, or during the celebration; `invalidate()`
  sets the flag. **Anything that changes what the canvas should show must call it** —
  a missed one leaves a stale board, which is far worse than the frames it saves. Two
  were missed first time round and are worth knowing about, because neither is a
  *move*: switching the draw mode changes how the waste fans, and **releasing a press
  repaints even when nothing happened** — a press that never became a drag has already
  been painted lifted and offset, so `pointerup`/`pointercancel` on the canvas
  invalidate unconditionally.
  Three subtleties: `wasAnimating` is read *before* `animator.update()`, because the
  frame that finishes the last flight still has to paint or the card never appears at
  rest; the `pendingCheck` sweep sits outside the paint gate, since a win has to be
  noticed precisely when the board is idle; and `cardFaces.ts` gained
  `onCardFaceLoad` because a court WebP decoding after the board settles is a change
  with no other trigger — without it a late face would never replace the procedural
  fallback. `rAF` itself keeps running (an empty callback is nearly free); stopping it
  outright would save a little more and risk a frozen board for it.
- **Model updates instantly; the view catches up.** A move mutates the game
  model immediately, then `Animator.flyCard` animates the affected cards from
  their old screen positions to the new ones. Logic never waits on animation.
- **Flights double as a visibility mask.** A card with an active flight (or one
  added via `Animator.hideCards`) is skipped by the renderer at its pile
  position — `render.ts`'s `hidden()` checks `animator.isFlying(id)`. This is how
  in-flight cards aren't double-drawn, and how the opening deal is held hidden
  behind the start overlay until the user clicks.
- **The drop target is computed once per frame, not per pointer event.** A 1000 Hz
  mouse fires several `pointermove`s per frame; `Input.updateDropTarget()` is called
  from the game loop instead and stores the result on `drag.target`, which the
  renderer rings. `dropDrag` still recomputes from the pointer-*up* position, because
  on touch that can land several px from the last move.
- **The board is playable without a pointer.** `cursor.ts` holds a `{pile, depth}`
  cursor and the words for it; `main.ts` binds the keys and `render.ts` rings it. Two
  things make it work rather than merely exist. First, **`depth` is the bottom of the
  run you'd pick up**, not just "which card" — `minDepth` walks down while the run
  stays valid and the cards stay face up, so Shift+Up can only ever select something
  legal to move. Second, **the cursor is re-seated after every change** (`clampCursor`
  from `onChange`): piles shrink, runs move away and a ✦ stack disappears the moment
  it empties, so a stored index cannot be trusted between frames.
  The cursor is drawn only while `keyboardActive`, which a `pointerdown` clears —
  a mouse player never sees a cursor they didn't ask for, and the two never compete
  to answer "what am I about to move".
- **Foundations are not suit-locked, whatever the placeholders suggest.**
  `canMoveToFoundation` lets *any* ace start *any* foundation, and the suit is then
  whatever landed there. The empty-pile glyphs (♠♥♦♣) are decoration. `pileName`
  therefore numbers an empty foundation and names a filled one after its actual
  cards — announcing "the spades foundation" for an empty pile would promise a rule
  the game doesn't have.
- **The solver keeps its own board, and a test stops the rules drifting.** Searching
  through `Game.undo()` would be tempting — one copy of the rules — but `MAX_HISTORY`
  caps the undo stack at 200, so past that depth an undo pops the wrong snapshot. So
  `solver.ts` has a compact state of its own, and `solver.test.ts` cross-checks its
  move generator against `Game` on real and hand-built positions. That check has
  already earned its place twice: it caught the pruning layer withholding moves
  `game.ts` allows (hence `prune`, and comparing the *complete* set), and its one blind
  spot — `compare()` built no `foundationToTableau` entries on either side — is exactly
  where the empty-column bug hid. **A move class absent from both sides of that
  comparison is unchecked, not agreed.**
  **"Unwinnable" is a claim, so the move set must be complete** — including
  foundation→tableau, and specifically **onto an empty column**: pulling a King back
  off a foundation to open a base is the only way some boards are winnable at all, and
  omitting it made the solver declare such a deal dead. The empty-column dedup that
  goes with it is **per card, not per position** — sharing one flag across suits offers
  only the lowest-numbered foundation an empty column, and if that card is the wrong
  colour for what needs a base the winning line is invisible. Anything a budget cuts short is
  `unknown`, never `unwinnable`. ✦ stacks and easy mode change what a legal move is
  and are not modelled: `canAnalyse` returns false and the UI says so rather than
  answering a different question.
  **There are three budgets, and all three fail to `unknown`.** Nodes is the obvious
  one. `MAX_DEPTH` is not optional: `search` recurses once per move, so without a depth
  ceiling a large enough node budget ends in `RangeError: Maximum call stack size
  exceeded` — which in a browser, whose stack is smaller than Node's, surfaces as
  "couldn't run the analysis" rather than as an answer. `SEEN_CAP` bounds the visited
  set; past it the search stops *remembering* rather than stops searching, which costs
  re-exploration and never an answer. That last one is also why the key stays an exact
  string rather than a hash: two positions colliding would prune an unexplored branch
  and could call a winnable board dead.
  The key is one character per card (`CH`), with separators *below* the card range so a
  card can never be read as one — a column's length isn't otherwise recoverable, and the
  ambiguity would be a collision by another name. It encodes face-down *counts*, which
  is lossless because those cards never move and an empty face-up half over a non-empty
  face-down one can't occur (`flipIfNeeded` turns one up as part of the same move).
  Measured over the same 40 draw-1 deals at 200k: 27 solved, 2 dead, 11 unknown, **71 ms
  average and 253 ms worst** — down from 121/450 before the compact key and before the
  per-node move list stopped being generated twice. More nodes buy very little on their
  own (500k changes nothing at all; 1M resolves one more board), so the UI escalates to
  2M **only when the fast pass says `unknown`**: 29 solved, 3 dead, 8 unknown, and the
  29 boards that answer quickly never pay for it. All of which is why it runs in a
  worker rather than on the frame loop.
- **A hint is the first move of a line that wins, or it is nothing.** `solve` already
  computed the whole line; the worker sends `moves[0]` through `toGameMove` and drops
  the rest, because a full walkthrough is a different feature and copying a few hundred
  moves nothing reads is pure cost. On `unwinnable` or `unknown` the button says so
  instead of falling back to a plausible-looking move: the removed `findHint` was that,
  and the greedy player built on it can't win a game (40 of 52 cards home over 200
  seeds). A guess dressed as a hint would cost the feature the one thing it has.
  `toGameMove` resolves foundations by asking which pile *accepts* the card, since the
  search tracks them per suit while the game's four piles aren't suit-locked, and it
  returns null rather than pointing at a pile that isn't there.
- **A winnable deal is screened, not generated.** `newWinnableGame` shuffles and asks
  the solver until one comes back `solved`, at the fast budget with no escalation — an
  `unknown` isn't a board to reject on its merits, it's one we can't vouch for, and
  reshuffling is cheaper than thinking harder about it. Candidates are tested at the
  *current* draw count, because a board winnable at Draw 1 needn't be at Draw 3. About
  two thirds pass, so it almost always ends on the first or second try; `WINNABLE_TRIES`
  is a ceiling for when something has gone wrong, and a search that comes up empty
  leaves the board alone rather than costing the player the game they were in.
- **The archive can't back-fill a streak.** Past dailies are playable from the grid
  in the statistics dialog, and winning one ticks its day and counts in `dailyWins` —
  but the run is only ever about keeping up with *today*, so `recordWin` takes
  `daily: { key, extendsStreak }` and only main.ts decides which case it is. Filling in
  a gap after the fact therefore cannot revive a lapsed streak, which is the whole
  reason the two are separate fields rather than inferred from a date. Which day a
  board belongs to is **derived** (`dailyDayForSeed` searches the last
  `ARCHIVE_WINDOW` day-hashes), keeping the no-new-persisted-state property the daily
  deal started with: a game resumed days later is still the daily it came from.
  `dailyWonDays` is capped at 400 entries because the grid only shows 28 and an
  uncapped list grows forever; `dailyWins` is the uncapped total, so trimming costs no
  counter. The grid lives in the stats dialog rather than behind a new toolbar button
  because it *is* the daily record and the measured wrap threshold has no room.
- **Offline is a service worker with two strategies, and one non-obvious rule.**
  `public/sw.js` is hand-written (no Workbox — the zero-runtime-dependency rule).
  **Navigations are network-first**, because `index.html` is the one unhashed file
  that changes every deploy and cache-first on it is exactly how a worker strands
  people on a dead bundle; everything else is cache-first, since `assets/*` are
  content-hashed and the card art never changes. The non-obvious rule: **every lookup
  passes `ignoreVary: true`.** `cache.add()` precaches a `no-cors` request with no
  `Origin` header while the browser's real module-script request is `cors` and sends
  one, so against a server that emits `Vary: Origin` (Vite's preview does, and a
  CORS-configured CDN may) a Vary-respecting match misses every time and the app
  silently fails to load offline. `stampServiceWorker` in `vite.config.ts` fills in
  the cache version (a hash of the emitted asset names, so an unchanged bundle
  rebuilds byte-identically rather than evicting everyone) and the precache list, then
  **parses the result and fails the build if it isn't valid JavaScript** — a worker
  that doesn't compile only shows up as a rejected `register()`, which the app
  swallows on purpose. For the same reason neither placeholder token appears anywhere
  else in `sw.js`, comments included: the substitution is a global replace and the
  multi-line precache array would break out of a `//`.
- **Themes are a registry, and they own the card back.** `THEMES` in `theme.ts` is
  the single list; `ThemeName` is `keyof typeof THEMES`, so adding an entry makes it a
  legal `?theme=` value and a legal saved preference with no union to keep in step.
  Adding a theme is one entry plus one `body[data-theme="…"]` block in `styles.css` —
  `data-theme`, not a class per theme, so a new one can't leave a stale class behind.
  The **card back** lives in the theme because it used to be a hardcoded blue in
  `drawBack`, identical everywhere, and it is the most-visible surface on the table:
  the felt is mostly covered by cards. When adding a theme, sample `--felt-top-edge`
  and `--felt-top-mid` from its own `feltStops`, or the fake-felt strip left by a
  hidden toolbar shows a seam.
- **Three pile highlights, and they answer different questions.** `highlightPile` is
  the drop target — steady, white, wide, drawn under the dragged stack.
  `highlightRun` is the keyboard cursor — yellow, tight to the cards, and covering the
  whole run rather than the pile, because the outline *is* the cards that would move;
  the held version fills and glows. `drawHint` is the solver's suggestion — cyan,
  **dashed** where both others are solid, and marking a *pair* of piles joined by an
  arrow, which neither other ever does: a hint answers "from here to there", not
  "here". They have to stay tellable apart when more than one is on screen, which is
  why each differs from the others in colour, weight *and* extent rather than in just
  one of the three. A fourth would want the same scrutiny.
- **Card size is set by the fan reserve, not by the width.** Height binds at
  every ordinary landscape aspect, so `computeLayout` sizing the cards is really
  a choice about how deep a column may fan before `columnOffsets` compresses it:
  `RESERVED_FACE_DOWN`/`RESERVED_FACE_UP` (6 + 4) buy the common case, and the
  rare 13-card run overlaps tighter instead of shrinking every card all game.
  Leftover width goes into the gutters (`MAX_EXTRA_GAP`) so the row spreads over
  the table. Raising the reserve shrinks the cards *everywhere* — that's what
  made the board a small huddle of cards in the middle of empty felt.
- **The portrait board is the landscape one transposed.** `verticalLayout` runs
  stock, waste and the foundations down a **rail** at the left — landscape's top
  row — and gives the tableau rows the full height, one slot each. The rail is the one
  thing on the board with a handedness: it holds the stock, which is the pile you tap
  over and over, and the hand holding a phone covers the side it's on — so `leftHanded`
  mirrors the x coordinates. It must move the **fan limit** with the rail, not just the
  piles, or the rows fan out underneath it. The landscape board takes the flag and
  ignores it: a top row is not something a thumb reaches across, and the test asserts
  the two layouts come out identical. The ☰-adjacent 🤚 button is shown only while
  `body.portrait-board` is set, so it costs the desktop toolbar no width at all. A header above
  the rows would divide the height one more way (shrinking every card ~18%) and
  leave a void in the rail beside the top rows. Consequences to keep: the waste sits
  `COUNTER_GAP` below the stock so `drawStockCounter` has room; `wasteFan` runs
  *down* the rail, since fanning right would cross the rows; the row fan steps are
  their own constants (`ROW_FACE_*`), because a fraction of the card's *width*
  reveals less than the same fraction of its height; and width-bound boards spread
  leftover height into the row gaps up to `MAX_ROW_GAP`, then centre the rest.
- **The ☰ toggle only exists when the bar wraps.** `updateChromeToggle` measures
  the real layout — a box is on one row exactly when it's no taller than its
  tallest child — and adds `#toolbar.needs-toggle`. It measures with the button
  *in flow* (`.is-measuring`), so its own width counts and the answer can't
  oscillate; while the bar is folded the toggle always shows, since it's the only
  way back. The button is parked `position: absolute; visibility: hidden` rather
  than `display: none` precisely so it stays measurable.
- **A hidden toolbar still leaves a strip, on purpose.** `body.chrome-hidden`
  folds away `.controls` — only the buttons; the clock, moves and score are
  information and stay next to the ☰ toggle (`#btn-chrome`, or the `T` key).
  That strip is painted as fake felt (`--felt-top-edge` / `--felt-top-mid` in
  `styles.css`, sampled from `theme.ts`'s gradient) so the seam doesn't show. The
  toggle stays **in flow** rather than floating over the canvas: in the
  phone-portrait layout the stock sits in the board's top-left corner, and a
  button there would swallow its clicks. Nothing has to re-measure the board —
  the canvas `ResizeObserver` already does.
- **Everything is DPI-aware.** The canvas backing store is scaled by
  `devicePixelRatio`; all drawing happens in CSS pixels.
- **`#board` needs `min-height: 0` (and `min-width: 0`) — it is not cosmetic.** A
  flex item's `min-height: auto` resolves through its intrinsic ratio, and a
  canvas takes one from the `width`/`height` attributes `resize()` writes. Without
  the override the canvas can force itself taller than its flex share, `resize()`
  measures that inflated box, and writing it back into the attributes makes the
  wrong size *self-sustaining*. It stays invisible while the window's aspect ratio
  holds — the ratio-derived minimum happens to equal the real height — then a phone
  rotation leaves the board permanently sized for a ~1700px-tall canvas.
- **One debounced path rebuilds the board.** Every size signal (the canvas
  `ResizeObserver`, `window` resize, `orientationchange`, `visualViewport` resize)
  goes through `scheduleResize` → `applyResize`, trailing-debounced by
  `RESIZE_DEBOUNCE_MS`; a rotation reports its new size in stages, and each stage
  just restarts the timer. `applyResize` no-ops when the measured size and dpr are
  unchanged, so extra signals are free. `refreshAfterResize` then drops what was
  anchored to the old geometry — and because the deal's "unbusy" tween and the
  auto-complete chain live in the animator, clearing it means owning their jobs:
  reset `busy`, restart the sweep via `pendingCheck`, re-enable the buttons.
  Before the overlay is dismissed it must *not* clear, or `hideCards` stops hiding
  the board. `syncSpareLayout` stays synchronous — its caller needs the new layout
  on the next line.
- **Two dialogs, two behaviours.** The win panel is *not* modal — no backdrop, wrapper
  `pointer-events: none` — because the cascade is the reward. The stats dialog
  (`#stats-overlay`) is: it dims the board, and a backdrop click or Escape closes it.
  Escape is checked in the keydown handler *before* the drag cancel. Both share the
  card look, the `.dialog-actions` row, and the re-declared dark palette.
- **The cascade is three effects at once, and the canvas is never cleared.** Cards
  launch **one at a time** (`LAUNCH_EVERY`) rather than all together, so the screen
  fills in a rhythm; they **tumble** (`angle`/`spin`, drawn via `drawCard`'s `angle`),
  so a wall of parallel rectangles never forms; and fireworks keep bursting behind
  them. Because `runCelebrationFrame` paints without clearing, *everything* leaves a
  trail — that is what makes sparks read as streaks, and it is the iconic look, so
  don't "fix" it. The extras are gated on `prefers-reduced-motion` directly rather
  than on `animationsOn`: the latter is also set by `?animate=off` for deterministic
  screenshots, and the win shot is the one place the flourish should be captured.
  `playFanfare` is the only sound in `sound.ts` built from oscillators instead of
  filtered noise — everything else is a card moving, and a win is the one moment that
  earns a pitch.
- **The win dialog is DOM, not canvas.** `#win-overlay` / `#win-panel` in
  `index.html` replaced a banner painted into the canvas, so New Game and Restart are
  real buttons — focusable, keyboard-reachable, styled by the same `.btn` rules. Three
  things it has to get right: the wrapper is `pointer-events: none` so the cascade
  keeps running and the toolbar stays clickable; it centres inside the *board* via
  `--bar-h` (which `syncBarHeight` publishes) because a viewport-centred panel sits on
  the toolbar on a short landscape phone; and the panel re-declares the dark palette
  (`--text`, `--btn-bg-*`) since it stays dark in both themes and light-theme buttons
  would otherwise be dark-on-dark. It opens from `startCelebration` and closes in
  `beginGame`, so it can't outlive its game.
- **Audio needs a user gesture.** Browsers block audio until the first click, so
  the opening deal (and its sound) waits behind the click-to-play overlay in
  `index.html` / `#start-overlay`; clicking calls `unlockAudio()` then `startDeal()`.

### Persisted to `localStorage`

All access goes through `src/storage.ts` and is best-effort — storage can be
absent or full, in which case the game just runs without it.

Settings: theme (`solitaire-theme`), sound (`solitaire-sound`), whether the
toolbar is folded away (`solitaire-chrome`), and which edge the portrait rail sits on
(`solitaire-hand`) — a preference rather than a per-game setting, since which hand
holds the phone doesn't change between deals. Theme also accepts
`?theme=<name>` for any theme in the registry (anything else falls back to dark, so an old saved value or a hand-typed one can't break a boot); animations can be disabled with `?animate=off` (also off
under `prefers-reduced-motion`). A specific layout can be requested with
`?deal=<code>` and `?draw=1|3` — though `draw=1` is only ever *read*, never written:
it's the default, so `shareUrl()` emits `draw` for Draw 3 alone and strips it
otherwise.

Lifetime statistics (`solitaire-stats`, schema-versioned like the game save) sit
deliberately outside it, so nothing routine clears them — only the Reset button does.
The shape of the bookkeeping is where the thinking is:

- **A deal becomes a *played* game on its first move** (`recordGameStart` from
  `onChange`), not when it's dealt — otherwise cycling through deals looking for a
  friendly one would tank the win rate. `countedPlayed` in `main.ts` guards the
  counting, not `game.moves`, because undo can take the move count back to 0.
- **`pending` is persisted** so a game left unfinished — including by closing the tab —
  still breaks the streak when the next game starts. `recordAbandon` covers the
  in-session case (New Game or Restart over a game with moves in it) and banks its
  time; the `pending` check in `recordGameStart` covers the across-sessions one.
- **Every field is sanitised on read** and `won` is clamped to `played`, so a
  hand-edited record can't show a win rate over 100%. A 0 for a "best" means *never*,
  which is why the dialog shows a dash rather than 0:00 or 0 moves.
- **`recordWin` returns `{ stats, isRecord }` honestly even when the write fails** —
  the player did just win. Beating the best score is strictly greater, so matching it
  isn't announced as new.
- **`STATS_SCHEMA` is for changes of *meaning*, not for every edit.** A mismatch
  discards the whole lifetime record, which is a real loss — unlike the game save,
  where a discard costs one board. Purely *additive* fields need no bump: every field
  is sanitised independently, so an older record reads its new ones as 0. That is how
  the daily-deal counters landed without wiping anyone's history.
- **The daily streak is stored but read through `currentDailyStreak`.** The stored
  number can't say whether the run is still live, so `lastDailyWin` (a `YYYY-MM-DD`,
  `""` for never) is what makes it answerable: won today or yesterday and the run
  stands, anything older and it reads 0. Deliberately lazy — nothing has to run at
  midnight to expire a streak. `daysBetween` parses at UTC midnight so a 23- or
  25-hour DST day still counts as one day.
- `solitaire-best`, the pre-stats best score, is read once to seed `bestScore` and
  cleared by `resetStats` — otherwise resetting would resurrect the old record.

**Easy mode is not a setting** — it's per-game. Every fresh deal starts with it
off (`applyEasy(false)` in `newGame`, and `false` on a save-less boot); it only
travels with a game through that game's save.

The game in progress (`solitaire-game`) so a refresh resumes the same board:

- `Game.serialize()` / `Game.restore()` are pure; piles are arrays of compact card
  codes (`encodeCard`: the card id, plus 52 when face up). `parseGameState` in
  `game.ts` validates untrusted saves — full-deck, face-state, and foundation
  checks — and anything it rejects is dropped so a fresh deal takes over silently.
- The envelope is schema-versioned (`v`). Bump `SCHEMA` in `storage.ts` when the
  meaning of `GameState` changes; old saves are discarded, never migrated.
- The save exists exactly while there's an in-progress game: `persist()` no-ops
  before the first move and once won, so New Game and winning clear it.
- **Undo/redo history rides along in the save**, capped at `PERSISTED_HISTORY` (40)
  rather than the in-memory `MAX_HISTORY` (200): the save is rewritten on every move,
  so the whole stack would be ~60 KB of JSON per move to buy depth nobody reaches
  after coming back to a game. Snapshots go through the *same* `parseBoardState` as
  the live board — a snapshot is a board the game adopts wholesale on the next Undo,
  so accepting a broken one just moves the corruption one keystroke away — and one bad
  entry drops the whole stack rather than leaving a hole, since undo walks the list in
  order and a gap would silently skip a position. The fields are **optional**, which is
  why this needed no `SCHEMA` bump: an older save is still a perfectly good board and
  resumes with an empty history, exactly as every resumed game used to.
- Elapsed play time rides along, and freezes while the tab is closed.
- The start overlay reads "Resume game" when a save exists and reveals the board
  via `animator.clear()`. It must not call `startDeal()`, which assumes a freshly
  dealt pyramid and would throw on a restored board.

### Seeded deals

Every game carries a 32-bit `seed`, so Restart and the shareable deal code are always
available with no special state. The board deliberately doesn't display the code —
the URL is the shareable artefact, kept current by `syncDealUrl()`. `deal(seed?)`
defaults to a fresh random seed; `restartDeal()` replays the current one.

**`rng.ts` plus the shuffle loop in `cards.ts` is a wire format.** Deal codes get
shared, bookmarked and pasted into URLs, so changing the generator, the loop, or the
`SUITS` order silently reinterprets every code already out there. `rng.test.ts` pins
the first values of the stream for exactly this reason.

Boot rule: a saved game resumes unless `?deal=` names a *different* layout, so
reloading a shared link mid-game keeps your board instead of wiping it. The current
code is kept in the address bar via `replaceState` — on every deal *and* when the
draw toggle changes, since the mode is part of what a shared link means — which also
makes screenshots reproducible: `?deal=N&animate=off` is fully deterministic.

Note `parseGameState` deliberately does **not** check that the seed actually deals
the saved board; verifying would mean re-running the deal on every load, and the
only consequence of a mismatch is that Restart lays out a different game.

### The daily deal

One board per calendar day, so a score on it is worth comparing. It needed no new
persisted state, and that's the whole design:

- **A daily *is* an ordinary seeded deal.** `dailySeed(dailyKey(new Date()))` in
  `rng.ts` is the whole mechanism, and `main.ts`'s `isDailyGame()` is
  `game.seed === dailySeed(todayKey())` — derived, never stored. So the save format
  is untouched, a *resumed* game is still recognised as the daily, and Restart and
  the `?deal=` share URL work on it for free.
- **`dailySeed` is a wire format too**, for the same reason `mulberry32` is: it
  decides which board "the daily for 2026-08-10" is, and every streak already
  recorded assumes that answer never changes. Pinned in `rng.test.ts`.
- **The date is hashed, not used as the seed.** Consecutive days differ in one low
  digit; FNV-1a plus an avalanche step means their boards are unrelated without
  relying on the PRNG to do that job.
- **`dailyKey` reads the *local* date.** The deal turns over at the player's own
  midnight rather than in the middle of their afternoon; the cost is that two
  timezones briefly disagree on which deal is today's, which matters far less.
- **The midnight edge is left alone.** A daily won a minute after it stops being
  today's banks as an ordinary win — the harmless direction to fail in, and closing
  it would mean persisting a flag and bumping the save schema.
- **Pressing 📅 while already part-way through today's deal does nothing.** The
  button's job is "put me on today's board", and re-dealing would silently bin the
  progress; New Game and Restart still do that deliberately.
- `syncDailyButton` is called at the four points that can change the button's state —
  boot, a new deal, a win, a stats reset — and not from `updateStats`, which runs on
  every move and would re-read storage each time.

## Verifying visual changes

No `chromium-cli` or Playwright browsers are installed here, but system Chrome
is. Drive a Vite dev server with Playwright pointed at the Chrome executable
(`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`),
navigate, click `#start-btn` to deal, and screenshot. Always check the browser
console for errors before declaring success.

### The README screenshots

`screenshots/*.png` come from `npm run screenshots`
(`scripts/shoot-screenshots.mjs`). Nothing in CI touches them and the output is
committed. The script starts its own Vite server on a free port, so nothing needs to
be running first and it can't collide with `npm run dev`; `ONLY=win,stats npm run
screenshots` reshoots a subset.

**Any change to the toolbar dates every board shot at once** — a button added or
removed shows up in all six. Run the script; don't patch a single image.

Each shot keeps the pixel size it has always had: 1280×820 for `gameplay`,
`gameplay-light` and `spare-pile`, 1280×706 for `win`, 1000×700 for `stats` and
`toolbar-hidden` (narrow enough that the ☰ is offered), and 390×844 at DPR 2 for
`iphone`. `cards.png` is card art from `cards:rasterize` and is not touched here.

The same run also writes **`public/og.png`** (1200×630, the ratio scrapers show
uncropped), which `index.html` points `og:image` at. It lives in this script on
purpose: a link preview built from the real app can't drift into advertising a version
of the game that no longer exists. It is shot with the toolbar folded — at that height
the cards come out far more legible, and a preview is rendered small. The `og:` tags
and `canonical` are deliberately static even for a `?deal=` link, since every deal is
the same page and would get the same picture.

The script's header comment carries the reasoning and is worth reading before
changing it. The short version, each point having gone wrong at least once:

- **Boards are built with the real `Game`,** through its own API, so every injected
  save is a state `parseGameState` accepts — a hand-written pile need not be.
- **After injecting, `goto` the clean URL again — never `reload()`.** `syncDealUrl()`
  has by then written a `?deal=` into the address, and one naming a different layout
  makes the boot rule discard the save. The "Resume game" assertion is what stops a
  run silently photographing a random fresh deal.
- **One stock click after the overlay,** or every shot shows Undo/Redo greyed out.
  It clicks `computeLayout(...).stock`, not a fixed point, so it lands at every
  viewport.
- **`win.png` is the one board assembled rather than played.** The script's greedy
  player — which stands in for the removed `findHint` — can't win a game; over 200
  seeds its best is 40 of 52 cards home. So that board is built directly, asserted
  against `parseGameState`, and handed to the app's own auto-complete to finish and
  set the cascade going. It is also the one shot that never reproduces byte-for-byte,
  since the cascade is `Math.random()` physics sampled on a wall-clock delay; the
  other six do.

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
- Motion respects `prefers-reduced-motion` from **both** sides: `main.ts` watches the
  media query (and re-reads it on change, so toggling the OS setting needs no
  reload), and `styles.css` has a matching block for the CSS transitions.
- Card faces are the public-domain *vector-playing-cards* set; don't commit
  replacements without checking licensing. They ship in two formats for size
  reasons — the 12 court cards as WebP rasterised from `art/cards-src/`, the 40
  pip/ace faces as SVGO'd SVG. `art/cards-src/README.md` explains why and records
  the settings; `cardFaces.ts` picks the extension by rank. Regenerate with
  `npm run cards:rasterize` / `npm run cards:optimize` — both are one-off, their
  output is committed, and neither runs during `npm run build`.
- **Button icons are decoration, and they cost width.** Each labelled control carries
  a `<span class="ico" aria-hidden="true">` so the label keeps the accessible name;
  never let an icon become a button's only content without an `aria-label` (the two
  icon-only buttons have one). Undo/redo use text glyphs (`↺ ↻`) instead of emoji
  because the emoji arrows render dark blue-grey and disappear into the dark bar,
  while colour emoji survive the yellow `aria-pressed` state unchanged. The icons add
  ~120px to the control row, which is why there's a `max-width: 1340px` block
  tightening button padding **and hiding `.btn .ico` outright** — measured at 1280,
  the glyphs are 96px of the row and dropping them turns a 74px overflow into 22px of
  slack, where trimming padding alone could never have found that much. The icon-only
  buttons keep theirs, since there the glyph *is* the button. Without the rule a
  1280px window wraps onto a second row, which `npm run smoke` checks. On
  phones they cost a third button row (+34px); the ☰ fold is the escape hatch.
- **Only the pip faces are preloaded.** `preloadCardFaces` fetches the 40 pip/ace
  SVGs (~150 KB) up front and warms the 12 court WebPs (~850 KB) on idle, so they
  stay off the critical path. A court card needed before then loads on demand from
  the render loop, with `courtArt.ts`'s procedural face covering the gap — so
  `getCardFace` returning null is a normal state, not an error.
