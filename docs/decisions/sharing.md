<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Sharing a win, and the challenge link

A shared result is a link back to the same deal with three numbers attached.

- **A shared win links back with its result attached, and the address bar never keeps
  it.** The Share button copies `?deal=…&win=<score>-<moves>-<seconds>`, and a boot
  that parses a `win=` shows the sender's result and the board it was scored on above
  a "Can you beat 527?" button, instead of the ordinary click-to-play — a link that
  dropped someone straight into a deal would be indistinguishable from any other deal
  link, and the score is the whole invitation. Three numbers is the entire payload:
  the seed is already in `deal=`, and **whether the board was a daily is derived from
  that seed** (`dailyDayForSeed`), so nothing is carried twice and no save format
  changes. The draw mode is named on the card because the same cards under Draw 3 are
  a different game, and a score only compares within one.
  Two things keep it honest. `parseResult` treats the payload as untrusted — it comes
  off a URL anyone can edit — and anything that isn't three plain in-range integers
  falls back to the normal start screen rather than putting a nonsense score on it.
  And `dealUrl()`, which is what `syncDealUrl()` writes and what every other share is
  built from, **deletes `win`**: it is someone else's result, and leaving it in the
  address would make a mid-game reload re-open a stale challenge over the player's own
  board. `shareUrl()` is the one caller that adds it back.
  Resume still wins the button when the recipient already has that deal on the go —
  re-dealing would bin their progress — but the card stays up, since it is still what
  there is to beat. Declining is `"fresh"`, which deals a new seed; the three start
  choices are a union rather than a pair of booleans because "reveal the board behind
  the overlay" and "throw it away for a new one" used to be the same `else`.
