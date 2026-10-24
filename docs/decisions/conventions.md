<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Conventions, in full

The short versions are in CLAUDE.md.

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
- **Tooltips are `data-tip`, never `title`.** `tooltip.ts` draws one shared
  `#tooltip` for every `[data-tip]` trigger, and a `title` left on a button puts the
  browser's grey box up beside it — `npm run smoke` checks none remain. Dynamic text
  goes through `setTip`, so no caller reaches for `.title`. A trailing `(T)` /
  `(Ctrl+Z)` is drawn as a `<kbd>` chip; `parseTip` only takes a shortcut at the very
  end that looks like one, so a date or prose aside in parentheses stays text. It
  shows on mouse/pen hover (after a delay, instant while one is already up) and on
  `:focus-visible`, never on touch — a tap has no hover to end, so it would stick.
  The element is a sibling of `#app`, positioned `fixed`, so it floats over the
  modal stats dialog and clamps to the viewport with the arrow still tracking the
  trigger. Icon-only buttons keep their `aria-label`; the tip is `aria-describedby`.
- **Only the pip faces are preloaded.** `preloadCardFaces` fetches the 40 pip/ace
  SVGs (~150 KB) up front and warms the 12 court WebPs (~850 KB) on idle, so they
  stay off the critical path. A court card needed before then loads on demand from
  the render loop, with `courtArt.ts`'s procedural face covering the gap — so
  `getCardFace` returning null is a normal state, not an error.
