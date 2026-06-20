# CLAUDE.md

Klondike Solitaire — TypeScript + HTML5 Canvas 2D, bundled with Vite. **Zero
runtime dependencies**; the shipped bundle is pure vanilla JS/Canvas.

## Commands

```bash
npm run dev        # Vite dev server with hot reload
npm run typecheck  # tsc --noEmit (strict mode)
npm run build      # tsc + vite build → dist/
npm run preview    # serve the production build
```

There is no test suite. After changes, run `npm run typecheck` and, when the
change is visual or behavioural, run the app and look at it (see Verifying).

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

### Settings persisted to `localStorage`

Theme (`solitaire-theme`), sound (`solitaire-sound`), and easy mode
(`solitaire-easy`). Theme also accepts `?theme=light|dark`; animations can be
disabled with `?animate=off` (also off under `prefers-reduced-motion`).

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
- Card faces are the public-domain *vector-playing-cards* SVG set in
  `public/cards/`; don't commit replacements without checking licensing.
