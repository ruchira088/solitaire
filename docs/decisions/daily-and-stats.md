<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# The daily deal, the archive and lifetime statistics

One board per calendar day, a streak about keeping up with *today*, and a lifetime record that nothing routine clears.

- **The archive can't back-fill a streak.** Past dailies are playable from the grid
  in the statistics dialog, and winning one ticks its day and counts in `dailyWins` —
  but the run is only ever about keeping up with *today*, so `recordWin` takes
  `daily: { key, extendsStreak }` and only main.ts decides which case it is. Filling in
  a gap after the fact therefore cannot revive a lapsed streak, which is the whole
  reason the two are separate fields rather than inferred from a date. Which day a
  board belongs to is **derived** (`dailyDayForSeed` searches the last
  `ARCHIVE_WINDOW` day-hashes), keeping the no-new-persisted-state property the daily
  deal started with: a game resumed days later is still the daily it came from.
  `dailyWonDays` is capped at 400 entries because the grid only shows 28 and an
  uncapped list grows forever; `dailyWins` is the uncapped total, so trimming costs no
  counter. The grid lives in the stats dialog rather than behind a new toolbar button
  because it *is* the daily record and the measured wrap threshold has no room.

## The daily deal

One board per calendar day, so a score on it is worth comparing. It needed no new
persisted state, and that's the whole design:

- **A daily *is* an ordinary seeded deal.** `dailySeed(dailyKey(new Date()))` in
  `rng.ts` is the whole mechanism, and `main.ts`'s `isDailyGame()` is
  `game.seed === dailySeed(todayKey())` — derived, never stored. So the save format
  is untouched, a *resumed* game is still recognised as the daily, and Restart and
  the `?deal=` share URL work on it for free.
- **`dailySeed` is a wire format too**, for the same reason `mulberry32` is: it
  decides which board "the daily for 2026-08-10" is, and every streak already
  recorded assumes that answer never changes. Pinned in `rng.test.ts`.
- **The date is hashed, not used as the seed.** Consecutive days differ in one low
  digit; FNV-1a plus an avalanche step means their boards are unrelated without
  relying on the PRNG to do that job.
- **`dailyKey` reads the *local* date.** The deal turns over at the player's own
  midnight rather than in the middle of their afternoon; the cost is that two
  timezones briefly disagree on which deal is today's, which matters far less.
- **The midnight edge is left alone.** A daily won a minute after it stops being
  today's banks as an ordinary win — the harmless direction to fail in, and closing
  it would mean persisting a flag and bumping the save schema.
- **Pressing 📅 while already part-way through today's deal does nothing.** The
  button's job is "put me on today's board", and re-dealing would silently bin the
  progress; New Game and Restart still do that deliberately.
- `syncDailyButton` is called at the four points that can change the button's state —
  boot, a new deal, a win, a stats reset — and not from `updateStats`, which runs on
  every move and would re-read storage each time.

## Lifetime statistics

Lifetime statistics (`solitaire-stats`, schema-versioned like the game save) sit
deliberately outside it, so nothing routine clears them — only the Reset button does.
The shape of the bookkeeping is where the thinking is:

- **A deal becomes a *played* game on its first move** (`recordGameStart` from
  `onChange`), not when it's dealt — otherwise cycling through deals looking for a
  friendly one would tank the win rate. `countedPlayed` in `main.ts` guards the
  counting, not `game.moves`, because undo can take the move count back to 0.
- **`pending` is persisted** so a game left unfinished — including by closing the tab —
  still breaks the streak when the next game starts. `recordAbandon` covers the
  in-session case (New Game or Restart over a game with moves in it) and banks its
  time; the `pending` check in `recordGameStart` covers the across-sessions one.
- **Every field is sanitised on read** and `won` is clamped to `played`, so a
  hand-edited record can't show a win rate over 100%. A 0 for a "best" means *never*,
  which is why the dialog shows a dash rather than 0:00 or 0 moves.
- **`recordWin` returns `{ stats, isRecord }` honestly even when the write fails** —
  the player did just win. Beating the best score is strictly greater, so matching it
  isn't announced as new.
- **`STATS_SCHEMA` is for changes of *meaning*, not for every edit.** A mismatch
  discards the whole lifetime record, which is a real loss — unlike the game save,
  where a discard costs one board. Purely *additive* fields need no bump: every field
  is sanitised independently, so an older record reads its new ones as 0. That is how
  the daily-deal counters landed without wiping anyone's history.
- **The daily streak is stored but read through `currentDailyStreak`.** The stored
  number can't say whether the run is still live, so `lastDailyWin` (a `YYYY-MM-DD`,
  `""` for never) is what makes it answerable: won today or yesterday and the run
  stands, anything older and it reads 0. Deliberately lazy — nothing has to run at
  midnight to expire a streak. `daysBetween` parses at UTC midnight so a 23- or
  25-hour DST day still counts as one day.
- `solitaire-best`, the pre-stats best score, is read once to seed `bestScore` and
  cleared by `resetStats` — otherwise resetting would resurrect the old record.

**Easy mode is not a setting** — it's per-game. Every fresh deal starts with it
off (`applyEasy(false)` in `newGame`, and `false` on a save-less boot); it only
travels with a game through that game's save.

The game in progress (`solitaire-game`) so a refresh resumes the same board:

- `Game.serialize()` / `Game.restore()` are pure; piles are arrays of compact card
  codes (`encodeCard`: the card id, plus 52 when face up). `parseGameState` in
  `game.ts` validates untrusted saves — full-deck, face-state, and foundation
  checks — and anything it rejects is dropped so a fresh deal takes over silently.
- The envelope is schema-versioned (`v`). Bump `SCHEMA` in `storage.ts` when the
  meaning of `GameState` changes; old saves are discarded, never migrated.
- The save exists exactly while there's an in-progress game: `persist()` no-ops
  before the first move and once won, so New Game and winning clear it.
- **Undo/redo history rides along in the save**, capped at `PERSISTED_HISTORY` (40)
  rather than the in-memory `MAX_HISTORY` (200): the save is rewritten on every move,
  so the whole stack would be ~60 KB of JSON per move to buy depth nobody reaches
  after coming back to a game. Snapshots go through the *same* `parseBoardState` as
  the live board — a snapshot is a board the game adopts wholesale on the next Undo,
  so accepting a broken one just moves the corruption one keystroke away — and one bad
  entry drops the whole stack rather than leaving a hole, since undo walks the list in
  order and a gap would silently skip a position. The fields are **optional**, which is
  why this needed no `SCHEMA` bump: an older save is still a perfectly good board and
  resumes with an empty history, exactly as every resumed game used to.
- Elapsed play time rides along, and freezes while the tab is closed.
- The start overlay reads "Resume game" when a save exists and reveals the board
  via `animator.clear()`. It must not call `startDeal()`, which assumes a freshly
  dealt pyramid and would throw on a restored board.
