// Bootstrap: canvas + HiDPI scaling, the game loop, the deal / auto-complete /
// win animations, and the toolbar wiring. The parts with rules of their own live
// beside it — key precedence in keyboard.ts, the dead-board warning's lifetime in
// deadCheck.ts — and the two DOM panels that are self-contained in statsDialog.ts and
// startOverlay.ts.

import "./styles.css";
import { Card } from "./cards";
import { DrawCount, Game, MAX_SPARES, PileId } from "./game";
import { computeLayout, Layout } from "./layout";
import { Animator, Celebration, Easings } from "./animation";
import { CursorView, Renderer } from "./render";
import { Input } from "./input";
import { cardPos } from "./positions";
import { preloadFaceArt } from "./courtArt";
import { onCardFaceLoad, preloadCardFaces } from "./cardFaces";
import { initTooltips, setTip } from "./tooltip";
import {
  playDeal,
  playDraw,
  playFanfare,
  playFlip,
  playPlace,
  unlockAudio,
} from "./sound";
import {
  clearGame,
  currentDailyStreak,
  loadGame,
  loadStats,
  recordAbandon,
  recordGameStart,
  recordWin,
  saveGame,
  Stats,
} from "./storage";
import {
  dailyDayForSeed,
  dailyKey,
  dailySeed,
  encodeSeed,
  parseSeed,
  randomSeed,
} from "./rng";
import {
  boardLine,
  DealLink,
  dealUrl,
  formatClock,
  parseResult,
  shareText,
  SharedResult,
  shareUrl,
} from "./share";
import { canAnalyse, GameMove, Outcome } from "./solver";
import type { SolveRequest, SolveResponse } from "./solver.worker";
import {
  clampCursor,
  Cursor,
  cardName,
  describe as describeCursor,
  describeHint,
  describeMove,
  Move as CursorMove,
  moveCursor,
  pileName,
  runName,
  samePile,
} from "./cursor";
import { Command, keyCommand } from "./keyboard";
import { DeadCheck } from "./deadCheck";
import { ARCHIVE_WINDOW, StatsDialog } from "./statsDialog";
import { WinPanel } from "./winPanel";
import { Preferences } from "./preferences";
import { StartChoice, StartOverlay } from "./startOverlay";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const game = new Game(1);
const animator = new Animator();
const renderer = new Renderer();
const celebration = new Celebration();

// Deal/flip animations can be disabled via ?animate=off or the OS
// "reduce motion" setting (also handy for deterministic screenshots). The media
// query is watched rather than read once, so toggling the OS setting takes effect
// without a reload.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const animateParam = new URLSearchParams(location.search).get("animate") !== "off";
let animationsOn = animateParam && !reduceMotion.matches;
reduceMotion.addEventListener("change", (e) => {
  animationsOn = animateParam && !e.matches;
});

let layout: Layout = computeLayout(1, 1);
let dpr = 1;
let busy = false; // block input during the deal & celebration
let pendingCheck = false; // re-evaluate win / auto-complete once idle
let autoCompleting = false;
let sweepMoves = 0; // cards the current sweep has sent home, so its end knows to save
let timerStart: number | null = null;
let elapsedFrozen = 0;
let celebStarted = false;
let started = false; // the start overlay has been dismissed
/** Set when a game is won: the lifetime stats to show on the win panel, and whether
 *  this game beat the best score. Null until then. */
let winRecord: { stats: Stats; isRecord: boolean } | null = null;
/** This deal has been counted in `played`. Undo can take the move count back to 0, so
 *  the flag — not `game.moves` — is what stops a game being counted twice. */
let countedPlayed = false;
/** The board needs repainting. Solitaire spends most of its life as a completely
 *  static picture while the player thinks, and redrawing it 120 times a second to
 *  produce an identical frame is pure battery. So the loop paints only when something
 *  can have changed — see `frame`. Starts true for the first paint. */
let dirty = true;

// ---- Keyboard play ---------------------------------------------------------
/** Where the keyboard cursor sits, and what it has lifted. Null until the first
 *  cursor key: a mouse player should never see a cursor they didn't ask for. */
let cursor: Cursor | null = null;
let held: Cursor | null = null;
/** Cleared on any pointer press, so picking the mouse back up puts the ring away. */
let keyboardActive = false;

// ---- DPI-aware sizing ------------------------------------------------------

// Each live temp stack adds an extra board column right of the tableau.
let sparesShown = 0;

/** Trailing debounce for size changes. A window drag fires a resize per frame, and a
 *  phone rotation reports its new dimensions in several steps — each event restarts
 *  the timer, so the board is rebuilt once, after things settle. */
const RESIZE_DEBOUNCE_MS = 120;
let resizeTimer = 0;
let appliedW = 0;
let appliedH = 0;

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sparesShown = game.spares.length;
  layout = computeLayout(rect.width, rect.height, sparesShown, prefs.leftHanded);
  // The rail-side toggle only means something on the portrait board, and this is the
  // one place that knows which layout was actually chosen.
  document.body.classList.toggle("portrait-board", layout.fanX);
  appliedW = rect.width;
  appliedH = rect.height;
  invalidate();
}

function scheduleResize(): void {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(applyResize, RESIZE_DEBOUNCE_MS);
}

/** Rebuild the board for a new window size. Cheap to call spuriously: several signals
 *  feed it and most of them report a size that hasn't actually changed. */
function applyResize(): void {
  const rect = canvas.getBoundingClientRect();
  const sameDpr = dpr === Math.min(window.devicePixelRatio || 1, 3);
  if (sameDpr && Math.abs(rect.width - appliedW) < 0.5 && Math.abs(rect.height - appliedH) < 0.5) {
    return;
  }
  resize();
  refreshAfterResize();
}

/** Drop everything anchored to the old geometry, so the new board is drawn from the
 *  model rather than half-inherited from the old one. */
