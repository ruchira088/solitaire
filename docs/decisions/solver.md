<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# The solver, the dead-board warning, hints and winnable deals

"Unwinnable" is a claim shown to a player, so everything here is about only ever saying what the search has proved.

- **The solver keeps its own board, and a test stops the rules drifting.** Searching
  through `Game.undo()` would be tempting — one copy of the rules — but `MAX_HISTORY`
  caps the undo stack at 200, so past that depth an undo pops the wrong snapshot. So
  `solver.ts` has a compact state of its own, and `solver.test.ts` cross-checks its
  move generator against `Game` on real and hand-built positions. That check has
  already earned its place twice: it caught the pruning layer withholding moves
  `game.ts` allows (hence `prune`, and comparing the *complete* set), and its one blind
  spot — `compare()` built no `foundationToTableau` entries on either side — is exactly
  where the empty-column bug hid. **A move class absent from both sides of that
  comparison is unchecked, not agreed.**
  **"Unwinnable" is a claim, so the move set must be complete** — including
  foundation→tableau, and specifically **onto an empty column**: pulling a King back
  off a foundation to open a base is the only way some boards are winnable at all, and
  omitting it made the solver declare such a deal dead. The empty-column dedup that
  goes with it is **per card, not per position** — sharing one flag across suits offers
  only the lowest-numbered foundation an empty column, and if that card is the wrong
  colour for what needs a base the winning line is invisible. Anything a budget cuts short is
  `unknown`, never `unwinnable`. ✦ stacks and easy mode change what a legal move is
  and are not modelled: `canAnalyse` returns false and the UI says so rather than
  answering a different question.
  **There are three budgets, and all three fail to `unknown`.** Nodes is the obvious
  one. `MAX_DEPTH` bounds memory, one move list per level.
  **The search keeps its own stack rather than recursing, and that is not a style
  choice.** Recursing once per move meant a deep enough search threw `RangeError:
  Maximum call stack size exceeded` instead of returning, and the ceiling isn't ours to
  know: a worker's stack is smaller than the main thread's, which is smaller than
  Node's. A depth cap picked to be safe against an unknown stack was in danger of being
  low enough to lose real solutions — the longest winning line measured over 40 deals is
  **559 moves**, and branches run past 2,000 levels at the escalated budget. A version
  capped at 2,000 passed every local check and died in CI's browser. The smoke test now
  asks about a deal that *forces* the escalated pass (`?deal=8`), because the ordinary
  verdict never goes deep enough to notice. `SEEN_CAP` bounds the visited
  set; past it the search stops *remembering* rather than stops searching, which costs
  re-exploration and never an answer. That last one is also why the key stays an exact
  string rather than a hash: two positions colliding would prune an unexplored branch
  and could call a winnable board dead.
  The key is one character per card (`CH`), with separators *below* the card range so a
  card can never be read as one — a column's length isn't otherwise recoverable, and the
  ambiguity would be a collision by another name. It encodes face-down *counts*, which
  is lossless because those cards never move and an empty face-up half over a non-empty
  face-down one can't occur (`flipIfNeeded` turns one up as part of the same move).
  Measured over the same 40 draw-1 deals at 200k: 27 solved, 2 dead, 11 unknown, **71 ms
  average and 253 ms worst** — down from 121/450 before the compact key and before the
  per-node move list stopped being generated twice. More nodes buy very little on their
  own (500k changes nothing at all; 1M resolves one more board), so the UI escalates to
  2M **only when the fast pass says `unknown`**: 29 solved, 3 dead, 8 unknown, and the
  29 boards that answer quickly never pay for it. All of which is why it runs in a
  worker rather than on the frame loop.

