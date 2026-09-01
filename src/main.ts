// Bootstrap: canvas + HiDPI scaling, the game loop, the deal / auto-complete /
// win animations, and the toolbar wiring.

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
import {
  getFelt,
  getThemeName,
  isThemeName,
  nextTheme,
  setTheme,
  themeInfo,
  ThemeName,
} from "./theme";
import {
  isSoundEnabled,
  setSoundEnabled,
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
  hasWonDaily,
  loadGame,
  loadStats,
  readItem,
  recordAbandon,
  recordGameStart,
  recordWin,
  resetStats,
  saveGame,
  Stats,
  writeItem,
} from "./storage";
import {
  dailyDayForSeed,
  dailyKey,
  dailySeed,
  encodeSeed,
  parseSeed,
  randomSeed,
  recentDailyKeys,
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
import { statGroups } from "./statsView";
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
let timerStart: number | null = null;
let elapsedFrozen = 0;
let celebStarted = false;
let resuming = false; // a saved game was restored; the overlay reveals it instead of dealing
let started = false; // the start overlay has been dismissed
let chromeHidden = false; // toolbar folded down to its toggle
/** Portrait only: which edge the stock/waste/foundation rail sits on. The hand holding
 *  a phone covers the side it's on, and the stock is the pile you tap most. */
let leftHanded = false;
/** Set when a game is won: the lifetime stats to show on the win panel, and whether
 *  this game beat the best score. Null until then. */
let winRecord: { stats: Stats; isRecord: boolean } | null = null;
/** This deal has been counted in `played`. Undo can take the move count back to 0, so
 *  the flag — not `game.moves` — is what stops a game being counted twice. */
let countedPlayed = false;
let resetArmed = false; // the stats reset button is waiting for a confirming click
let resetTimer = 0;
let shareTimer = 0; // the Share button's "Copied!" label, reverted after a moment
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
  layout = computeLayout(rect.width, rect.height, sparesShown, leftHanded);
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
    autoCompleting = false;
    pendingCheck = true; // pick the sweep back up against the new layout
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
  sound: document.getElementById("btn-sound") as HTMLButtonElement,
  startMute: document.getElementById("start-mute") as HTMLButtonElement,
  theme: document.getElementById("btn-theme") as HTMLButtonElement,
  chrome: document.getElementById("btn-chrome") as HTMLButtonElement,
  app: document.getElementById("app") as HTMLElement,
  toolbar: document.getElementById("toolbar") as HTMLElement,
  controls: document.querySelector(".controls") as HTMLElement,
  time: document.getElementById("stat-time") as HTMLElement,
  moves: document.getElementById("stat-moves") as HTMLElement,
  score: document.getElementById("stat-score") as HTMLElement,
  restart: document.getElementById("btn-restart") as HTMLButtonElement,
  analyse: document.getElementById("btn-analyse") as HTMLButtonElement,
  hint: document.getElementById("btn-hint") as HTMLButtonElement,
  winnable: document.getElementById("btn-winnable") as HTMLButtonElement,
  hand: document.getElementById("btn-hand") as HTMLButtonElement,
  daily: document.getElementById("btn-daily") as HTMLButtonElement,
  toast: document.getElementById("toast") as HTMLElement,
  stats: document.getElementById("btn-stats") as HTMLButtonElement,
  statsOverlay: document.getElementById("stats-overlay") as HTMLElement,
  statsList: document.getElementById("stats-list") as HTMLElement,
  statsReset: document.getElementById("stats-reset") as HTMLButtonElement,
  statsResetLabel: document.getElementById("stats-reset-label") as HTMLElement,
  statsClose: document.getElementById("stats-close") as HTMLButtonElement,
  winOverlay: document.getElementById("win-overlay") as HTMLElement,
  winScore: document.getElementById("win-score") as HTMLElement,
  winDaily: document.getElementById("win-daily") as HTMLElement,
  winShare: document.getElementById("win-share") as HTMLButtonElement,
  winShareLabel: document.getElementById("win-share-label") as HTMLElement,
  winNew: document.getElementById("win-new") as HTMLButtonElement,
  winRestart: document.getElementById("win-restart") as HTMLButtonElement,
};

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
 *  a board change, so nothing else would re-enable them. */
