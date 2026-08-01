# Solitaire

### ▶️ [**Play now → solitaire.ruchij.com**](https://solitaire.ruchij.com)

A polished, high-quality **Klondike Solitaire** built with **TypeScript** and the
**HTML5 Canvas**. Cards are crisp **SVG** faces (the public-domain
*vector-playing-cards* set) drawn onto procedurally-rendered, rounded, shadowed
card bodies, so the game stays razor-sharp at any resolution or pixel density,
with smooth, physics-flavoured animations throughout. Zero runtime dependencies.

![Solitaire gameplay](screenshots/gameplay.png)

---

## Highlights

- 🎴 **Classic SVG card faces** — all 52 cards use the public-domain
  *vector-playing-cards* set (detailed court figures, clean pips), drawn on
  rounded, shadowed card bodies. Crisp at any size; a procedural face is used as
  a fallback while the SVGs decode.
- ✨ **Crisp Canvas rendering** — rounded cards with soft drop shadows, patterned
  card backs, and a felt-green gradient table with a subtle vignette. Everything
  is vector and DPI-aware.
- 🎞️ **Fluid animations** — staggered opening deal, card flips, fly-to-pile
  moves, lift-and-drop drag feedback, animated snap-back on illegal moves,
  auto-complete sweep, and a classic bouncing-card **win celebration**.
- 🃏 **Full Klondike rules** — Draw 1 / Draw 3 toggle, multi-card run dragging,
  waste recycling, undo/redo history, hints, scoring, move counter and timer.
- 🏆 **Best score remembered** — your highest score is kept in `localStorage` and
  shown on the win banner, which calls it out when you've just beaten it.
- 🆘 **Easy mode & temp stacks** — toggle a friendlier ruleset where empty
  columns accept any card (not just Kings), and buy up to three temporary
  ✦ **parking stacks** (50 points each) to break a stalemate.
- 🌗 **Light & dark themes** — a toolbar toggle switches the felt and chrome
  between a bright table and a deep, low-light one; your choice is remembered.
- 🙈 **Hideable toolbar** — when the window is too narrow to fit the buttons and
  the stats on one row, a **☰** button (or `T`) folds the buttons away and gives
  the height to the board; the clock, moves and score stay on screen. Wide
  enough to fit, and the toggle isn't there at all. Remembered.
- 🔁 **Seeded deals** — every game has a short **deal code**, kept in the address
  bar (`?deal=ABC123`) rather than on the table. **Restart** replays the same
  layout from scratch, and copying the URL lets someone else play the identical
  game.
- 💾 **Resumes where you left off** — the game in progress is saved to
  `localStorage`, so closing the tab or refreshing brings back the same board,
  score, moves and clock. The opening screen offers **Resume game**, or a fresh
  deal if you'd rather start over. (Undo history isn't kept across a reload.)
- 🖱️ **Mouse & touch** — drag-and-drop, click-to-draw, and double-click /
  double-tap to auto-send a card to its foundation. While you drag, the pile
  you'd land on lights up, the cursor shows what's grabbable, and `Esc` puts
  the cards back.
- 📐 **Responsive** — the board re-lays out to fit any window size. Cards are
  sized to fill the table, with room for an ordinary column to fan; deeper
  columns overlap tighter instead of shrinking every card. Phone-portrait
  screens get a dedicated vertical layout where the piles are listed
  top-to-bottom and cards fan sideways.

## Card art

