<!-- CLAUDE.md keeps a one-line rule pointing here. This is the reasoning behind it:
     read it before changing what the rule protects. -->

# Vegas rules

$52 to deal, $5 for every card on a foundation, and a limited number of passes
through the stock: none at Draw 1 (one pass), two recycles at Draw 3 (three passes).
Results add up across games in a bank.

- **The game's dollars are derived, not kept.** `Game.vegasDollars()` is
  `5 × cards home − 52`, computed from the board. Undo, a resumed save and a card
  pulled back down from a foundation therefore all agree with it without any
  bookkeeping of their own — the same reason `isDailyGame()` is derived from the seed.
- **The pass limit is `recycles`, and it rides in every undo snapshot.** Taking back a
  recycle gives the pass back, and a refused recycle is refused *before*
  `pushHistory`, like the empty-stock guard — otherwise a click on a spent stock would
  clear the redo stack. `vegas` and `recycles` are **optional** in `GameState` and
  `SnapshotState`, read as off / 0 when absent, so older saves needed no `SCHEMA` bump.
- **The ordinary score is still kept underneath.** Vegas changes what the toolbar shows
  (the money takes the score's slot — there is no width for a fourth stat), not what
  `recordWin` banks for the best-score record, so a Vegas win and an ordinary one stay
  comparable on that line.
- **A Vegas game settles into the bank once, when it ends, and only if it was
  played.** On the win (`startCelebration`), or on walking away (`beginGame`, under the
  same `countedPlayed && !won` condition as `recordAbandon`) — so a deal passed over
  without a move costs nothing, matching the rule that keeps it out of `played`, and
  a won game, which `beginGame` sees as won, can't settle twice. `vegasBank` is the one
  stat that may be negative, so it has its own sanitiser (`signed`).
- **The switch is a preference for the *next* deal, and changes this one only before
  the first move.** `vegasNext` is saved (`solitaire-vegas`); `game.vegas` is the rule
  the board in play is under. Turning the limit off mid-game would be a way to buy
  passes, so `toggleVegas` only touches `game.vegas` while `moves === 0`, and it flips
  what is *shown* (`vegasShown`), not the stored preference — on a `?vegas=1` link the
  two differ, and the switch has to turn off the rules the player can see are on. For
  the same reason the draw toggle is refused mid-game under Vegas: the draw count sets
  the pass limit.
- **Vegas is part of what a link means.** `dealUrl` writes `vegas=1` (absent when off,
  like Draw 1), and `boardLine` names it. A link names its rules; only an unnamed fresh
  boot falls back to the preference.
- **The solver doesn't model the pass limit, so it doesn't answer.** `canAnalyse` is
  false under Vegas — a search that recycles freely could call a dead board winnable —
  which takes down the dead-board warning and makes 💡 say why. 🎲 refuses while the
  next deal would be Vegas, since its "winnable" would be about a different game.
- **The switch lives in the stats dialog**, beside the bank it feeds, with `V` as its
  key: the toolbar's measured 1280px row has no room for another button.