function endAutoComplete(): void {
  autoCompleting = false;
  updateStats();
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

/** The win dialog: the score against the record, and the two ways out. A record gets
 *  its own line and colour; otherwise the score sits next to the one to beat. */
function showWinPanel(): void {
  const record = winRecord?.isRecord ?? false;
  el.winScore.textContent = record
    ? `🏆 New best score — ${game.score}`
    : `Score ${game.score}  ·  Best ${winRecord ? winRecord.stats.bestScore : game.score}`;
  el.winScore.classList.toggle("is-record", record);
  // The daily line only appears for the daily, and reads the streak back out of the
  // record just written, so a replayed daily correctly doesn't claim another day.
  const streak = winRecord && isDailyGame() ? currentDailyStreak(winRecord.stats, todayKey()) : 0;
  el.winDaily.hidden = streak === 0;
  el.winDaily.textContent = `📅 Daily deal · ${streak}-day streak`;
  resetShareLabel();
  syncBarHeight();
  el.winOverlay.hidden = false;
  el.winNew.focus(); // so Enter/Space plays again without reaching for the mouse
}

function hideWinPanel(): void {
  el.winOverlay.hidden = true;
  resetShareLabel();
}

/** Copy the result and the deal link. Reads the daily streak back out of the record
 *  written at win time, so a replayed daily reports the streak it actually holds
 *  rather than claiming another day. */
function currentWinText(): string {
  const daily =
    winRecord && isDailyGame()
      ? { key: todayKey(), streak: currentDailyStreak(winRecord.stats, todayKey()) }
      : undefined;
  // One reading of the clock, shared by the text and the link in it: two calls to
  // `elapsedNow()` can land either side of a second boundary and disagree.
  const result: SharedResult = {
    score: game.score,
    moves: game.moves,
    elapsedMs: elapsedNow(),
  };
  return shareText({
    ...result,
    url: shareUrl(location.href, dealLink(), result),
    code: encodeSeed(game.seed),
    daily,
  });
}

/** The label is the only feedback there is, so a failure has to say so rather than
 *  silently reading as success — clipboard writes are refused outside a secure
 *  context and can be denied by permission policy. */
async function copyWinResult(): Promise<void> {
  window.clearTimeout(shareTimer);
  let ok = false;
  try {
    await navigator.clipboard.writeText(currentWinText());
    ok = true;
  } catch {
    ok = false;
  }
  el.winShareLabel.textContent = ok ? "Copied!" : "Press ⌘C";
  el.winShare.classList.toggle("is-copied", ok);
  if (!ok) selectFallbackText();
  shareTimer = window.setTimeout(resetShareLabel, 2400);
}

/** When the clipboard API is unavailable, put the text somewhere the player can copy
 *  it by hand instead of leaving them with a button that does nothing. */
function selectFallbackText(): void {
  const area = document.createElement("textarea");
  area.value = currentWinText();
  area.setAttribute("aria-label", "Your result — copy this");
  area.className = "share-fallback";
  el.winShare.parentElement?.appendChild(area);
  area.focus();
  area.select();
  window.setTimeout(() => area.remove(), 8000);
}

function resetShareLabel(): void {
  window.clearTimeout(shareTimer);
  el.winShareLabel.textContent = "Share";
  el.winShare.classList.remove("is-copied");
  el.winOverlay.querySelector(".share-fallback")?.remove();
}

// ---- Statistics dialog -----------------------------------------------------

/** The archive: the last four weeks of daily deals, ticked where they were won and
 *  clickable to play. It lives inside the statistics dialog rather than behind a new
 *  toolbar button — it *is* the daily record, the toolbar is already full, and the
 *  measured wrap threshold has no room to spare. */
function renderArchive(s: Stats): HTMLElement {
  const today = todayKey();
  const grid = document.createElement("div");
  grid.className = "archive";
  // Oldest first, so it reads like a calendar rather than backwards.
  for (const key of recentDailyKeys(today, ARCHIVE_WINDOW).reverse()) {
    const won = hasWonDaily(s, key);
    const isToday = key === today;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "archive-day";
    cell.classList.toggle("is-won", won);
    cell.classList.toggle("is-today", isToday);
    cell.dataset.day = key;
    cell.textContent = String(Number(key.slice(8, 10)));
    const state = won ? "won" : "not won";
    cell.title = `${key} — ${state}. Click to play this deal.`;
    cell.setAttribute("aria-label", `${key}, ${state}${isToday ? ", today" : ""}`);
    grid.appendChild(cell);
  }
  return grid;
}

function renderStats(): void {
  const nodes: HTMLElement[] = [];
  for (const group of statGroups(loadStats(), todayKey())) {
    // A <dt> spanning both columns: still a definition list, still one grid, and the
    // heading can't drift out of step with the rows under it.
    const head = document.createElement("dt");
    head.className = "stats-group";
    head.textContent = group.title;
    nodes.push(head);
    for (const [label, value] of group.rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      nodes.push(dt, dd);
    }
  }
  el.statsList.replaceChildren(...nodes);

  const stats = loadStats();
  const wrap = document.createElement("dd");
  wrap.className = "archive-cell";
  wrap.appendChild(renderArchive(stats));
  const head = document.createElement("dt");
  head.className = "archive-cell";
  head.textContent = "Last 4 weeks";
  el.statsList.append(head, wrap);
}

/** Enforce the dialog's `aria-modal="true"`, which is otherwise only a claim: without
 *  this, Tab walks straight out of the panel into the toolbar behind it, so for anyone
 *  driving the page by keyboard the "modal" dialog isn't modal at all. `#stats-overlay`
 *  is a sibling of `#app` precisely so the whole app can be inerted in one line —
 *  which also takes the board and toolbar out of the accessibility tree, so a screen
 *  reader can't read past the dialog either. */
function setAppInert(inert: boolean): void {
  el.app.inert = inert;
}

function openStats(): void {
  renderStats();
  disarmReset(); // a freshly opened dialog never opens half-way through a confirmation
  el.statsOverlay.hidden = false;
  setAppInert(true);
  el.statsClose.focus();
}

function closeStats(): void {
  el.statsOverlay.hidden = true;
  setAppInert(false); // before the focus call below — focus can't land inside inert
  disarmReset();
  el.stats.focus(); // back to the button that opened it
}

/** Wiping the record is destructive and unundoable, so the button asks first and
 *  forgets the question after a few seconds. */
function armOrResetStats(): void {
  if (!resetArmed) {
    resetArmed = true;
    el.statsReset.classList.add("is-confirming");
    el.statsResetLabel.textContent = "Confirm reset";
    resetTimer = window.setTimeout(disarmReset, 4000);
    return;
  }
  disarmReset();
  resetStats();
  renderStats();
  syncDailyButton(); // the ✓ was drawn from the record just wiped
}

function disarmReset(): void {
  window.clearTimeout(resetTimer);
  resetArmed = false;
  el.statsReset.classList.remove("is-confirming");
  el.statsResetLabel.textContent = "Reset stats";
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
  boardVersion++;
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
  hideWinPanel();
  winRecord = null;
  autoCompleting = false;
  resuming = false;
  animator.clear();
  invalidate();
  boardVersion++;
  cursor = null;
  held = null;
  deal();
  applyEasy(false); // the assist doesn't carry over to the next game
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

/** How far back the archive looks — four weeks in the grid, and the same window
 *  `currentDailyDay` searches, so anything the grid can offer is recognised when won. */
const ARCHIVE_WINDOW = 28;

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
  el.daily.title = label;
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
  boardVersion++;
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

function applyTheme(name: ThemeName): void {
  setTheme(name);
  invalidate(); // the felt, vignette, placeholders and card backs are all repainted
  // One attribute rather than a class per theme: CSS keys its chrome palette off it,
  // and adding a theme can't leave a stale class behind.
  document.body.dataset.theme = name;
  // The button shows where you are and says where you'd go, since with more than two
  // themes the icon alone can no longer imply the destination.
  el.theme.textContent = getFelt().icon;
  const label = `Theme: ${getFelt().label} — click for ${themeInfo(nextTheme(name)).label}`;
  el.theme.title = label;
  el.theme.setAttribute("aria-label", label);
  writeItem("solitaire-theme", name);
}

function toggleTheme(): void {
  applyTheme(nextTheme(getThemeName()));
}

function applySound(on: boolean): void {
  setSoundEnabled(on);
  const icon = on ? "🔊" : "🔇";
  const title = on ? "Mute sound effects" : "Unmute sound effects";
  el.sound.textContent = icon;
  el.sound.title = title;
  if (el.startMute) {
    el.startMute.textContent = icon;
    el.startMute.title = title;
  }
  writeItem("solitaire-sound", on ? "on" : "off");
}

function toggleSound(): void {
  applySound(!isSoundEnabled());
}

/** True when `box` lays its children out on one line: the content box is then no
 *  taller than its tallest child. Reading the real layout means this doesn't have to
 *  know which responsive rules are in play. */
function isSingleRow(box: HTMLElement): boolean {
  const kids = Array.from(box.children) as HTMLElement[];
  const tallest = Math.max(...kids.map((k) => k.offsetHeight));
  const cs = getComputedStyle(box);
  const inner = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  return inner <= tallest + 1;
}

/** Publish the toolbar's height, which is what the win panel centres below. Kept
 *  beside the toggle measurement because the same events change both: a window
 *  resize can rewrap the bar, and folding it changes its height outright. */
function syncBarHeight(): void {
  document.body.style.setProperty("--bar-h", `${el.toolbar.offsetHeight}px`);
}

/** The ☰ only earns its place when the buttons and the stats can't share one row.
 *  Measured with the button in flow, so its own width counts and the answer can't
 *  oscillate: a bar that fits *with* the toggle still fits once it's out. While the
 *  bar is folded away the toggle always shows — it's the only way back. */
function updateChromeToggle(): void {
  syncBarHeight();
  if (chromeHidden) {
    el.toolbar.classList.add("needs-toggle");
    return;
  }
  el.toolbar.classList.add("is-measuring");
  const fits = isSingleRow(el.toolbar) && isSingleRow(el.controls);
  el.toolbar.classList.remove("is-measuring");
  el.toolbar.classList.toggle("needs-toggle", !fits);
}

/** Fold the buttons away, handing the reclaimed height to the board — the
 *  ResizeObserver on the canvas re-lays the piles out by itself. The glyph stays a
 *  hamburger in both states: an ✕ on a game reads as "quit", and the bar being there
 *  or not is state enough (aria-expanded says so too). */
function applyChrome(hidden: boolean): void {
  chromeHidden = hidden;
  document.body.classList.toggle("chrome-hidden", hidden);
  const label = hidden ? "Show the toolbar" : "Hide the toolbar";
  el.chrome.title = `${label} (T)`;
  el.chrome.setAttribute("aria-label", label);
  el.chrome.setAttribute("aria-expanded", hidden ? "false" : "true");
  writeItem("solitaire-chrome", hidden ? "hidden" : "shown");
  updateChromeToggle();
}

function toggleChrome(): void {
  applyChrome(!chromeHidden);
}

/** Which side the portrait rail sits on. A preference rather than a per-game setting:
 *  which hand you hold the phone in doesn't change between deals. */
function applyHand(left: boolean): void {
  leftHanded = left;
  const label = left ? "Rail on the right" : "Rail on the left";
  el.hand.title = `${label} — click to switch sides`;
  el.hand.setAttribute("aria-label", label);
  el.hand.setAttribute("aria-pressed", left ? "true" : "false");
  writeItem("solitaire-hand", left ? "left" : "right");
  resize(); // the piles move; the board is rebuilt from the new layout
  input.cancelDrag(); // its offsets were measured against the old side
}

function toggleHand(): void {
  applyHand(!leftHanded);
}

/** Easy mode is per-game, not a saved preference: every new deal starts with it
 *  off, and it only travels with a game via that game's save. */
function applyEasy(on: boolean): void {
  game.easyEmptyStacks = on;
  el.easy.setAttribute("aria-pressed", on ? "true" : "false");
  el.easy.title = on
    ? "Easy mode on: empty columns accept any card"
    : "Easy mode: empty columns accept any card";
}

function toggleEasy(): void {
  applyEasy(!game.easyEmptyStacks);
  persist(); // the board's rules are part of the save
}

function addTempStack(): void {
  if (boardBusy()) return;
  if (input.drag) return; // don't re-layout the board under a live drag
  if (game.addTempStack()) onChange();
}

// ---- Messages over the board -----------------------------------------------

let toastTimer = 0;

/** A short-lived line over the board, also spoken. Used for answers that have nowhere
 *  permanent to live — the solver's verdict is the only one so far. */
function showToast(message: string, ms = 6000): void {
  window.clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.hidden = false;
  announce(message);
  toastTimer = window.setTimeout(() => (el.toast.hidden = true), ms);
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

/** The search runs in a worker: a stubborn position can take several hundred
 *  milliseconds, which inline would drop frames and stall a drag. */
function getSolverWorker(): Worker {
  solverWorker ??= new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
  return solverWorker;
}

const VERDICT: Record<Outcome, string> = {
  solved: "✅ This deal can still be won from here.",
  unwinnable: "🪦 This deal can't be won from here — undo, or start a new game.",
  // Said plainly: the search gave up, which is not the same as proving anything.
  unknown: "🤔 Couldn't tell within the time budget — it may still be winnable.",
};

/** A hint is only ever a move off a line that actually wins, so the two answers that
 *  aren't `solved` have no move to offer and say so rather than falling back to a
 *  plausible-looking one. A guess dressed as a hint is the one thing this must not do:
 *  the whole point is that it can be trusted. */
const NO_HINT: Record<Outcome, string> = {
  solved: "💡 It's winnable, but I couldn't point at the move.",
  unwinnable: "🪦 No move from here leads to a win — undo, or start a new game.",
  unknown: "🤔 Couldn't find a winning line in time, so I've no move worth trusting.",
};

/** One worker, so the three things that ask it questions take turns rather than
 *  cutting each other off mid-search. */
function syncSolverButtons(): void {
  el.analyse.disabled = solverBusy;
  el.hint.disabled = solverBusy;
  el.winnable.disabled = solverBusy;
}

/** Both buttons ask the same worker the same question; only what they do with the
 *  answer differs. The guards are shared so they can't come to disagree about which
 *  boards are answerable, and one flag keeps them from running two searches at once.
 *
 *  `handle` returns the line to show, and runs only when the answer is still about the
 *  board on screen. */
function askSolver(what: "verdict" | "hint", handle: (r: SolveResponse) => string): void {
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
      what === "hint"
        ? "🤔 Can't suggest a move on a board with ✦ stacks or easy mode — their rules differ."
        : "🤔 Can't analyse a board with ✦ stacks or easy mode — their rules differ.",
    );
    return;
  }

  solverBusy = true;
  syncSolverButtons();
  showToast(what === "hint" ? "💡 Looking for a move…" : "🔍 Looking for a way to win…", 60_000);

  const worker = getSolverWorker();
  const done = (message: string): void => {
    solverBusy = false;
    syncSolverButtons();
    showToast(message);
  };
  const askedAbout = boardVersion;
  worker.onmessage = (e: MessageEvent<SolveResponse>) => {
    if (boardVersion !== askedAbout) {
      done(`🤔 The board changed while I was looking — press ${what === "hint" ? "💡" : "🔍"} again.`);
      return;
    }
    done(handle(e.data));
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
    wantMove: what === "hint",
  };
  worker.postMessage(request);
}

function analysePosition(): void {
  askSolver("verdict", (r) => VERDICT[r.outcome]);
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
function requestHint(): void {
  askSolver("hint", (r) => {
    if (r.outcome !== "solved" || !r.next) return NO_HINT[r.outcome];
    hint = { move: r.next, version: boardVersion };
    invalidate();
    return `💡 Try: ${describeHint(game, r.next.from, r.next.fromIndex, r.next.to)}.`;
  });
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

// Whether the bar fits on one row is a function of its width, so re-ask on resize
// (and on orientation change, which fires the same event). Unlike the board, this only
// measures the toolbar — and the height it may change feeds the canvas observer, which
// is debounced.
window.addEventListener("resize", updateChromeToggle);

// The canvas ResizeObserver is the main signal; these cover the mobile cases where the
// viewport settles in stages after a rotation and the observer has already fired.
window.addEventListener("resize", scheduleResize);
window.addEventListener("orientationchange", scheduleResize);
window.visualViewport?.addEventListener("resize", scheduleResize);

el.newGame.addEventListener("click", newGame);
el.undo.addEventListener("click", doUndo);
el.redo.addEventListener("click", doRedo);
el.restart.addEventListener("click", restartDeal);
el.analyse.addEventListener("click", analysePosition);
el.hint.addEventListener("click", requestHint);
el.winnable.addEventListener("click", newWinnableGame);
el.hand.addEventListener("click", toggleHand);
el.daily.addEventListener("click", playDaily);
el.stats.addEventListener("click", openStats);
el.statsClose.addEventListener("click", closeStats);
el.statsList.addEventListener("click", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLButtonElement>(".archive-day");
  if (!cell?.dataset.day) return;
  closeStats();
  playArchivedDay(cell.dataset.day);
});
el.statsReset.addEventListener("click", armOrResetStats);
// A click on the backdrop — not the panel — dismisses it, as a modal should.
el.statsOverlay.addEventListener("click", (e) => {
  if (e.target === el.statsOverlay) closeStats();
});
el.winNew.addEventListener("click", newGame);
el.winRestart.addEventListener("click", restartDeal);
el.winShare.addEventListener("click", copyWinResult);
el.theme.addEventListener("click", toggleTheme);
el.chrome.addEventListener("click", toggleChrome);
el.sound.addEventListener("click", toggleSound);
el.startMute.addEventListener("click", toggleSound);
el.easy.addEventListener("click", toggleEasy);
el.addStack.addEventListener("click", addTempStack);
el.drawToggle.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (btn) {
    setDrawCount(Number(btn.dataset.draw) as DrawCount);
    persist();
    syncDealUrl(); // the mode is part of what a shared link means
  }
});