The 52 card faces are the public-domain
[*vector-playing-cards*](http://code.google.com/p/vector-playing-cards/) SVG set
(`public/cards/`), each drawn onto a rounded, shadowed card body rendered on the
canvas:

![The full deck](screenshots/cards.png)

## Light & dark themes

Toggle the theme from the toolbar (🌙 / ☀️). The felt, vignette, pile outlines
and toolbar all adapt, and the preference is saved to `localStorage` (you can
also deep-link a theme with `?theme=light` or `?theme=dark`).

![Light theme](screenshots/gameplay-light.png)

## Hideable toolbar

Narrow windows can't fit the buttons and the stats on one row, and that's exactly
when the board can least afford the height — so a **☰** button appears (keyboard:
`T`) that folds the buttons away and hands the space to the cards. The clock,
moves and score stay put on a strip painted to match the felt, and the board
re-lays out into whatever it gains. Wide enough for one row, and there's no
toggle at all — there'd be nothing to fold. Your choice is remembered.

![Toolbar folded away](screenshots/toolbar-hidden.png)

## Easy mode & temporary stacks

Two independent assists live in the toolbar:

- **Easy** toggles a friendlier ruleset where **empty columns accept any
  card**, not just Kings. It applies to the game you're playing rather than
  sticking as a preference — every new game starts with it off. (Resuming a
  saved game keeps whatever setting that game was played under.)
- **+ Stack** buys a temporary **✦ parking pile** for **50 points**, added as
  an extra column on the right of the board (or an extra row on phones). Drag
  any card or run onto it to park it — the card underneath is revealed and
  play can continue. Up to three stacks can exist at once; parking on one
  you've bought is free, and a stack **vanishes once you empty it** (freeing a
  slot for another). Buying a stack is undoable like any move.

![Temporary parking stacks](screenshots/spare-pile.png)

## Phone layout

On phone-sized portrait screens the board transposes to fit the tall, narrow
viewport — it's the landscape board rotated. Stock, waste and the four
foundations run down a **rail** on the left, where landscape puts them in a top
row, and the seven tableau piles become rows beside it that fan rightward. The
rows own the full height rather than sitting under a header, which is what keeps
the cards large and easy to tap instead of squeezing seven columns side-by-side.
Rotating the phone switches back to the classic column layout.

<img src="screenshots/iphone.png" alt="Phone-portrait layout" width="340">

## Win celebration

Finish a game — or let the **auto-complete** finish it for you — and the cards
cascade and bounce across the table in the classic Solitaire victory animation. A
dialog shows what you scored against your **best score so far** — kept in
`localStorage` and announced when you beat it — with **New Game** and **Restart**
right there. The cascade keeps running behind it, and the toolbar stays usable:

![Win celebration](screenshots/win.png)

---

## Getting started

Requires **Node 20.19+ or 22.12+** (Vite 8); `.nvmrc` pins 24.

```bash
npm install      # dev tooling only — Vite, TypeScript, Vitest, SVGO, playwright-core
npm run dev      # start the dev server with hot reload (opens the browser)
```

Production build & preview:

```bash
npm run build    # type-check + bundle to dist/  (~13 kB gzipped)
npm run preview  # serve the production build locally
```

Tests:

```bash
npm test         # run the suite once
npm run test:watch
```

## How to play

The goal is to build all four foundations up from Ace to King, one per suit.

| Action | How |
| --- | --- |
| **Draw from stock** | Click the stock pile (top-left). Toggle **Draw 1 / Draw 3** in the toolbar. When the stock is empty, click it again to recycle the waste. |
| **Move a card / run** | Drag a card — or a valid descending, alternating-colour run — between tableau columns. Empty columns accept a King. |
| **Send to a foundation** | Drag an Ace (or the next card in sequence) onto a foundation, or **double-click** (double-tap on touch) a card to auto-send it. |
| **Park a stack** | Click **+ Stack** in the toolbar (−50 points, up to 3), then drag a card or run onto the ✦ pile to set it aside and reveal the card underneath. The pile disappears once you empty it. |
| **Undo / redo** | The **Undo** / **Redo** buttons, or `Ctrl/Cmd + Z` and `Ctrl/Cmd + Shift + Z` (`Ctrl + Y` also redoes). |
| **Hint** | The **Hint** button (or `H`) pulses a useful move. |
| **New game** | The **New Game** button, or `N`. |
| **Replay a deal** | **Restart** re-deals the same layout from the start. |
| **Share a deal** | Copy the page URL — it always carries the current deal (`?deal=…`), plus `&draw=3` when you're playing Draw 3. |
| **Hide the toolbar** | The **☰** button at the far left of the bar, or `T` — offered when the bar can't fit on one row. The board grows into the freed space, the stats stay visible, and everything stays playable with the buttons folded away. |