function refreshAfterResize(): void {
  input.cancelDrag(); // its offsets and snap-back targets are in old-layout space
  celebStarted = false; // resizing the canvas cleared the celebration's base frame
  invalidate();

  // Before the overlay is dismissed, the animator is holding the board hidden
  // (hideCards); clearing it would reveal a dealt board through the overlay.
  if (!started) return;

  // Flights aim at old positions, and the callbacks that would have released `busy`
  // (the deal) or driven the next step (auto-complete) live in the animator — so
  // dropping them means owning what they were going to do.
  animator.clear();
  busy = false;
  if (autoCompleting) {
    endAutoComplete();
    pendingCheck = true; // the end-game sweep picks itself back up against the new layout
  }
  updateStats();
}

function syncSpareLayout(): void {
  // Deliberately synchronous, unlike the debounced path: callers compute a flight
  // target from the new layout on the very next line.
  if (game.spares.length !== sparesShown) resize();
}

/** Every card sitting on the board. The stock is excluded — it draws as a face-down
 *  pile, exactly as it does under the overlay before a fresh deal. */
function boardCardIds(): number[] {
  return [
    ...game.tableau.flat(),
    ...game.waste,
    ...game.foundations.flat(),
    ...game.spares.flat(),
  ].map((c) => c.id);
}

const ro = new ResizeObserver(scheduleResize);
ro.observe(canvas);

// ---- Toolbar / stats -------------------------------------------------------

const el = {
  newGame: document.getElementById("btn-new") as HTMLButtonElement,
  undo: document.getElementById("btn-undo") as HTMLButtonElement,
  redo: document.getElementById("btn-redo") as HTMLButtonElement,
  drawToggle: document.getElementById("draw-toggle") as HTMLElement,
  easy: document.getElementById("btn-easy") as HTMLButtonElement,
  addStack: document.getElementById("btn-add-stack") as HTMLButtonElement,
  home: document.getElementById("btn-home") as HTMLButtonElement,
  time: document.getElementById("stat-time") as HTMLElement,
  moves: document.getElementById("stat-moves") as HTMLElement,
  score: document.getElementById("stat-score") as HTMLElement,
  restart: document.getElementById("btn-restart") as HTMLButtonElement,
  hint: document.getElementById("btn-hint") as HTMLButtonElement,
  winnable: document.getElementById("btn-winnable") as HTMLButtonElement,
  daily: document.getElementById("btn-daily") as HTMLButtonElement,
  toast: document.getElementById("toast") as HTMLElement,
};

const prefs = new Preferences({
  repaint: invalidate,
  handChanged: () => {
    resize(); // the piles move; the board is rebuilt from the new layout
    input.cancelDrag(); // its offsets were measured against the old side
  },
});

/** The cards are moving under their own steam and the board must not be changed out
 *  from under them: the opening deal, the auto-complete sweep, or the win cascade.
 *
 *  Every action that mutates the board in place asks *this*, rather than each picking
 *  its own subset of the three flags — which is how the bug this replaced happened.
 *  `doUndo` checked only `busy` and `celebration.active`, so Undo stayed live during
 *  auto-complete; `afterTimeTravel`'s `animator.clear()` then dropped the flight whose
 *  `onDone` *is* the sweep's loop, leaving `autoCompleting` latched on for good and,
 *  through this very predicate, every pointer and key dead for the rest of the game.
 *
 *  Note the actions that replace the board outright — New Game, Restart, the daily —
 *  deliberately don't ask: the win panel offers two of them while the cascade is still
 *  running, and starting a new game is always allowed to interrupt. */
function boardBusy(): boolean {
  return busy || celebration.active || autoCompleting;
}

/** The toolbar clock, written only when it actually changes. */
function showClock(text: string): void {
  if (el.time.textContent !== text) el.time.textContent = text;
}

function updateStats(): void {
  el.moves.textContent = String(game.moves);
  el.score.textContent = String(game.score);
  // Disabled, not merely ignored: a button that looks live and does nothing is how a
  // player finds the guard in the first place.
  el.undo.disabled = !game.canUndo() || boardBusy();
  el.redo.disabled = !game.canRedo() || boardBusy();
  el.addStack.disabled = boardBusy() || game.spares.length >= MAX_SPARES;
  el.home.disabled = boardBusy() || !game.autoCompleteSource();
}

// ---- Game loop -------------------------------------------------------------

/** Mark the board as needing a repaint. Anything that changes what the canvas should
 *  show has to call this — a missed one leaves a stale board, which is a worse bug
 *  than the wasted frames this avoids. Things that animate (flights, a live drag, the
 *  celebration) don't need it: `frame` keeps painting while they run. */
function invalidate(): void {
  dirty = true;
}

function frame(now: number): void {
  // Read before update(): the frame that *finishes* the last flight still has to
  // paint, or the card never appears at rest where the flight left it.
  const wasAnimating = animator.isAnimating();
  animator.update(now);

  if (celebration.active) {
    runCelebrationFrame();
  } else {
    input.updateDropTarget();
    if (dirty || wasAnimating || animator.isAnimating() || input.drag) {
      renderer.drawScene(ctx, game, layout, animator, input.drag, cursorView(), hintView());
      dirty = false;
    }
    // Outside the paint gate on purpose: the win and auto-complete sweep have to be
    // noticed on an idle board, which is exactly when nothing is being painted.
    if (pendingCheck && !animator.isAnimating() && !input.drag) {
      pendingCheck = false;
      evaluateBoard();
    }
  }

  // Live timer. `formatClock` is m:ss, so at 120 Hz all but one frame a second
  // recomputes the string it already shows — and writing textContent replaces the
  // node whether or not the text changed, which is precisely the idle work the paint
  // gate above exists to avoid. Compare first; the clock still ticks every second.
  if (timerStart !== null && !game.isWon()) {
    showClock(formatClock(elapsedFrozen + (now - timerStart)));
  }

  requestAnimationFrame(frame);
}

// ---- Board evaluation (win / auto-complete) --------------------------------

function evaluateBoard(): void {
  if (game.isWon()) {
    startCelebration();
  } else if (game.canAutoComplete() && !autoCompleting) {
    autoCompleting = true;
    autoStep();
  }
}

