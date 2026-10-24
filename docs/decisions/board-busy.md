<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# `boardBusy()`, auto-complete and 🏠

One predicate answers "are the cards moving?", and the sweep has a single definition of its order.

- **`boardBusy()` is the one answer to "are the cards moving?"** The opening deal
  (`busy`), the auto-complete sweep (`autoCompleting`) and the win cascade
  (`celebration.active`) all mean the board must not change under them, and every
  action that mutates it in place — undo, redo, + Stack, the solver, the keyboard's
  Space and F, and `Input`'s own gate — asks this rather than picking its own subset.
  That is not tidiness. `doUndo` used to check only `busy` and `celebration.active`, so
  Undo stayed live during auto-complete; the sweep's loop *is* the `onDone` of the
  flight it last launched, `afterTimeTravel`'s `animator.clear()` drops callbacks
  without firing them, and one undo therefore stranded the chain with `autoCompleting`
  latched on — which, through this same predicate, killed every pointer and key for the
  rest of the game. Only New Game recovered it. `updateStats` disables the buttons from
  the same predicate, so nothing looks live while it refuses, and `endAutoComplete` /
  `startCelebration` both re-run it on the way out of the sweep, which is otherwise not
  a board change and would leave them stuck disabled.
  The actions that *replace* the board — New Game, Restart, the daily — deliberately
  don't ask: the win panel offers two of them while the cascade is still running.
  Related: **`Game.autoCompleteSource()` is the single definition of the sweep's
  order.** main.ts drives it a card at a time so it can capture each card's screen
  position *before* the move, and used to mirror the ordering loop to do it — two
  copies with nothing holding them together. Now both ask the same method and only one
  of them then moves; `game.test.ts` pins that what it names is what the next
  `autoCompleteStep` moves.
  **🏠 (`A`) is that same sweep, started early** — `sendAllHome` sets `autoCompleting`
  and calls `autoStep`, so it inherits the order, the `boardBusy()` lock and the
  resize handling rather than growing a second loop. It follows chains (a card freed
  by one going home goes next) and never draws from the stock. What it added is that
  **the sweep now ends through `onChange`** when it moved anything: the end-game sweep
  always finished in a win and never needed to save, but a 🏠 sweep stops mid-game and
  that board must persist, re-check for a dead end and re-seat the cursor. Only when
  `sweepMoves > 0`, since `onChange` schedules `evaluateBoard`, which could otherwise
  restart an empty sweep forever. It replaced the 🔍 verdict button in the toolbar —
  the dead-board warning answers that unasked, and 💡 escalates on demand — so the
  1280 row kept its width; measured there, the row has ~22px spare.