**Tableau rules:** cards stack in descending rank and alternating colour
(e.g. red 7 on black 8). **Foundation rules:** same suit, ascending from Ace.
When only foundation moves remain, the game auto-completes and celebrates.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` or `Ctrl + Y` | Redo |
| `Esc` | Cancel a drag in progress |
| `H` | Hint |
| `N` | New game |
| `T` | Show / hide the toolbar |

---

## How it works

The codebase keeps **game logic**, **rendering**, **animation**, and **input**
cleanly separated, all driven by a single `requestAnimationFrame` loop on one
HiDPI-scaled canvas.

```
src/
  main.ts        bootstrap, HiDPI canvas, game loop, deal / auto-complete / win
  cards.ts       card model, deck construction, Fisher–Yates shuffle
  game.ts        Klondike rules, draw modes, undo, win / auto-complete (pure)
  layout.ts      responsive pile positions, column-offset compression
  positions.ts   shared geometry: hit-testing + animation targets
  render.ts      card body + table drawing, SVG-face compositing
  cardFaces.ts   loads & caches the SVG card faces from public/cards/
  courtArt.ts    procedural J/Q/K + Ace fallback art (used until SVGs decode)
  theme.ts       light / dark felt + placeholder palettes
  animation.ts   tween engine, card flights, win-celebration physics
  input.ts       pointer drag & drop, click-to-draw, double-click auto-move
public/
  cards/         52 card faces (vector-playing-cards, public domain):
                 12 court cards as WebP, 40 pip/ace faces as SVG
art/
  cards-src/     the original court-card SVGs the WebPs are rendered from
scripts/
  rasterize-cards.mjs   one-off court-card rasteriser
```

A few design notes:

- **`game.ts` is framework-free and side-effect-light** — the rules, move
  validation, scoring and undo snapshots are pure, and are unit-tested in
  isolation (`npm test`) along with the card codec, the layout maths and the
  save/load layer.
- **Card faces are images, loaded once and cached.** `cardFaces.ts` loads each
  face from `public/cards/` into an `Image`; the renderer draws it onto a
  rounded white card body (for clean corners + shadow). A procedural face
  (`courtArt.ts` + pip layouts) is drawn as a fallback until it decodes. The
  source art is auto-traced and the court cards were enormous — 7.7 MB for
  twelve — so they ship as 512 px WebP instead, which is indistinguishable at
  play size and cut the card payload from 8.2 MB to 1.1 MB. See
  `art/cards-src/README.md`.
- **Card size is a choice about fan depth, not width.** At ordinary window
  shapes it's the board's *height* that limits how big a card can be, so
  `layout.ts` sizes them to let a typical column — six face-down cards plus a
  four-card run — fan at full spacing, and compresses the offsets of anything
  deeper rather than shrinking every card all game. Width left over goes into the
  gutters so the tableau spreads across the table.
- **Animations decouple model from view.** A move updates the model instantly;
  the `Animator` then flies the affected cards from their old screen positions
  to their new ones, so logic never waits on animation.
- **Everything is DPI-aware** — the canvas backing store is scaled by
  `devicePixelRatio` and all drawing is in CSS pixels.

## Deployment (S3 + CloudFront)

Deployment reuses the pipeline from
[`ruchira088/react-template`](https://github.com/ruchira088/react-template):
GitHub Actions builds the bundle, Ansible uploads it to an artifact S3 bucket,
and **AWS CDK** provisions/updates the hosting infrastructure.

The CDK stack (the shared
[`react-app-cdk-deploy`](https://github.com/ruchira088/react-app-cdk-deploy)
package) creates, per environment:

- a **private S3 bucket** for the static files (read only via a CloudFront OAI),
- a **CloudFront distribution** (HTTPS-only, `index.html` default root, and a
  404→`/index.html` rewrite so the SPA serves correctly),
- an **ACM certificate** (DNS-validated) and a **Route 53 A-record**.

### Pipeline flow (`.github/workflows/build-pipeline.yml`)

```
build-and-typecheck ─▶ upload-bundle ─┬─▶ deploy-to-dev          (feature branches)
                                      └─▶ deploy-to-staging ─▶ deploy-to-production  (main)
                                                                       └─▶ GitHub release
