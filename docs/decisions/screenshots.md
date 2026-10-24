<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# The README screenshots

`npm run screenshots` regenerates them; this is what has gone wrong with that script before.

`screenshots/*.png` come from `npm run screenshots`
(`scripts/shoot-screenshots.mjs`). Nothing in CI touches them and the output is
committed. The script starts its own Vite server on a free port, so nothing needs to
be running first and it can't collide with `npm run dev`; `ONLY=win,stats npm run
screenshots` reshoots a subset.

**Any change to the toolbar dates every board shot at once** — a button added or
removed shows up in all six. Run the script; don't patch a single image.

Each shot keeps the pixel size it has always had: 1280×820 for `gameplay`,
`gameplay-light` and `spare-pile`, 1280×706 for `win`, 1000×700 for `stats`,
`toolbar-hidden` (narrow enough that the ☰ is offered) and `challenge`, and 390×844 at
DPR 2 for `iphone`. `cards.png` is card art from `cards:rasterize` and is not touched here.

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
- **`challenge.png` is the one shot of the start overlay**, so it injects no save and
  never dismisses it — a `?win=` link is the whole setup. It shares the win board's
  seed and quotes the score `win.png` finishes on (the `WIN_*` constants), so the two
  images are one game seen from both ends. Its `.start-title` is asserted for the same
  reason the resume assertion exists: a rejected `win=` would quietly photograph the
  ordinary start screen.
- **`win.png` is the one board assembled rather than played.** The script's greedy
  player — which stands in for the removed `findHint` — can't win a game; over 200
  seeds its best is 40 of 52 cards home. So that board is built directly, asserted
  against `parseGameState`, and handed to the app's own auto-complete to finish and
  set the cascade going. It is also the one shot that never reproduces byte-for-byte,
  since the cascade is `Math.random()` physics sampled on a wall-clock delay; the
  other six do.
