<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Layout: card size and the portrait board

Two decisions that look like tuning and are really about what the board is for.

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
  row — and gives the tableau rows the full height, one slot each. The rail is the one
  thing on the board with a handedness: it holds the stock, which is the pile you tap
  over and over, and the hand holding a phone covers the side it's on — so `leftHanded`
  mirrors the x coordinates. It must move the **fan limit** with the rail, not just the
  piles, or the rows fan out underneath it. The landscape board takes the flag and
  ignores it: a top row is not something a thumb reaches across, and the test asserts
  the two layouts come out identical. The ☰-adjacent 🤚 button is shown only while
  `body.portrait-board` is set, so it costs the desktop toolbar no width at all. A header above
  the rows would divide the height one more way (shrinking every card ~18%) and
  leave a void in the rail beside the top rows. Consequences to keep: the waste sits
  `COUNTER_GAP` below the stock so `drawStockCounter` has room; `wasteFan` runs
  *down* the rail, since fanning right would cross the rows; the row fan steps are
  their own constants (`ROW_FACE_*`), because a fraction of the card's *width*
  reveals less than the same fraction of its height; and width-bound boards spread
  leftover height into the row gaps up to `MAX_ROW_GAP`, then centre the rest.