/** Leave the sweep. `updateStats` has to run again on the way out: Undo, Redo and
 *  + Stack are disabled for its duration, and the frame that ends it is not otherwise
 *  a board change, so nothing else would re-enable them.
 *
 *  A sweep that moved cards goes through `onChange` once, at the end: the 🏠 button
 *  can stop with cards still on the table, and that board has to be saved, re-checked
 *  for a dead end and have the cursor re-seated like any other. Only when it moved
 *  something — `onChange` schedules `evaluateBoard`, which could otherwise restart an
 *  empty sweep forever. */
function endAutoComplete(): void {
  autoCompleting = false;
  const moved = sweepMoves > 0;
  sweepMoves = 0;
  if (moved) onChange();
  else updateStats();
}

/** The 🏠 button: every card that can go to a foundation, and every card that
 *  becomes able to as the ones above it leave. The same sweep auto-complete runs,
 *  started early — so the order is `autoCompleteSource`'s and nothing new can drift
 *  from it. The stock is left alone; drawing is the player's call. */
function sendAllHome(): void {
  if (boardBusy() || input.drag) return;
  if (!game.autoCompleteSource()) {
    announce("nothing can go to the foundations");
    return;
  }
  autoCompleting = true;
  autoStep();
}

function autoStep(): void {
  invalidate();
  // The same question `autoCompleteStep` asks, asked a moment earlier: the flight
  // needs the card's position *before* it moves, and one definition of the sweep's
  // order means the animation can't come to disagree with the move it illustrates.
  const next = game.autoCompleteSource();
  if (!next) {
    endAutoComplete();
    if (game.isWon()) startCelebration();
    return;
  }
  const pile = game.getPile(next.from);
  const card = pile[next.index];
  const target = game.foundationTargetFor(card);
  const dest: PileId = { kind: "foundation", index: target };
  const src = cardPos(game, layout, next.from, next.index);
  const before = game.getPile(dest).length;
  const result = game.moveCards(next.from, next.index, dest);
  if (!result) {
    endAutoComplete();
    return;
  }
  sweepMoves++;
  // Emptying a temp stack removes its column; refresh the layout before
  // computing the flight target.
  syncSpareLayout();
  const to = cardPos(game, layout, dest, before);
  updateStats();
  animator.flyCard(card, src, to, {
    duration: 150,
    easing: Easings.easeOutCubic,
    onDone: () => autoStep(),
  });
}

// ---- Win celebration -------------------------------------------------------

function startCelebration(): void {
  if (celebration.active) return;
  clearGame(); // a finished game shouldn't resume on the next load
  winRecord = recordWin({
    score: game.score,
    elapsedMs: elapsedNow(),
    moves: game.moves,
    // Which day's board this is — today's, an archived one, or not a daily at all.
    // Only today's extends the streak; an archived win just ticks that day off.
    daily: dailyOfCurrentGame(),
  });
  syncDailyButton();
  if (timerStart !== null) {
    elapsedFrozen += performance.now() - timerStart;
    timerStart = null;
  }
  const seeds: { card: Card; x: number; y: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const p = layout.foundations[i];
    for (const card of game.foundations[i]) seeds.push({ card, x: p.x, y: p.y });
  }
  celebStarted = false;
  // The extras are motion for its own sake, which is exactly what reduced-motion asks
  // us not to do. `animationsOn` isn't the right gate — it's also set by ?animate=off
  // for deterministic screenshots, and the cascade is the one place we *want* the
  // flourish captured.
  celebration.start(seeds, { extras: !reduceMotion.matches });
  // After `start`, so the toolbar reflects a board that is now celebrating: the
  // cascade owns the canvas and Undo, Redo and + Stack all refuse until the next game.
  updateStats();
  playFanfare();
  showWinPanel();
}

function runCelebrationFrame(): void {
  if (!celebStarted) {
    // Draw the completed board once; subsequent frames leave trails.
    renderer.drawScene(ctx, game, layout, animator, null, null);
    celebration.openingBurst(layout.foundations, layout.cardW, layout.cardH);
    celebStarted = true;
  }
  const { cards, particles } = celebration.step(
    layout.width,
    layout.height,
    layout.cardW,
    layout.cardH,
  );
  for (const f of cards) {
    f.card.faceUp = true;
    renderer.drawCard(ctx, f.card, f.x, f.y, layout, { flat: true, angle: f.angle });
  }
  renderer.drawParticles(ctx, particles);
}

/** The win dialog's contents. The daily line reads the streak back out of the record
 *  just written, so a replayed daily correctly doesn't claim another day. */
function showWinPanel(): void {
  const daily =
    winRecord && isDailyGame()
      ? { key: todayKey(), streak: currentDailyStreak(winRecord.stats, todayKey()) }
      : undefined;
  // One reading of the clock, shared by the text and the link in it: two calls to
  // `elapsedNow()` can land either side of a second boundary and disagree.
  const result: SharedResult = { score: game.score, moves: game.moves, elapsedMs: elapsedNow() };
  prefs.syncBarHeight();
  winPanel.show({
    score: game.score,
    record: winRecord?.isRecord ?? false,
    best: winRecord ? winRecord.stats.bestScore : game.score,
    dailyStreak: daily?.streak ?? 0,
    shareText: shareText({
      ...result,
      url: shareUrl(location.href, dealLink(), result),
      code: encodeSeed(game.seed),
      daily,
    }),
  });
}

// ---- Deal animation --------------------------------------------------------

function startDeal(): void {
  busy = true;
  invalidate();
  animator.clear();
  animator.setNow(performance.now());

  // Allow skipping the deal animation (reduced-motion / screenshots).
  if (!animationsOn) {
    busy = false;
    updateStats();
    return;
  }

  let dealIndex = 0;
  const stagger = 42;

  for (let row = 0; row < 7; row++) {
    for (let col = row; col < 7; col++) {
      const card = game.tableau[col][row];
      const dest = cardPos(game, layout, { kind: "tableau", index: col }, row);
      const isTop = row === col; // last card in this column → flips face up
      animator.flyCard(card, layout.stock, dest, {
        duration: 260,
        delay: dealIndex * stagger,
        easing: Easings.easeOutCubic,
        flip: isTop,
        faceShown: false,
      });
      // Soft tick as each card lands during the deal.
      animator.delay(dealIndex * stagger, () => playDeal());
      dealIndex++;
    }
  }
  animator.delay(dealIndex * stagger + 320, () => {
    busy = false;
    updateStats();
  });
}