```

| Ref | Environment | URL |
| --- | --- | --- |
| feature branch | dev | `<branch>.solitaire.ruchij.com` |
| `main` | staging → production | `staging.solitaire.ruchij.com` → `solitaire.ruchij.com` |

`upload-bundle` runs `playbooks/s3-upload.yml`, which builds the Vite bundle,
zips `dist/` to `client.zip`, and uploads it to
`solitaire-bundles.ruchij.com/<branch>/<commit>/client.zip`. The deploy jobs then
run the CDK app, which pulls that exact artifact and publishes it.

### Deployment files

```
.github/workflows/build-pipeline.yml   CI/CD pipeline
cdk-deploy/                            CDK app (S3 + CloudFront infra)
  bin/cdk-deploy.ts                    stack name, domain, artifact bucket
playbooks/                             Ansible: build → zip → upload to S3
  s3-upload.yml
  github-release.yml
  tasks/{git-info,install-dependencies}.yml
.nvmrc                                 Node 24
```

### Configuration

The app-specific values live in **`cdk-deploy/bin/cdk-deploy.ts`** (and the
matching bucket name in `playbooks/s3-upload.yml`):

```ts
stackName:      "SolitaireFrontEndStack"
domainName:     "solitaire.ruchij.com"      // must be under ruchij.com
artifactBucket: "solitaire-bundles.ruchij.com"
```

### Prerequisites (on the AWS / GitHub side)

These mirror the template's existing infrastructure and must be in place before
the pipeline can deploy:

- AWS account **365562660444**, artifact bucket + OIDC in **ap-southeast-2**
  (the CloudFront stack itself is created in `us-east-1`, handled by the package).
- A GitHub OIDC IAM role **`arn:aws:iam::365562660444:role/github_iam_role`**
  whose trust policy allows this repository.
- A **Route 53 hosted zone for `ruchij.com`** in the account (CDK looks it up).
- SSM parameter **`/github/token`** (used to cut the GitHub release).
- GitHub **`Staging`** and **`Production`** environments configured on the repo
  ([`ruchira088/solitaire`](https://github.com/ruchira088/solitaire)).

### Manual deploy

With AWS credentials available and the bundle already uploaded (or building
locally), from `cdk-deploy/`:

```bash
npm ci
npm run deploy                 # dev / staging
ENVIRONMENT=production npm run deploy   # production → solitaire.ruchij.com
```

## Tech stack

- **TypeScript 7** (strict mode)
- **HTML5 Canvas 2D** for all rendering
- **Vite 8** for the dev server and production bundling
- **Vitest** for the pure-logic unit tests
- **No runtime dependencies** — the shipped bundle is pure vanilla JS/Canvas, and
  `package.json` has no `dependencies` block at all. Everything installed
  (TypeScript, Vite, Vitest, plus SVGO and `playwright-core` for the one-off card-art
  and screenshot tooling) is build-time only.

## Credits

Card faces are from the
[*vector-playing-cards*](http://code.google.com/p/vector-playing-cards/) project,
released into the **public domain**.

## License

MIT — free to use, modify and share. (Card-face SVGs are public domain; see
Credits.)
