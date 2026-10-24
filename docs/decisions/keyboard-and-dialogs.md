<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Keyboard play and the two dialogs

The board is playable without a pointer, and the stats dialog is modal in fact rather than only in its ARIA. Key precedence now lives in `keyboard.ts` (`keyCommand`, tested), the modality in `statsDialog.ts`.

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

- **Two dialogs, two behaviours.** The win panel is *not* modal — no backdrop, wrapper
  `pointer-events: none` — because the cascade is the reward. The stats dialog
  (`#stats-overlay`) is: it dims the board, and a backdrop click or Escape closes it.
  Escape is checked in the keydown handler *before* the drag cancel.
  Its `aria-modal="true"` is **enforced, not merely claimed**, in two places that both
  had to be added: `keyCommand` (keyboard.ts) answers nothing but Escape while
  `modalOpen` is set, so *no* board shortcut fires through it — `boardHasKeys` gates
  only the arrows, Space, F and the digits, so `n` behind an open dialog used to deal a
  new game and leave the panel sitting over it reporting the record it had just
  abandoned — and `StatsDialog.open` (statsDialog.ts) marks `#app` inert while it is up, since Tab otherwise walks straight out of the panel into
  the toolbar, and inert also takes the board out of the accessibility tree. That is
  why `#stats-overlay` is a **sibling of `#app`** rather than inside it: one line
  inerts everything behind the dialog. Both are checked by `npm run smoke`.
  The two panels share the card look, the `.dialog-actions` row, and the re-declared
  dark palette.
