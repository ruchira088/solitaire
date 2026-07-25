# CLAUDE.md

Klondike Solitaire — TypeScript + HTML5 Canvas 2D, bundled with Vite. **Zero
runtime dependencies**; the shipped bundle is pure vanilla JS/Canvas.

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
- **Everything is DPI-aware.** The canvas backing store is scaled by
  `devicePixelRatio`; all drawing happens in CSS pixels.
- **Audio needs a user gesture.** Browsers block audio until the first click, so
  the opening deal (and its sound) waits behind the click-to-play overlay in
  `index.html` / `#start-overlay`; clicking calls `unlockAudio()` then `startDeal()`.

### Persisted to `localStorage`

All access goes through `src/storage.ts` and is best-effort — storage can be
absent or full, in which case the game just runs without it.

Settings: theme (`solitaire-theme`) and sound (`solitaire-sound`). Theme also
accepts `?theme=light|dark`; animations can be disabled with `?animate=off`
(also off under `prefers-reduced-motion`).

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

## Verifying visual changes

No `chromium-cli` or Playwright browsers are installed here, but system Chrome
is. Drive a Vite dev server with Playwright pointed at the Chrome executable
(`executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`),
navigate, click `#start-btn` to deal, and screenshot. Always check the browser
console for errors before declaring success.

## Deployment

CI/CD (GitHub Actions → S3 + CloudFront via AWS CDK) is documented in detail in
`README.md` ("Deployment"). The CDK app lives in `cdk-deploy/`; Ansible build/
upload playbooks in `playbooks/`. App-specific config (stack name, domain,
artifact bucket) is in `cdk-deploy/bin/cdk-deploy.ts`.

## Conventions

- TypeScript strict mode. Match the existing terse, comment-light-but-purposeful
  style — file headers and non-obvious invariants get a comment; mechanics don't.
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
