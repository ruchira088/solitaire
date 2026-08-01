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
| `vite` | `^8.1.5` | dev server + production bundle. Its `engines` field is what sets the **Node 20.19+ / 22.12+** floor (`.nvmrc` pins 24) |
| `vitest` | `^4.1.10` | the pure-logic suite (`npm test`), configured separately in `vitest.config.ts` |
| `svgo` | `^4.0.2` | one-off pip/ace face optimisation (`npm run cards:optimize`) |
| `playwright-core` | `^1.62.0` | drives *system* Chrome — both `scripts/rasterize-cards.mjs` and the visual checks below. `-core` on purpose: no browser binaries are downloaded |

**When any of this changes — a package added, removed, or moved across a major
version — update the table above *and* the matching spots in `README.md`:** the
`npm install` comment and Node requirement under "Getting started", and the
"Tech stack" list. The two files drift silently otherwise, since nothing checks
them.

## Commands

```bash
npm run dev        # Vite dev server with hot reload
npm run typecheck  # tsc --noEmit (strict mode)
npm test           # vitest run — the pure-logic suite
npm run test:watch # vitest in watch mode
npm run build      # tsc + vite build → dist/
npm run preview    # serve the production build
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
| `src/rng.ts` | Seeded PRNG + deal codes — **a frozen wire format**, see below |
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
- **The drop ring is steady; the hint pulses.** Both go through
  `render.ts`'s `highlightPile`, so that difference — not just colour — is what keeps
  them apart when both are on screen.
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
`?deal=<code>` and `?draw=1|3`.

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
code is kept in the address bar via `replaceState`, which also makes screenshots
reproducible — `?deal=N&animate=off` is fully deterministic.

Note `parseGameState` deliberately does **not** check that the seed actually deals
the saved board; verifying would mean re-running the deal on every load, and the
only consequence of a mismatch is that Restart lays out a different game.

## Verifying visual changes

No `chromium-cli` or Playwright browsers are installed here, but system Chrome
is. Drive a Vite dev server with Playwright pointed at the Chrome executable
(`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`),
navigate, click `#start-btn` to deal, and screenshot. Always check the browser
console for errors before declaring success.

### The README screenshots

`screenshots/*.png` are regenerated by hand — nothing in CI touches them — and
each one keeps the pixel size it already had: 1280×820 for `gameplay`,
`gameplay-light` and `spare-pile`, 1280×706 for `win`, 1000×700 for
`toolbar-hidden` (narrow enough that the ☰ is offered), and 390×844 at DPR 2 for
`iphone`. `cards.png` is card art and unaffected by layout work.

What makes them reproducible rather than fiddly:

- **Build the board with the real `Game`** (play legal moves through its own API)
  and inject `Game.serialize()` into `localStorage` as a `v: 2` save. Every state
  is then one `parseGameState` accepts, and a hand-written pile is not.
- **`goto` the clean URL again — never `reload()`.** By then `syncDealUrl()` has
  rewritten the address with `?deal=`, and a `?deal=` naming a *different* layout
  makes the boot rule throw the injected save away for a fresh deal. This is the
  documented behaviour, and it silently ruins a screenshot run.
- **Draw one card after dismissing the overlay.** A resumed game starts with no
  undo history, so otherwise every shot shows Undo/Redo greyed out.

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
- **Only the pip faces are preloaded.** `preloadCardFaces` fetches the 40 pip/ace
  SVGs (~150 KB) up front and warms the 12 court WebPs (~850 KB) on idle, so they
  stay off the critical path. A court card needed before then loads on demand from
  the render loop, with `courtArt.ts`'s procedural face covering the gap — so
  `getCardFace` returning null is a normal state, not an error.