// ---- Controller actions ----------------------------------------------------

function elapsedNow(): number {
  return elapsedFrozen + (timerStart === null ? 0 : performance.now() - timerStart);
}

/** Autosave. The save exists exactly while there is an in-progress game worth
 *  coming back to, so New Game and winning clear it simply by falling through here. */
function persist(): void {
  if (!started || game.moves === 0 || game.isWon() || celebration.active) return;
  saveGame(game.serialize(), elapsedNow());
}

function onChange(): void {
  invalidate();
  bumpBoard();
  if (cursor) cursor = clampCursor(game, cursor);
  syncSpareLayout();
  if (!countedPlayed && game.moves > 0) {
    countedPlayed = true;
    recordGameStart();
  }
  // Restart the clock on the first move, and after a resume (where elapsedFrozen
  // carries the saved time, so it can't be the "not started yet" signal).
  if (timerStart === null && !game.isWon() && game.moves > 0) {
    timerStart = performance.now();
  }
  updateStats();
  persist();
  pendingCheck = true;
}

/** Shared by New Game and Restart, so the two can't drift. `deal` either shuffles a
 *  fresh layout or replays the current seed. */
function beginGame(deal: () => void): void {
  // Walking away from a game in progress is a loss, and its time still counts.
  if (countedPlayed && !game.isWon()) recordAbandon(elapsedNow());
  countedPlayed = false;
  celebration.stop();
  celebStarted = false;
  winPanel.hide();
  winRecord = null;
  autoCompleting = false;
  sweepMoves = 0; // the old board's sweep has nothing left to save
  animator.clear();
  invalidate();
  cursor = null;
  held = null;
  deal();
  applyEasy(false); // the assist doesn't carry over to the next game
  bumpBoard(); // after the deal: the check it schedules is about the new board
  clearGame();
  syncSpareLayout();
  timerStart = null;
  elapsedFrozen = 0;
  showClock("0:00");
  syncDealUrl();
  syncDailyButton();
  updateStats();
  startDeal();
}

function newGame(): void {
  beginGame(() => game.deal());
}

/** Replay the same layout from the start. Not undoable — `deal()` clears history —
 *  so it's guarded like the other board-destroying actions. */
function restartDeal(): void {
  if (busy || autoCompleting || input.drag) return;
  beginGame(() => game.restartDeal());
}

// ---- The daily deal --------------------------------------------------------

function todayKey(): string {
  return dailyKey(new Date());
}

/** Whether the board on screen is today's deal. Derived from the seed rather than
 *  stored, so it costs no save-format change and a *resumed* game is still recognised
 *  as the daily. The edge is midnight: a daily won a minute after it stops being
 *  today's banks as an ordinary win, which is the harmless direction to fail in. */
function isDailyGame(): boolean {
  return game.seed === dailySeed(todayKey());
}

/** Which day's deal the board on screen is, if any — today's or one from the archive.
 *  Derived from the seed, so a game resumed days later is still the daily it came
 *  from without anything extra in the save. */
function currentDailyDay(): string | null {
  return dailyDayForSeed(game.seed, todayKey(), ARCHIVE_WINDOW);
}

/** What `recordWin` needs to know: which day was won, and whether it counts towards
 *  the run. Only today's does — an archived win ticks its day off in the grid but
 *  must not extend or restart a streak that is about keeping up. */
function dailyOfCurrentGame(): { key: string; extendsStreak: boolean } | undefined {
  const key = currentDailyDay();
  if (!key) return undefined;
  return { key, extendsStreak: key === todayKey() };
}

/** Deal a specific day from the archive. Same guard as playDaily: don't bin a game
 *  in progress that is already that very board. */
function playArchivedDay(key: string): void {
  if (busy || autoCompleting || input.drag) return;
  const seed = dailySeed(key);
  if (game.seed === seed && !game.isWon() && game.moves > 0) return;
  beginGame(() => game.deal(seed));
}

function playDaily(): void {
  if (busy || autoCompleting || input.drag) return;
  // Already on it and part-way through: the button's job is done, and re-dealing
  // here would silently throw the progress away. New Game and Restart both remain.
  if (isDailyGame() && !game.isWon() && game.moves > 0) return;
  beginGame(() => game.deal(dailySeed(todayKey())));
}

/** Reflect today's state on the 📅 button. Called at the four points that can change
 *  it — boot, a new deal, a win, and a stats reset — rather than from `updateStats`,
 *  which runs on every move and would re-read storage each time. */
function syncDailyButton(): void {
  const key = todayKey();
  const won = loadStats().lastDailyWin === key;
  const playing = isDailyGame();
  el.daily.classList.toggle("is-done", won);
  el.daily.classList.toggle("is-active", playing);
  const label = won
    ? `Today's deal — won (${key})`
    : playing
      ? `Today's deal — in progress (${key})`
      : `Play today's deal (${key})`;
  setTip(el.daily, label);
  el.daily.setAttribute("aria-label", label);
}

/** This board, as `share.ts` names it for a link. */
function dealLink(): DealLink {
  return { code: encodeSeed(game.seed), drawCount: game.drawCount };
}

/** Keep the deal code in the address bar. The board doesn't show it — the URL *is*
 *  the shareable thing — and this also keeps screenshots reproducible. */
function syncDealUrl(): void {
  try {
    history.replaceState(null, "", dealUrl(location.href, dealLink()));
  } catch {
    /* replaceState can throw on exotic origins; the game plays on regardless */
  }
}

function doUndo(): void {
  if (boardBusy()) return;
  if (game.undo()) afterTimeTravel();
}

