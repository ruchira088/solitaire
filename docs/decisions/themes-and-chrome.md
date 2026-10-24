<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Themes, highlights and the toolbar

What the theme registry owns, how the three on-board highlights stay distinguishable, and why the toolbar folds the way it does.

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

- **The ☰ toggle only exists when the bar wraps.** `Preferences.updateChromeToggle` (preferences.ts) measures
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

- **"Auto" is a preference, not a theme.** It has no felt of its own; `resolveTheme`
  turns it into Bright or Midnight from `prefers-color-scheme`, and the renderer and the
  CSS only ever see a concrete `ThemeName`. Keeping it out of `THEMES` is what keeps
  `ThemeName` meaning "something that can be painted". It is the default for anyone who
  has never chosen, it is first in the button's cycle, and `Preferences` watches the
  media query so it follows an OS change live, the same way reduced motion is watched.
  An unrecognised saved or `?theme=` value now falls back to Auto. Two consequences
  worth knowing: headless Chrome reports a light scheme, so `shoot-screenshots.mjs`
  pins `colorScheme: "dark"` to keep every unthemed shot what it has always been; and
  the button shows 🌓 rather than a theme's icon while on Auto.
