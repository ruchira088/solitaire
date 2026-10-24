<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# The game save and seeded deals

A refresh resumes the same board; a deal code reproduces it anywhere.

## Settings and the game save

All access goes through `src/storage.ts` and is best-effort — storage can be
absent or full, in which case the game just runs without it.

Settings: theme (`solitaire-theme`), sound (`solitaire-sound`), whether the
toolbar is folded away (`solitaire-chrome`), and which edge the portrait rail sits on
(`solitaire-hand`) — a preference rather than a per-game setting, since which hand
holds the phone doesn't change between deals. Theme also accepts
`?theme=<name>` for any theme in the registry (anything else falls back to dark, so an old saved value or a hand-typed one can't break a boot); animations can be disabled with `?animate=off` (also off
under `prefers-reduced-motion`). A specific layout can be requested with
`?deal=<code>` and `?draw=1|3` — though `draw=1` is only ever *read*, never written:
it's the default, so `dealUrl()` emits `draw` for Draw 3 alone and strips it
otherwise. `?win=<score>-<moves>-<seconds>` turns the boot into the
challenge screen (see the shared-win invariant above); it is only ever read, never
written to the address bar.

## Seeded deals

Every game carries a 32-bit `seed`, so Restart and the shareable deal code are always
available with no special state. The board deliberately doesn't display the code —
the URL is the shareable artefact, kept current by `syncDealUrl()`. `deal(seed?)`
defaults to a fresh random seed; `restartDeal()` replays the current one.

**`rng.ts` plus the shuffle loop in `cards.ts` is a wire format.** Deal codes get
shared, bookmarked and pasted into URLs, so changing the generator, the loop, or the
`SUITS` order silently reinterprets every code already out there. `rng.test.ts` pins
the first values of the stream for exactly this reason.

Boot rule: a saved game resumes unless `?deal=` names a *different* layout, so
reloading a shared link mid-game keeps your board instead of wiping it. The current
code is kept in the address bar via `replaceState` — on every deal *and* when the
draw toggle changes, since the mode is part of what a shared link means — which also
makes screenshots reproducible: `?deal=N&animate=off` is fully deterministic.

Note `parseGameState` deliberately does **not** check that the seed actually deals
the saved board; verifying would mean re-running the deal on every load, and the
only consequence of a mismatch is that Restart lays out a different game.
