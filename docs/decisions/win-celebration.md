<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# The win cascade and the win dialog

The cascade is the reward, so the dialog over it is deliberately not modal.

- **The cascade is three effects at once, and the canvas is never cleared.** Cards
  launch **one at a time** (`LAUNCH_EVERY`) rather than all together, so the screen
  fills in a rhythm; they **tumble** (`angle`/`spin`, drawn via `drawCard`'s `angle`),
  so a wall of parallel rectangles never forms; and fireworks keep bursting behind
  them. Because `runCelebrationFrame` paints without clearing, *everything* leaves a
  trail — that is what makes sparks read as streaks, and it is the iconic look, so
  don't "fix" it. The extras are gated on `prefers-reduced-motion` directly rather
  than on `animationsOn`: the latter is also set by `?animate=off` for deterministic
  screenshots, and the win shot is the one place the flourish should be captured.
  `playFanfare` is the only sound in `sound.ts` built from oscillators instead of
  filtered noise — everything else is a card moving, and a win is the one moment that
  earns a pitch.

- **The win dialog is DOM, not canvas.** `#win-overlay` / `#win-panel` in
  `index.html` replaced a banner painted into the canvas, so New Game and Restart are
  real buttons — focusable, keyboard-reachable, styled by the same `.btn` rules. Three
  things it has to get right: the wrapper is `pointer-events: none` so the cascade
  keeps running and the toolbar stays clickable; it centres inside the *board* via
  `--bar-h` (which `Preferences.syncBarHeight` publishes) because a viewport-centred panel sits on
  the toolbar on a short landscape phone; and the panel re-declares the dark palette
  (`--text`, `--btn-bg-*`) since it stays dark in both themes and light-theme buttons
  would otherwise be dark-on-dark. It opens from `startCelebration` and closes in
  `beginGame`, so it can't outlive its game.