- **The dead-board warning runs unasked, and only a proof shows it.** `bumpBoard()` is
  the one place `boardVersion` moves, and it schedules the `DeadCheck` (deadCheck.ts) — so every board
  change (moves, undo/redo, a new deal, the draw toggle, Easy on/off) is checked and a
  path that changes the board without asking can't be written. The check runs the
  **fast pass only** (200k nodes, no escalation, no `wantMove`) on a **worker of its
  own**, so it never fights 💡 for `onmessage` and never greys it out;
  `unknown` and `solved` show nothing, and 💡 still escalates on demand. Dead
  boards are the cheap case — nowhere to go means a tiny reachable space — so the check
  costs least when it has something to say. Its lifetime is deliberately *not* the hint
  arrow's: a hint is about cards that move, the warning about a state that usually
  survives a move, so it stays up until the *next* verdict says otherwise rather than
  dropping on the bump (which flickered), and dead → dead is silent — no re-animate, no
  re-announce. A check that is *skipped* (won, or `canAnalyse` false) takes the warning
  down: Easy mode and a ✦ stack are two of the rescues the message offers, and taking
  one retires a claim made under the old rules. A timed toast (a 💡 answer) borrows the
  element and `settleToast` hands it back. The bookkeeping — one search at a time, a
  stale answer dropped, dead → dead silent, a skipped check taking the warning down —
  is `DeadCheck`'s, tested against a fake solver in `deadCheck.test.ts`; main.ts keeps
  only the worker and the toast. The wording is shared with 💡's dead
  answers through `RESCUES`, and `npm run smoke` loads `?deal=R` — dead from the first
  card, proven in ~2.5k nodes — to see the warning arrive unprompted and leave on Easy.

- **A hint is the first move of a line that wins, or it is nothing.** `solve` already
  computed the whole line; the worker sends `moves[0]` through `toGameMove` and drops
  the rest, because a full walkthrough is a different feature and copying a few hundred
  moves nothing reads is pure cost. On `unwinnable` or `unknown` the button says so
  instead of falling back to a plausible-looking move: the removed `findHint` was that,
  and the greedy player built on it can't win a game (40 of 52 cards home over 200
  seeds). A guess dressed as a hint would cost the feature the one thing it has.
  `toGameMove` resolves foundations by asking which pile *accepts* the card, since the
  search tracks them per suit while the game's four piles aren't suit-locked, and it
  returns null rather than pointing at a pile that isn't there.

- **A winnable deal is screened, not generated.** `newWinnableGame` shuffles and asks
  the solver until one comes back `solved`, at the fast budget with no escalation — an
  `unknown` isn't a board to reject on its merits, it's one we can't vouch for, and
  reshuffling is cheaper than thinking harder about it. Candidates are tested at the
  *current* draw count, because a board winnable at Draw 1 needn't be at Draw 3. About
  two thirds pass, so it almost always ends on the first or second try; `WINNABLE_TRIES`
  is a ceiling for when something has gone wrong, and a search that comes up empty
  leaves the board alone rather than costing the player the game they were in.

- **"Show a solution" replays a line from the *deal*, and nothing it does counts.** The
  dead-board warning (and 💡's dead answer) offers it through the toast's one action
  button. It solves the *opening* position — this one is dead, which is why the offer
  was made — under the rules the solver models (so `game.vegas` is forced off for the
  replay), asks the worker for the whole line with `wantLine` (the one asker that reads
  past `moves[0]`; `toGameLine` walks it through a real `Game` and returns null rather
  than a line the rules refuse), re-deals through `beginGame` (abandoning the game in
  progress, as Restart would) and hands the line to `Replay`. `Replay` only paces: it
  waits on `settled` rather than a fixed delay, so no move is ever made under a flight
  still landing. Each move goes through `playMove` / `input.drawStock`, the paths a
  player's take.
  `demoGame` is what keeps it out of the record: no `recordGameStart`, no `persist`, no
  `recordWin`, no Vegas settlement, and `evaluateBoard`
  starts no auto-complete sweep under it (the sweep would take the cards the line's
  next moves are about). `boardBusy()` includes `replay.active`, so nothing else moves
  the board meanwhile. Escape stops it and re-deals the same board fresh — the board
  the solver advanced is not one the player should be able to finish and bank. The
  smoke test runs it on deal R's dead position under seed 33 (deal X), which the fast
  pass solves at once: `parseGameState` doesn't tie a board to its seed.