function doRedo(): void {
  if (boardBusy()) return;
  if (game.redo()) {
    afterTimeTravel();
    // Unlike undo, redo can land back on a won or auto-completable board.
    pendingCheck = true;
  }
}

function afterTimeTravel(): void {
  invalidate();
  // Undo and redo change the board without going through `onChange`, so this is the
  // one path that has to bump the version itself. Without it a search started before
  // an undo lands its verdict on the position *after* it — and a hint would point at
  // cards that have moved.
  bumpBoard();
  held = null; // the run it referred to may not exist in this position
  if (cursor) cursor = clampCursor(game, cursor);
  animator.clear();
  syncSpareLayout();
  updateStats();
  persist();
}

function setDrawCount(n: DrawCount): void {
  game.drawCount = n;
  invalidate(); // the waste fans by drawCount, so the board looks different at once
  for (const btn of Array.from(el.drawToggle.querySelectorAll<HTMLButtonElement>(".seg-btn"))) {
    btn.classList.toggle("is-active", Number(btn.dataset.draw) === n);
  }
}

/** Easy mode is per-game, not a saved preference: every new deal starts with it
 *  off, and it only travels with a game via that game's save. */
function applyEasy(on: boolean): void {
  game.easyEmptyStacks = on;
  el.easy.setAttribute("aria-pressed", on ? "true" : "false");
  setTip(
    el.easy,
    on ? "Easy mode on: empty columns accept any card" : "Easy mode: empty columns accept any card",
  );
}

function toggleEasy(): void {
  applyEasy(!game.easyEmptyStacks);
  persist(); // the board's rules are part of the save
  bumpBoard(); // the rules changed: a hint or a verdict about the old ones is stale
}

function addTempStack(): void {
  if (boardBusy()) return;
  if (input.drag) return; // don't re-layout the board under a live drag
  if (game.addTempStack()) onChange();
}

// ---- Messages over the board -----------------------------------------------

let toastTimer = 0;

/** A short-lived line over the board, also spoken. Used for answers that have nowhere
 *  permanent to live — the solver's verdicts, mostly. */
function showToast(message: string, ms = 6000): void {
  window.clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  announce(message);
  toastTimer = window.setTimeout(settleToast, ms);
}

/** What the toast shows when no timed line is up: the dead-board warning while the
 *  position is dead, nothing otherwise. */
function settleToast(): void {
  toastTimer = 0;
  if (deadCheck.warned) {
    el.toast.textContent = DEAD_BOARD;
    el.toast.hidden = false;
  } else {
    el.toast.hidden = true;
  }
}

// ---- Is this deal still winnable? ------------------------------------------

let solverWorker: Worker | null = null;
let solverBusy = false;
/** Bumped by every change to the board. The search runs against a snapshot taken at
 *  click time while the board stays playable, so the verdict has to be checked against
 *  the position it was actually about — otherwise "this can't be won" can land about a
 *  game the player has already left, or a different deal entirely. */
let boardVersion = 0;

/** The move the solver suggested, and which board it was about. Drawn only while that
 *  version is still current: any change — a move, an undo, a new deal — takes the arrow
 *  away rather than leaving it pointing at cards that have since moved. */
let hint: { move: GameMove; version: number } | null = null;

function hintView(): GameMove | null {
  return hint && hint.version === boardVersion ? hint.move : null;
}

/** The one way the version moves. Every board change also asks whether the new
 *  position can still be won, so a bump without that check can't be written. */
function bumpBoard(): void {
  boardVersion++;
  checkDead();
}

// ---- The dead-board warning ------------------------------------------------
// Runs unasked after every change, on a worker of its own, so it never competes with
// 💡 for the answer or greys it out. The rules for when it believes an answer and when
// the warning goes up or down are deadCheck.ts's; this is only the worker and the toast.

let deadWorker: Worker | null = null;

function getDeadWorker(): Worker {
  deadWorker ??= new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  return deadWorker;
}

const deadCheck = new DeadCheck({
  ask: (request, onAnswer, onFail) => {
    const worker = getDeadWorker();
    worker.onmessage = (e: MessageEvent<SolveResponse>) => onAnswer(e.data);
    worker.onerror = () => {
      deadWorker = null;
      onFail();
    };
    worker.postMessage(request);
  },
  // Nothing over the start overlay; the dismissal asks.
  current: () =>
    started ? { version: boardVersion, state: game.serialize(), won: game.isWon() } : null,
  onWarn: (dead) => {
    // A timed line has the toast for now; `settleToast` picks the warning up (or takes
    // it down) when that line is done.
    if (toastTimer !== 0) return;
    settleToast();
    if (dead) announce(DEAD_BOARD);
  },
});

function checkDead(): void {
  deadCheck.check();
}

/** The search runs in a worker: a stubborn position can take several hundred
 *  milliseconds, which inline would drop frames and stall a drag. */
function getSolverWorker(): Worker {
  solverWorker ??= new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  return solverWorker;
}

/** Every way out of a dead position that isn't just playing on. Undo first, as the one
 *  that costs nothing; Easy and a ✦ stack change the game, New Game abandons it. */
const RESCUES = "undo, turn on Easy mode, add a ✦ stack, or start a new game.";

/** The dead-board warning. There is no "can this still be won?" button behind it any
 *  more: the warning already arrives unasked whenever the answer is no, and 💡 runs the
 *  same escalated search on demand — on a dead board it says so too. */
const DEAD_BOARD = `🪦 This deal can't be won from here — ${RESCUES}`;

/** A hint is only ever a move off a line that actually wins, so the two answers that
 *  aren't `solved` have no move to offer and say so rather than falling back to a
 *  plausible-looking one. A guess dressed as a hint is the one thing this must not do:
 *  the whole point is that it can be trusted. */
const NO_HINT: Record<Outcome, string> = {
  solved: "💡 It's winnable, but I couldn't point at the move.",
  unwinnable: `🪦 No move from here leads to a win — ${RESCUES}`,
  unknown: "🤔 Couldn't find a winning line in time, so I've no move worth trusting.",
};

