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
  waste recycling, undo history, hints, scoring, move counter and timer.
- 🌗 **Light & dark themes** — a toolbar toggle switches the felt and chrome
  between a bright table and a deep, low-light one; your choice is remembered.
- 🖱️ **Mouse & touch** — drag-and-drop, click-to-draw, and double-click /
  double-tap to auto-send a card to its foundation.
- 📐 **Responsive** — the board re-lays out to fit any window size, compressing
  tall columns automatically.

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

## Win celebration

Finish a game — or let the **auto-complete** finish it for you — and the cards
cascade and bounce across the table in the classic Solitaire victory animation:

![Win celebration](screenshots/win.png)

---

## Getting started

Requires **Node 20.19+ or 22.12+** (Vite 8).

```bash
npm install      # install dev dependencies (Vite + TypeScript)
npm run dev      # start the dev server with hot reload (opens the browser)
```

Production build & preview:

```bash
npm run build    # type-check + bundle to dist/  (~13 kB gzipped)
npm run preview  # serve the production build locally
```

## How to play

The goal is to build all four foundations up from Ace to King, one per suit.

| Action | How |
| --- | --- |
| **Draw from stock** | Click the stock pile (top-left). Toggle **Draw 1 / Draw 3** in the toolbar. When the stock is empty, click it again to recycle the waste. |
| **Move a card / run** | Drag a card — or a valid descending, alternating-colour run — between tableau columns. Empty columns accept a King. |
| **Send to a foundation** | Drag an Ace (or the next card in sequence) onto a foundation, or **double-click** (double-tap on touch) a card to auto-send it. |
| **Undo** | The **Undo** button, or `Ctrl/Cmd + Z`. |
| **Hint** | The **Hint** button (or `H`) pulses a useful move. |
| **New game** | The **New Game** button, or `N`. |

**Tableau rules:** cards stack in descending rank and alternating colour
(e.g. red 7 on black 8). **Foundation rules:** same suit, ascending from Ace.
When only foundation moves remain, the game auto-completes and celebrates.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl/Cmd + Z` | Undo |
| `H` | Hint |
| `N` | New game |

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
  cards/         52 SVG card faces (vector-playing-cards, public domain)
```

A few design notes:

- **`game.ts` is framework-free and side-effect-light** — the rules, move
  validation, scoring and undo snapshots are pure and could be unit-tested in
  isolation.
- **Card faces are SVG images, loaded once and cached.** `cardFaces.ts` loads
  each face from `public/cards/` into an `Image`; the renderer draws it onto a
  rounded white card body (for clean corners + shadow). A procedural face
  (`courtArt.ts` + pip layouts) is drawn as a fallback until the SVG decodes.
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
- GitHub **`Staging`** and **`Production`** environments configured on the repo.
- The repo pushed to GitHub (this project is not yet a git repo) and the
  `npm run typecheck` / `npm run build` scripts present (they are).

### Manual deploy

With AWS credentials available and the bundle already uploaded (or building
locally), from `cdk-deploy/`:

```bash
npm ci
npm run deploy                 # dev / staging
ENVIRONMENT=production npm run deploy   # production → solitaire.ruchij.com
```

## Tech stack

- **TypeScript** (strict mode)
- **HTML5 Canvas 2D** for all rendering
- **Vite** for the dev server and production bundling
- **No runtime dependencies** — the shipped bundle is pure vanilla JS/Canvas

## Credits

Card faces are from the
[*vector-playing-cards*](http://code.google.com/p/vector-playing-cards/) project,
released into the **public domain**.

## License

MIT — free to use, modify and share. (Card-face SVGs are public domain; see
Credits.)