/** Arrow keys, Space and Enter belong to the board — but not while a dialog is up,
 *  where they are the browser's for moving between and pressing buttons. */
function boardHasKeys(): boolean {
  return !!el.statsOverlay.hidden && !!el.winOverlay.hidden;
}

/** The statistics dialog is modal, so while it is open *no* board shortcut fires —
 *  not the single letters and not Ctrl+Z either. `boardHasKeys` alone used to gate
 *  only the arrows, Space, F and the digits, so `n` behind an open dialog dealt a new
 *  game and left the panel sitting over it reporting the record of the game it had
 *  just abandoned.
 *
 *  The win panel is deliberately *not* modal — the cascade plays on behind it and the
 *  toolbar stays live — so the shortcuts keep working there, exactly as they did. */
function modalOpen(): boolean {
  return !el.statsOverlay.hidden;
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

const ARROWS: Record<string, CursorMove> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

window.addEventListener("keydown", (e) => {
  if (!started) return; // the start overlay owns the board until it's dismissed
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === "Escape") {
    if (!el.statsOverlay.hidden) closeStats();
    else if (held) releaseHeld("put down");
    else input.cancelDrag();
    return;
  }
  // Escape is checked first, since closing the dialog is the one board key it owns.
  if (modalOpen()) return;

  // ---- keyboard play ----
  if (!mod && !e.altKey && boardHasKeys()) {
    const arrow = ARROWS[e.key];
    if (arrow) {
      e.preventDefault();
      // Shift turns up/down into "take more / fewer cards with me", which is a
      // different question from "which pile", and needs its own gesture.
      navigate(e.shiftKey && (arrow === "up" || arrow === "down")
        ? (arrow === "up" ? "deeper" : "shallower")
        : arrow);
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (focusOwnsActivation()) return; // let the focused button take it
      e.preventDefault();
      activateCursor();
      return;
    }
    if (key === "f") {
      sendToFoundation();
      return;
    }
    if (key >= "1" && key <= "7") {
      jumpToColumn(Number(key) - 1);
      return;
    }
  }
  if (mod && key === "z") {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
  } else if (mod && key === "y") {
    e.preventDefault(); // the Windows convention for redo
    doRedo();
  } else if (mod || e.altKey) {
    // Leave browser shortcuts alone — Cmd+N used to also deal a new game.
  } else if (key === "n") {
    newGame();
  } else if (key === "d") {
    playDaily();
  } else if (key === "h") {
    requestHint();
  } else if (key === "w") {
    newWinnableGame();
  } else if (key === "t") {
    toggleChrome();
  }
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
// ?theme= wins over the saved preference; anything unrecognised — a hand-edited
// value, or a theme that existed in an older build — falls back rather than breaking.
const urlTheme = new URLSearchParams(location.search).get("theme");
const savedTheme = isThemeName(urlTheme) ? urlTheme : readItem("solitaire-theme");
applyTheme(isThemeName(savedTheme) ? savedTheme : "dark");
applySound(readItem("solitaire-sound") !== "off");
// Before resize(), so the board is measured against the bar the user left behind.
applyChrome(readItem("solitaire-chrome") === "hidden");
applyHand(readItem("solitaire-hand") === "left");

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
  resuming = true;
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

// The opening deal waits for a click so its sound can play (browsers block
// audio until the first user gesture). Clicking unlocks audio, then deals.
const startOverlay = document.getElementById("start-overlay") as HTMLElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const startNew = document.getElementById("start-new") as HTMLButtonElement;
const startTitle = startOverlay.querySelector(".start-title") as HTMLElement;
const startTip = startOverlay.querySelector(".start-tip") as HTMLElement;

/** Fill in the challenge card and turn the start button into the invitation. The
 *  board it names is `game`'s, not the link's numbers: the deal has already been laid
 *  out from `?deal=`, so what the card describes is what pressing the button plays —
 *  including whether it is a daily, which comes from the seed rather than the URL. */
function showChallenge(r: SharedResult): void {
  const chall = document.getElementById("challenge") as HTMLElement;
  (document.getElementById("challenge-score") as HTMLElement).textContent = String(r.score);
  (document.getElementById("challenge-time") as HTMLElement).textContent = formatClock(r.elapsedMs);
  (document.getElementById("challenge-moves") as HTMLElement).textContent = String(r.moves);
  (document.getElementById("challenge-deal") as HTMLElement).textContent = boardLine({
    code: encodeSeed(game.seed),
    drawCount: game.drawCount,
    dailyKey: dailyDayForSeed(game.seed, todayKey()),
    todayKey: todayKey(),
  });
  chall.hidden = false;
  startTitle.textContent = `Can you beat ${r.score}?`;
  startTip.textContent =
    "The same deal, dealt the same way. Every move costs a point, so a tidy win scores higher than a long one.";
  startNew.hidden = false; // declining the challenge is a normal thing to want
}

if (challenge) showChallenge(challenge);

// Resume wins the button over the challenge when both apply — this board is already
// on the go, and dealing it again would bin the progress. The card stays up: it is
// still the score to beat.
if (resuming) {
  startTitle.textContent = "Resume game";
  startTip.textContent = `Game in progress — ${game.moves} moves, ${game.score} points. Your recent moves can still be undone.`;
  startNew.hidden = false;
}

/** What the overlay's buttons ask for: pick the restored board back up, reveal the one
 *  already dealt behind the overlay (a fresh boot, or an accepted challenge), or throw
 *  that away for a new deal. */
type StartChoice = "resume" | "reveal" | "fresh";

function dismissStartOverlay(choice: StartChoice): void {
  unlockAudio();
  started = true;
  startOverlay.classList.add("is-hiding");
  setTimeout(() => startOverlay.remove(), 400);
  if (choice === "fresh") {
    newGame(); // deals a new seed and discards any save
    return;
  }
  if (choice === "reveal") {
    startDeal();
    return;
  }
  resuming = false;
  animator.clear(); // reveals the restored board; startDeal() assumes a fresh pyramid
  invalidate();
  if (game.moves > 0 && !game.isWon()) timerStart = performance.now();
  updateStats();
  pendingCheck = true; // a restored board may already be won or auto-completable
}

startBtn.addEventListener("click", () => dismissStartOverlay(resuming ? "resume" : "reveal"));
startNew.addEventListener("click", () => dismissStartOverlay("fresh"));

// Capture think-time since the last move, and act as a backstop for tab eviction.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});