/** One worker, so the two things that ask it questions take turns rather than
 *  cutting each other off mid-search. */
function syncSolverButtons(): void {
  el.hint.disabled = solverBusy;
  el.winnable.disabled = solverBusy;
}

/** 💡: the first move of a line that wins, or a plain statement of why there is none.
 *  One flag keeps it from running two searches at once on the shared worker. */
function requestHint(): void {
  if (solverBusy) return;
  // Order matters: a won board is mid-celebration, so the busy guard below would
  // otherwise swallow the click and leave the button looking broken.
  if (game.isWon()) {
    showToast("✅ Already won.");
    return;
  }
  if (boardBusy()) {
    showToast("⏳ Wait for the cards to settle.", 2500);
    return;
  }
  const state = game.serialize();
  if (!canAnalyse(state)) {
    showToast(
      "🤔 Can't suggest a move on a board with ✦ stacks or easy mode — their rules differ.",
    );
    return;
  }

  solverBusy = true;
  syncSolverButtons();
  showToast("💡 Looking for a move…", 60_000);

  const worker = getSolverWorker();
  const done = (message: string): void => {
    solverBusy = false;
    syncSolverButtons();
    showToast(message);
  };
  const askedAbout = boardVersion;
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    if (boardVersion !== askedAbout) {
      done("🤔 The board changed while I was looking — press 💡 again.");
      return;
    }
    done(hintMessage(e.data));
  };
  worker.onerror = () => {
    // A worker that won't start shouldn't look like a verdict.
    solverWorker = null;
    done("🤔 Couldn't run the analysis.");
  };
  // Escalate only when the fast pass can't tell. The boards that answer quickly are
  // untouched, and the ones that would otherwise shrug get a much deeper search
  // instead — measured over 40 draw-1 deals, that turns 3 of 11 shrugs into answers.
  const request: SolveRequest = {
    state,
    maxNodes: 200_000,
    escalateNodes: 2_000_000,
    wantMove: true,
  };
  worker.postMessage(request);
}

/** How many candidate deals to test before giving up. About two thirds of random deals
 *  are provably winnable inside the fast budget, so this almost always ends on the
 *  first or second — twelve is the "something has gone badly wrong" ceiling rather than
 *  an expected cost, and at ~70 ms a candidate even that is under a second. */
const WINNABLE_TRIES = 12;

/** Deal a board the solver has already carried through to 52 cards home.
 *
 *  Candidates are tested at the fast budget with no escalation: an `unknown` here isn't
 *  a board to reject on its merits, it's one we couldn't vouch for, and the cheapest
 *  answer is to shuffle again rather than think harder about this one. The current
 *  board is left alone until a winner is found — a search that comes up empty must not
 *  cost the player the game they were in the middle of. */
function newWinnableGame(): void {
  if (solverBusy) return;
  if (boardBusy() || input.drag) return;

  solverBusy = true;
  syncSolverButtons();
  showToast("🎲 Looking for a deal that can be won…", 60_000);

  const worker = getSolverWorker();
  let tries = 0;
  let seed = randomSeed();
  const stop = (message: string): void => {
    solverBusy = false;
    syncSolverButtons();
    showToast(message);
  };
  const test = (): void => {
    tries++;
    // A deal winnable at Draw 1 need not be at Draw 3, so candidates are tested under
    // the mode this game will actually be played in.
    const request: SolveRequest = {
      state: new Game(game.drawCount, seed).serialize(),
      maxNodes: 200_000,
    };
    worker.postMessage(request);
  };
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    if (e.data.outcome === "solved") {
      const found = seed;
      stop(`🎲 Dealt a board that can be won — ${tries} shuffle${tries === 1 ? "" : "s"}.`);
      beginGame(() => game.deal(found));
      return;
    }
    if (tries >= WINNABLE_TRIES) {
      stop("🤔 Couldn't vouch for a deal just now — your board is untouched. Try again?");
      return;
    }
    seed = randomSeed();
    test();
  };
  worker.onerror = () => {
    solverWorker = null;
    stop("🤔 Couldn't run the search.");
  };
  test();
}

/** Show the first move of a line that wins. Not a heuristic "this looks playable" —
 *  the removed `findHint` was that, and a greedy player built on it can't win a game —
 *  but the opening move of a line the search has actually carried through to 52 cards
 *  home. That is also why it declines rather than guessing when there's no such line. */
/** The line to show for an answer that is still about the board on screen. */
function hintMessage(r: SolveResponse): string {
  if (r.outcome !== "solved" || !r.next) return NO_HINT[r.outcome];
  hint = { move: r.next, version: boardVersion };
  invalidate();
  return `💡 Try: ${describeHint(game, r.next.from, r.next.fromIndex, r.next.to)}.`;
}

// ---- Keyboard play ---------------------------------------------------------

const live = document.getElementById("a11y-status") as HTMLElement;

/** Speak to the screen reader. Re-announcing the same string is a no-op in some
 *  readers, so a zero-width space forces it through — moving between two identical
 *  empty columns still has to say something. */
function announce(message: string): void {
  live.textContent = live.textContent === message ? `${message}\u200b` : message;
}

function cursorView(): CursorView | null {
  if (!keyboardActive || !cursor) return null;
  return { pile: cursor.pile, depth: cursor.depth, held: held };
}

/** Put the cursor somewhere sensible the first time a key asks for it. */
function ensureCursor(): Cursor {
  keyboardActive = true;
  if (!cursor) cursor = clampCursor(game, { pile: { kind: "tableau", index: 0 }, depth: 0 });
  else cursor = clampCursor(game, cursor);
  return cursor;
}

function navigate(move: CursorMove): void {
  const from = ensureCursor();
  cursor = moveCursor(game, from, move);
  invalidate();
  announce(describeCursor(game, cursor));
}

/** Jump straight at a column — much faster than walking there, and the numbers match
 *  what's on screen left to right. */
function jumpToColumn(index: number): void {
  keyboardActive = true;
  cursor = clampCursor(game, { pile: { kind: "tableau", index }, depth: Number.MAX_SAFE_INTEGER });
  invalidate();
  announce(describeCursor(game, cursor));
}

