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
  recentDailyKeys,
} from "./rng";
import { formatClock, shareText } from "./share";
import { canAnalyse, Outcome } from "./solver";
import {
  clampCursor,
  Cursor,
  cardName,
  describe as describeCursor,
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
  layout = computeLayout(rect.width, rect.height, sparesShown);
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
  toolbar: document.getElementById("toolbar") as HTMLElement,
  controls: document.querySelector(".controls") as HTMLElement,
  time: document.getElementById("stat-time") as HTMLElement,
  moves: document.getElementById("stat-moves") as HTMLElement,
  score: document.getElementById("stat-score") as HTMLElement,
  restart: document.getElementById("btn-restart") as HTMLButtonElement,
  analyse: document.getElementById("btn-analyse") as HTMLButtonElement,
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

function updateStats(): void {
  el.moves.textContent = String(game.moves);
  el.score.textContent = String(game.score);
  el.undo.disabled = !game.canUndo() || busy;
  el.redo.disabled = !game.canRedo() || busy;
  el.addStack.disabled = busy || game.spares.length >= MAX_SPARES;
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
      renderer.drawScene(ctx, game, layout, animator, input.drag, cursorView());
      dirty = false;
    }
    // Outside the paint gate on purpose: the win and auto-complete sweep have to be
    // noticed on an idle board, which is exactly when nothing is being painted.
    if (pendingCheck && !animator.isAnimating() && !input.drag) {
      pendingCheck = false;
      evaluateBoard();
    }
  }

  // Live timer. DOM text, not canvas, so it costs nothing to keep current.
  if (timerStart !== null && !game.isWon()) {
    el.time.textContent = formatClock(elapsedFrozen + (now - timerStart));
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

/** Mirror Game.autoCompleteStep's selection so we can capture the source
 *  position before the move (needed for the fly animation). */
function nextAutoSource(): { from: PileId; index: number } | null {
  const sources: PileId[] = [];
  for (let i = 0; i < 7; i++) sources.push({ kind: "tableau", index: i });
  sources.push({ kind: "waste" });
  for (let i = 0; i < game.spares.length; i++) sources.push({ kind: "spare", index: i });
  for (const from of sources) {
    const pile = game.getPile(from);
    if (pile.length === 0) continue;
    const card = pile[pile.length - 1];
    if (game.foundationTargetFor(card) >= 0) {
      return { from, index: pile.length - 1 };
    }
  }
  return null;
}

function autoStep(): void {
  invalidate();
  const next = nextAutoSource();
  if (!next) {
    autoCompleting = false;
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
    autoCompleting = false;
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
  return shareText({
    score: game.score,
    moves: game.moves,
    elapsedMs: elapsedNow(),
    url: shareUrl(),
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

/** Durations for the stats list: minutes and seconds up to an hour, then hours and
 *  minutes, since a lifetime total runs long. A zero means it never happened. */
function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
}

/** The record, in two groups. Twelve rows in one list read as a wall, and the daily
 *  counters answer a different question from the lifetime ones — so they get their own
 *  heading rather than trailing off the bottom of the same column. */
function statGroups(s: Stats): { title: string; rows: [string, string][] }[] {
  const dash = (n: number): string => (n > 0 ? String(n) : "—");
  return [
    {
      title: "Games",
      rows: [
        ["Played", String(s.played)],
        ["Won", String(s.won)],
        ["Win rate", s.played === 0 ? "—" : `${Math.round((s.won / s.played) * 100)}%`],
        ["Current streak", String(s.streak)],
        ["Best streak", String(s.bestStreak)],
        ["Best score", dash(s.bestScore)],
        ["Fastest win", fmtDuration(s.fastestMs)],
        ["Fewest moves", dash(s.fewestMoves)],
        ["Time played", fmtDuration(s.totalMs)],
      ],
    },
    {
      title: "Daily deal",
      rows: [
        // The live streak, not the stored one: a run that lapsed reads as 0 here
        // without anything having to run at midnight to expire it.
        ["Current streak", String(currentDailyStreak(s, todayKey()))],
        ["Best streak", String(s.bestDailyStreak)],
        ["Dailies won", String(s.dailyWins)],
      ],
    },
  ];
}

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
  for (const group of statGroups(loadStats())) {
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

function openStats(): void {
  renderStats();
  disarmReset(); // a freshly opened dialog never opens half-way through a confirmation
  el.statsOverlay.hidden = false;
  el.statsClose.focus();
}

function closeStats(): void {
  el.statsOverlay.hidden = true;
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
  cursor = null;
  held = null;
  deal();
  applyEasy(false); // the assist doesn't carry over to the next game
  clearGame();
  syncSpareLayout();
  timerStart = null;
  elapsedFrozen = 0;
  el.time.textContent = "0:00";
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

function shareUrl(): string {
  const u = new URL(location.href);
  u.searchParams.set("deal", encodeSeed(game.seed));
  // Draw 1 is what you get with no parameter at all, so saying it adds nothing. The
  // delete branch earns its keep: it strips an inbound `?draw=1`, and clears `draw=3`
  // when the player switches back.
  if (game.drawCount === 3) u.searchParams.set("draw", "3");
  else u.searchParams.delete("draw");
  return u.toString();
}

/** Keep the deal code in the address bar. The board doesn't show it — the URL *is*
 *  the shareable thing — and this also keeps screenshots reproducible. */
function syncDealUrl(): void {
  try {
    history.replaceState(null, "", shareUrl());
  } catch {
    /* replaceState can throw on exotic origins; the game plays on regardless */
  }
}

function doUndo(): void {
  if (busy || celebration.active) return;
  if (game.undo()) afterTimeTravel();
}

function doRedo(): void {
  if (busy || celebration.active) return;
  if (game.redo()) {
    afterTimeTravel();
    // Unlike undo, redo can land back on a won or auto-completable board.
    pendingCheck = true;
  }
}

function afterTimeTravel(): void {
  invalidate();
  held = null; // the run it referred to may not exist in this position
  if (cursor) cursor = clampCursor(game, cursor);
  animator.clear();
  syncSpareLayout();
  updateStats();
  persist();
}

function setDrawCount(n: DrawCount): void {
  game.drawCount = n;
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
  if (busy || celebration.active || autoCompleting) return;
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
let analysing = false;

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

function analysePosition(): void {
  if (analysing) return;
  // Order matters: a won board is mid-celebration, so the busy guard below would
  // otherwise swallow the click and leave the button looking broken.
  if (game.isWon()) {
    showToast("✅ Already won.");
    return;
  }
  if (busy || celebration.active || autoCompleting) {
    showToast("⏳ Wait for the cards to settle.", 2500);
    return;
  }
  const state = game.serialize();
  if (!canAnalyse(state)) {
    showToast("🤔 Can't analyse a board with ✦ stacks or easy mode — their rules differ.");
    return;
  }

  analysing = true;
  el.analyse.disabled = true;
  showToast("🔍 Looking for a way to win…", 60_000);

  const worker = getSolverWorker();
  const done = (message: string): void => {
    analysing = false;
    el.analyse.disabled = false;
    showToast(message);
  };
  worker.onmessage = (e: MessageEvent<{ outcome: Outcome }>) => done(VERDICT[e.data.outcome]);
  worker.onerror = () => {
    // A worker that won't start shouldn't look like a verdict.
    solverWorker = null;
    done("🤔 Couldn't run the analysis.");
  };
  worker.postMessage({ state, maxNodes: 200_000 });
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
  const landing = game.getPile(to).length;
  const result = game.moveCards(from, fromIndex, to);
  if (!result) return false;
  syncSpareLayout(); // emptying a ✦ stack drops a column before we aim the flights
  result.moved.forEach((card, i) => {
    animator.flyCard(card, origins[i], cardPos(game, layout, to, landing + i), {
      duration: 160,
      easing: Easings.easeOutCubic,
    });
  });
  playPlace();
  if (result.flipped) playFlip();
  announce(describeMove(game, result.moved, to, result.flipped));
  onChange();
  return true;
}

/** Space / Enter: draw, pick up, or drop, depending on where the cursor is. */
function activateCursor(): void {
  if (busy || celebration.active || autoCompleting) return;
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
  if (busy || celebration.active || autoCompleting) return;
  const c = held ?? ensureCursor();
  const pile = game.getPile(c.pile);
  if (pile.length === 0) return;
  const card = pile[pile.length - 1];
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
  busy: () => busy || celebration.active || autoCompleting,
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

// Pick up a saved game if there is a valid one, replacing the constructor's fresh
// deal. This has to run before resize(), which sizes the board from the number of
// temp stacks, and before setDrawCount, which reflects the restored draw mode.
const params = new URLSearchParams(location.search);
const urlSeed = parseSeed(params.get("deal"));
const urlDraw = params.get("draw") === "3" ? 3 : params.get("draw") === "1" ? 1 : null;
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
el.time.textContent = formatClock(elapsedFrozen);
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

if (resuming) {
  (startOverlay.querySelector(".start-title") as HTMLElement).textContent = "Resume game";
  (startOverlay.querySelector(".start-tip") as HTMLElement).textContent =
    `Game in progress — ${game.moves} moves, ${game.score} points. Undo/redo history isn't kept across a reload.`;
  startNew.hidden = false;
}

function dismissStartOverlay(resume: boolean): void {
  unlockAudio();
  started = true;
  startOverlay.classList.add("is-hiding");
  setTimeout(() => startOverlay.remove(), 400);
  if (!resume) {
    // Deal fresh, discarding any save. Also covers the first-ever load, where the
    // constructor's deal is the one being revealed.
    if (resuming) newGame();
    else startDeal();
    return;
  }
  resuming = false;
  animator.clear(); // reveals the restored board; startDeal() assumes a fresh pyramid
  invalidate();
  if (game.moves > 0 && !game.isWon()) timerStart = performance.now();
  updateStats();
  pendingCheck = true; // a restored board may already be won or auto-completable
}

startBtn.addEventListener("click", () => dismissStartOverlay(resuming));
startNew.addEventListener("click", () => dismissStartOverlay(false));

// Capture think-time since the last move, and act as a backstop for tab eviction.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persist();
});
