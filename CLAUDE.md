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
| `vite` | `^8.1.5` | dev server + production bundle, and `createServer` is what the screenshot script serves the app from. Its `engines` field is what sets the **Node 20.19+ / 22.12+** floor (`.nvmrc` pins 24) |
| `vitest` | `^4.1.10` | the pure-logic suite (`npm test`), configured separately in `vitest.config.ts` |
| `svgo` | `^4.0.2` | one-off pip/ace face optimisation (`npm run cards:optimize`) |
| `playwright-core` | `^1.62.0` | drives *system* Chrome — `scripts/rasterize-cards.mjs`, `scripts/shoot-screenshots.mjs` and the visual checks below. `-core` on purpose: no browser binaries are downloaded |

**When any of this changes — a package added, removed, or moved across a major
version — update the table above *and* the matching spots in `README.md`:** the
`npm install` comment and Node requirement under "Getting started", and the
"Tech stack" list. The two files drift silently otherwise, since nothing checks
them.

## Commands

```bash
npm run dev         # Vite dev server with hot reload
npm run typecheck   # tsc --noEmit (strict mode)
npm test            # vitest run — the pure-logic suite
npm run test:watch  # vitest in watch mode
npm run build       # tsc + vite build → dist/
npm run preview     # serve the production build
npm run screenshots # reshoot screenshots/*.png (one-off; output is committed)
```

After changes, run `npm run typecheck` and `npm test`, and when the change is
visual or behavioural, run the app and look at it (see Verifying).

### Tests

Vitest, colocated as `src/*.test.ts`. Both `npm test` and `npm run typecheck` gate
CI ahead of every deploy — see the `build-and-typecheck` job.

Scope is deliberately the **pure** modules: `game.ts`, `cards.ts`, `layout.ts` and
`storage.ts`. `render.ts` / `animation.ts` / `input.ts` / `main.ts` need a canvas,
and mocking one only buys assertions about the mock — those are covered by the
Playwright procedure under "Verifying visual changes" instead.

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
| `src/theme.ts` | Light / dark felt + placeholder palettes |
| `src/sound.ts` | WebAudio sound effects (deal tick, etc.) |
| `src/storage.ts` | `localStorage`: UI preferences + the in-progress game save |

### Key design invariants

- **`countMove()` is the only place `moves` advances.** Every move costs
  `MOVE_COST` (1 point), which is what makes winning in fewer moves score better — so
  the counter and the charge live together and a new kind of move can't quietly get in
  free. A foundation move nets +9 after it, and the score's floor at 0 means moves are
  effectively free while a game sits at zero.
- **`game.ts` stays pure.** Rules, move validation, scoring, and undo snapshots
  have no DOM/canvas dependencies. Keep new rules logic here and testable in
  isolation.
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
- **The drop ring is the only pile highlight.** `render.ts`'s `highlightPile` draws
  exactly one thing — steady and white, deliberately not animated. It used to take a
  style so the Hint feature could pulse a second ring in a different colour; hints are
  gone, and anything new that rings a pile should think hard before reintroducing a
  second visual language for it.
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
  row — and gives the tableau rows the full height, one slot each. A header above
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

Settings: theme (`solitaire-theme`), sound (`solitaire-sound`) and whether the
toolbar is folded away (`solitaire-chrome`). Theme also accepts
`?theme=light|dark`; animations can be disabled with `?animate=off` (also off
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
- **Undo/redo history is not persisted** — both start disabled on a resumed game.
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
  tightening button padding — without it a 1280px window wraps onto a second row. On
  phones they cost a third button row (+34px); the ☰ fold is the escape hatch.
- **Only the pip faces are preloaded.** `preloadCardFaces` fetches the 40 pip/ace
  SVGs (~150 KB) up front and warms the 12 court WebPs (~850 KB) on idle, so they
  stay off the critical path. A court card needed before then loads on demand from
  the render loop, with `courtArt.ts`'s procedural face covering the gap — so
  `getCardFace` returning null is a normal state, not an error.