/** Play a move the same way a drag does — model first, cards fly after — so keyboard
 *  play looks and sounds identical to mouse play rather than teleporting cards. */
function playMove(from: PileId, fromIndex: number, to: PileId): boolean {
  const origins = game
    .getPile(from)
    .slice(fromIndex)
    .map((_, i) => cardPos(game, layout, from, fromIndex + i));
  const result = game.moveCards(from, fromIndex, to);
  if (!result) return false;
  syncSpareLayout(); // emptying a ✦ stack drops a column before we aim the flights
  // `result.to`, never the requested `to`: moveCards re-indexes a spare destination
  // when the source spare empties and is spliced out, so the pile the cards actually
  // landed on can have a lower index than the one asked for. Aiming a flight at the
  // stale index reads past the end of the freshly rebuilt layout and throws.
  const dest = result.to;
  const landing = game.getPile(dest).length - result.moved.length;
  result.moved.forEach((card, i) => {
    animator.flyCard(card, origins[i], cardPos(game, layout, dest, landing + i), {
      duration: 160,
      easing: Easings.easeOutCubic,
    });
  });
  playPlace();
  if (result.flipped) playFlip();
  announce(describeMove(game, result.moved, dest, result.flipped));
  onChange();
  return true;
}

/** Space / Enter: draw, pick up, or drop, depending on where the cursor is. */
function activateCursor(): void {
  if (boardBusy()) return;
  const c = ensureCursor();

  if (c.pile.kind === "stock") {
    const before = game.waste.length;
    if (!game.drawFromStock()) return;
    playDraw();
    const top = game.waste[game.waste.length - 1];
    const drawn = game.waste.length - before;
    // Draw 3 turns several at once, but only the top one is playable, so that is the
    // one worth naming.
    announce(
      drawn <= 0 || !top
        ? "stock recycled"
        : drawn === 1
          ? `drew ${cardName(top)}`
          : `drew ${drawn}, ${cardName(top)} on top`,
    );
    onChange();
    return;
  }

  if (!held) {
    const cards = game.getPile(c.pile);
    const card = cards[c.depth];
    if (!card || !card.faceUp) {
      announce("nothing to pick up there");
      return;
    }
    held = { ...c };
    invalidate();
    announce(`picked up ${runName(cards.slice(c.depth))}, choose a destination`);
    return;
  }

  if (samePile(held.pile, c.pile)) {
    releaseHeld("put down");
    return;
  }
  if (!playMove(held.pile, held.depth, c.pile)) {
    announce(`can't move there — ${pileName(game, c.pile)}`);
    return;
  }
  held = null;
  cursor = clampCursor(game, cursor ?? c);
}

function releaseHeld(why: string): void {
  if (!held) return;
  held = null;
  invalidate();
  announce(why);
}

/** F: send the focused (or held) card straight home, the keyboard's double-click. */
function sendToFoundation(): void {
  if (boardBusy()) return;
  const c = held ?? ensureCursor();
  // The stock is face down and unplayable until drawn. `moveCards` has no face-up
  // guard for it (unlike `autoMoveToFoundation`), so without this the F key sends an
  // undrawn card straight home — breaking the rules and writing a face-down card into
  // a foundation, which `parseGameState` then rejects, silently binning the save.
  if (c.pile.kind === "stock") {
    announce("draw the card first");
    return;
  }
  const pile = game.getPile(c.pile);
  if (pile.length === 0) return;
  const card = pile[pile.length - 1];
  if (!card.faceUp) {
    announce("that card is face down");
    return;
  }
  const target = game.foundationTargetFor(card);
  if (target < 0) {
    announce("no foundation for that card");
    return;
  }
  if (playMove(c.pile, pile.length - 1, { kind: "foundation", index: target })) {
    held = null;
    cursor = clampCursor(game, cursor ?? c);
  }
}

// ---- Wire up ---------------------------------------------------------------

const input = new Input(canvas, game, animator, {
  layout: () => layout,
  busy: () => boardBusy(),
  onChange,
});

// Reaching for the mouse puts the keyboard cursor away — showing both at once would
// be two competing answers to "what am I about to move".
canvas.addEventListener("pointerdown", () => {
  if (!keyboardActive) return;
  keyboardActive = false;
  held = null;
  invalidate();
});

// Releasing a press always repaints. While the button is down the renderer draws the
// pressed card lifted and offset from its pile; if the press never became a drag and
// the tap did nothing, `Input` just drops `drag` with no onChange, and the paint gate
// would leave that lifted card on screen until something unrelated dirtied the board.
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, invalidate);
}

// A drag left mid-air when the tab loses focus: pointercancel usually fires, but not
// on every platform.
window.addEventListener("blur", () => input.cancelDrag());

// The canvas ResizeObserver is the main signal; these cover the mobile cases where the
// viewport settles in stages after a rotation and the observer has already fired.
window.addEventListener("resize", scheduleResize);
window.addEventListener("orientationchange", scheduleResize);
window.visualViewport?.addEventListener("resize", scheduleResize);

el.newGame.addEventListener("click", newGame);
el.undo.addEventListener("click", doUndo);
el.redo.addEventListener("click", doRedo);
el.restart.addEventListener("click", restartDeal);
el.hint.addEventListener("click", requestHint);
el.winnable.addEventListener("click", newWinnableGame);
el.daily.addEventListener("click", playDaily);
el.easy.addEventListener("click", toggleEasy);
el.addStack.addEventListener("click", addTempStack);
el.home.addEventListener("click", sendAllHome);
el.drawToggle.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (btn) {
    setDrawCount(Number(btn.dataset.draw) as DrawCount);
    persist();
    syncDealUrl(); // the mode is part of what a shared link means
    bumpBoard(); // the same cards under the other draw count are a different game
  }
});

/** Arrow keys, Space and Enter belong to the board — but not while a dialog is up,
 *  where they are the browser's for moving between and pressing buttons. */
