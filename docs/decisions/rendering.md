<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Rendering, the paint gate and resizing

How the one canvas is kept correct and cheap: what triggers a paint, how in-flight cards are hidden, and the single path every size change goes through.

- **The board is painted only when it changes.** Solitaire spends most of its life
  as a static picture while the player thinks, and repainting it at 120 Hz to produce
  an identical frame is pure battery — measured at ~750 card-face `drawImage` calls a
  second on an idle board before this. `frame` paints when `dirty` is set, while the
  animator is running, while a drag is live, or during the celebration; `invalidate()`
  sets the flag. **Anything that changes what the canvas should show must call it** —
  a missed one leaves a stale board, which is far worse than the frames it saves. Two
  were missed first time round and are worth knowing about, because neither is a
  *move*: switching the draw mode changes how the waste fans, and **releasing a press
  repaints even when nothing happened** — a press that never became a drag has already
  been painted lifted and offset, so `pointerup`/`pointercancel` on the canvas
  invalidate unconditionally.
  Three subtleties: `wasAnimating` is read *before* `animator.update()`, because the
  frame that finishes the last flight still has to paint or the card never appears at
  rest; the `pendingCheck` sweep sits outside the paint gate, since a win has to be
  noticed precisely when the board is idle; and `cardFaces.ts` gained
  `onCardFaceLoad` because a court WebP decoding after the board settles is a change
  with no other trigger — without it a late face would never replace the procedural
  fallback. `rAF` itself keeps running (an empty callback is nearly free); stopping it
  outright would save a little more and risk a frozen board for it.
  The toolbar clock sits *outside* the paint gate — it's DOM, not canvas — but obeys
  the same principle: `formatClock` is m:ss, so at 120 Hz all but one frame a second
  recomputes the string already on screen, and assigning `textContent` replaces the
  node whether or not the text changed. `showClock` compares first, and is the only
  writer, so the three places that set the clock can't diverge on that.

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