function boardHasKeys(): boolean {
  return !statsDialog.isOpen() && !winPanel.isOpen();
}

/** Whether a focused control should get Space/Enter instead of the board.
 *
 *  Those two keys are how a browser activates the focused element, so swallowing them
 *  unconditionally makes every toolbar button unusable by keyboard — the opposite of
 *  what the cursor was added for. Arrow keys and letters are safe to take: a focused
 *  button does nothing with them. */
function focusOwnsActivation(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === canvas) return false;
  return active.closest("button, a[href], input, select, textarea, [contenteditable]") !== null;
}

/** Escape, in order of what it is most likely to mean: close the dialog, put down
 *  what the cursor holds, cancel a drag. */
function escape(): void {
  if (statsDialog.isOpen()) statsDialog.close();
  else if (held) releaseHeld("put down");
  else input.cancelDrag();
}

function runCommand(c: Command): void {
  switch (c.kind) {
    case "escape": return escape();
    case "navigate": return navigate(c.move);
    case "activate": return activateCursor();
    case "toFoundation": return sendToFoundation();
    case "column": return jumpToColumn(c.index);
    case "undo": return doUndo();
    case "redo": return doRedo();
    case "newGame": return newGame();
    case "daily": return playDaily();
    case "hint": return requestHint();
    case "winnable": return newWinnableGame();
    case "home": return sendAllHome();
    case "chrome": return prefs.toggleChrome();
  }
}

window.addEventListener("keydown", (e) => {
  if (!started) return; // the start overlay owns the board until it's dismissed
  const command = keyCommand(e, {
    modalOpen: statsDialog.isOpen(),
    boardHasKeys: boardHasKeys(),
    focusOwnsActivation: focusOwnsActivation(),
  });
  if (!command) return;
  // The arrows would scroll, Space would press, and Ctrl+Z/Y would reach the
  // browser's own undo; the plain letters have no default worth keeping either way.
  if (command.kind !== "escape") e.preventDefault();
  runCommand(command);
});

onCardFaceLoad(invalidate);
// Offline support. Production only — a worker in dev would serve stale modules and
// make hot reload lie. `updateViaCache: "none"` keeps the browser's HTTP cache away
// from sw.js itself, which matters because nothing in this repo sets the CDN's cache
// headers: without it a long-cached worker could never update itself.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .catch(() => undefined); // offline play is a bonus, never a requirement
  });
}

preloadCardFaces();
preloadFaceArt();
// Before resize(), so the board is measured against the bar the user left behind.
prefs.load();

// Pick up a saved game if there is a valid one, replacing the constructor's fresh
// deal. This has to run before resize(), which sizes the board from the number of
// temp stacks, and before setDrawCount, which reflects the restored draw mode.
const params = new URLSearchParams(location.search);
const urlSeed = parseSeed(params.get("deal"));
const urlDraw = params.get("draw") === "3" ? 3 : params.get("draw") === "1" ? 1 : null;
// A shared win: someone's result, on the deal named alongside it. Only a challenge
// when the link carries both — a score with no board is nothing to be challenged to.
const challenge = urlSeed === null ? null : parseResult(params.get("win"));
const saved = loadGame();
// Resume unless the URL names a *different* deal. Reloading a shared link mid-game
// therefore keeps your board rather than wiping it.
const resumeSaved = saved !== null && (urlSeed === null || urlSeed === saved.state.seed);
if (resumeSaved) {
  game.restore(saved!.state);
  elapsedFrozen = saved!.elapsed;
  // It was counted as played when it started, possibly in an earlier session.
  countedPlayed = loadStats().pending;
} else if (urlSeed !== null) {
  game.deal(urlSeed);
}
if (urlDraw !== null && !resumeSaved) game.drawCount = urlDraw;
// A resumed board is only coherent under the rules it was played with; a fresh deal
// always starts with the assist off.
applyEasy(resumeSaved ? saved!.state.easy : false);
setDrawCount(game.drawCount);
resize();
showClock(formatClock(elapsedFrozen));
syncDealUrl();
syncDailyButton();
updateStats();

// Keep the board hidden behind the start overlay so a dealt (or restored) game
// doesn't show underneath it — a fresh game is revealed by the deal animation, a
// resumed one the moment the overlay is dismissed.
animator.hideCards(boardCardIds());

requestAnimationFrame(frame);

const winPanel = new WinPanel({ newGame, restart: restartDeal });

const statsDialog = new StatsDialog({
  today: todayKey,
  playDay: playArchivedDay,
  afterReset: syncDailyButton,
});

// The opening deal waits for a click so its sound can play (browsers block
// audio until the first user gesture). Clicking unlocks audio, then deals.
const startOverlay = new StartOverlay(dismissStartOverlay);

if (challenge) {
  // The board it names is `game`'s, not the link's numbers: the deal has already been
  // laid out from `?deal=`, so what the card describes is what pressing the button
  // plays — including whether it is a daily, which comes from the seed.
  startOverlay.showChallenge(
    challenge,
    boardLine({
      code: encodeSeed(game.seed),
      drawCount: game.drawCount,
      dailyKey: dailyDayForSeed(game.seed, todayKey()),
      todayKey: todayKey(),
    }),
  );
}

if (resumeSaved) startOverlay.showResume(game.moves, game.score);

function dismissStartOverlay(choice: StartChoice): void {
  unlockAudio();
  started = true;
  startOverlay.dismiss();
  if (choice === "fresh") {
    newGame(); // deals a new seed and discards any save
    return;
  }
  if (choice === "reveal") {
    startDeal();
    checkDead(); // dealt before the overlay, so no bump has asked about it yet
    return;
  }
  animator.clear(); // reveals the restored board; startDeal() assumes a fresh pyramid
  invalidate();
  if (game.moves > 0 && !game.isWon()) timerStart = performance.now();
  updateStats();
  pendingCheck = true; // a restored board may already be won or auto-completable
  checkDead(); // a saved game can be as dead as it was when it was put down
}

initTooltips();

// Capture think-time since the last move, and act as a backstop for tab eviction.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});
