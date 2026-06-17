// Bootstrap: canvas + HiDPI scaling, the game loop, the deal / auto-complete /
// win animations, and the toolbar wiring.

import "./styles.css";
import { Card } from "./cards";
import { DrawCount, Game, PileId } from "./game";
import { computeLayout, Layout } from "./layout";
import { Animator, Celebration, Easings } from "./animation";
import { HintHighlight, Renderer } from "./render";
import { Input } from "./input";
import { cardPos } from "./positions";
import { preloadFaceArt } from "./courtArt";
import { getThemeName, setTheme, ThemeName } from "./theme";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const game = new Game(3);
const animator = new Animator();
const renderer = new Renderer();
const celebration = new Celebration();

let layout: Layout = computeLayout(1, 1);
let dpr = 1;
let busy = false; // block input during the deal & celebration
let pendingCheck = false; // re-evaluate win / auto-complete once idle
let autoCompleting = false;
let hint: HintHighlight | null = null;
let hintTimer = 0;
let timerStart: number | null = null;
let elapsedFrozen = 0;
let celebStarted = false;

// ---- DPI-aware sizing ------------------------------------------------------

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(rect.width, rect.height);
}

const ro = new ResizeObserver(() => resize());
ro.observe(canvas);

// ---- Toolbar / stats -------------------------------------------------------

const el = {
  newGame: document.getElementById("btn-new") as HTMLButtonElement,
  undo: document.getElementById("btn-undo") as HTMLButtonElement,
  hint: document.getElementById("btn-hint") as HTMLButtonElement,
  drawToggle: document.getElementById("draw-toggle") as HTMLElement,
  theme: document.getElementById("btn-theme") as HTMLButtonElement,
  time: document.getElementById("stat-time") as HTMLElement,
  moves: document.getElementById("stat-moves") as HTMLElement,
  score: document.getElementById("stat-score") as HTMLElement,
};

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function updateStats(): void {
  el.moves.textContent = String(game.moves);
  el.score.textContent = String(game.score);
  el.undo.disabled = !game.canUndo() || busy;
}

// ---- Game loop -------------------------------------------------------------

function frame(now: number): void {
  animator.update(now);

  if (celebration.active) {
    runCelebrationFrame(now);
  } else {
    renderer.drawScene(ctx, game, layout, animator, input.drag, hint, now);
    if (pendingCheck && !animator.isAnimating() && !input.drag) {
      pendingCheck = false;
      evaluateBoard();
    }
  }

  // Live timer.
  if (timerStart !== null && !game.isWon()) {
    el.time.textContent = fmtTime(elapsedFrozen + (now - timerStart));
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
  celebration.start(seeds);
}

function runCelebrationFrame(now: number): void {
  if (!celebStarted) {
    // Draw the completed board once; subsequent frames leave trails.
    renderer.drawScene(ctx, game, layout, animator, null, null, now);
    celebStarted = true;
  }
  const falling = celebration.step(layout.width, layout.height, layout.cardW, layout.cardH);
  for (const f of falling) {
    f.card.faceUp = true;
    renderer.drawCard(ctx, f.card, f.x, f.y, layout, { flat: true });
  }
  drawWinBanner();
}

function drawWinBanner(): void {
  const w = layout.width;
  const cx = w / 2;
  const cy = layout.height * 0.18;
  const bw = Math.min(360, w * 0.7);
  const bh = 76;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(8,40,26,0.9)";
  ctx.strokeStyle = "rgba(255,211,78,0.9)";
  ctx.lineWidth = 2;
  const x = cx - bw / 2;
  const y = cy - bh / 2;
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + bw, y, x + bw, y + bh, r);
  ctx.arcTo(x + bw, y + bh, x, y + bh, r);
  ctx.arcTo(x, y + bh, x, y, r);
  ctx.arcTo(x, y, x + bw, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffe9a8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 30px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillText("You Win! 🎉", cx, cy - 6);
  ctx.font = "500 13px 'Helvetica Neue', Arial, sans-serif";
  ctx.fillStyle = "#bfe8d2";
  ctx.fillText("Press New Game to play again", cx, cy + 22);
  ctx.restore();
}

// ---- Deal animation --------------------------------------------------------

function startDeal(): void {
  busy = true;
  animator.clear();
  animator.setNow(performance.now());
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
      dealIndex++;
    }
  }
  animator.delay(dealIndex * stagger + 320, () => {
    busy = false;
    updateStats();
  });
}

// ---- Controller actions ----------------------------------------------------

function onChange(): void {
  clearHint();
  if (timerStart === null && elapsedFrozen === 0 && game.moves > 0) {
    timerStart = performance.now();
  }
  updateStats();
  pendingCheck = true;
}

function newGame(): void {
  celebration.stop();
  celebStarted = false;
  autoCompleting = false;
  animator.clear();
  clearHint();
  game.deal();
  timerStart = null;
  elapsedFrozen = 0;
  el.time.textContent = "0:00";
  updateStats();
  startDeal();
}

function doUndo(): void {
  if (busy || celebration.active) return;
  if (game.undo()) {
    animator.clear();
    clearHint();
    updateStats();
  }
}

function showHint(): void {
  if (busy || celebration.active) return;
  const h = game.findHint();
  if (!h) return;
  hint = { from: h.from, to: h.to, since: performance.now() };
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (hint = null), 2600);
}

function clearHint(): void {
  hint = null;
  window.clearTimeout(hintTimer);
}

function setDrawCount(n: DrawCount): void {
  game.drawCount = n;
  for (const btn of Array.from(el.drawToggle.querySelectorAll<HTMLButtonElement>(".seg-btn"))) {
    btn.classList.toggle("is-active", Number(btn.dataset.draw) === n);
  }
}

function applyTheme(name: ThemeName): void {
  setTheme(name);
  document.body.classList.toggle("theme-light", name === "light");
  el.theme.textContent = name === "light" ? "☀️" : "🌙";
  el.theme.title = name === "light" ? "Switch to dark theme" : "Switch to light theme";
  try {
    localStorage.setItem("solitaire-theme", name);
  } catch {
    /* storage may be unavailable */
  }
}

function toggleTheme(): void {
  applyTheme(getThemeName() === "dark" ? "light" : "dark");
}

// ---- Wire up ---------------------------------------------------------------

const input = new Input(canvas, game, animator, {
  layout: () => layout,
  busy: () => busy || celebration.active || autoCompleting,
  onChange,
});

el.newGame.addEventListener("click", newGame);
el.undo.addEventListener("click", doUndo);
el.hint.addEventListener("click", showHint);
el.theme.addEventListener("click", toggleTheme);
el.drawToggle.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (btn) setDrawCount(Number(btn.dataset.draw) as DrawCount);
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    doUndo();
  } else if (e.key.toLowerCase() === "n") {
    newGame();
  } else if (e.key.toLowerCase() === "h") {
    showHint();
  }
});

preloadFaceArt();
const savedTheme = (() => {
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (fromUrl === "light" || fromUrl === "dark") return fromUrl;
  try {
    return localStorage.getItem("solitaire-theme");
  } catch {
    return null;
  }
})();
applyTheme(savedTheme === "light" ? "light" : "dark");
resize();
updateStats();
startDeal();
requestAnimationFrame(frame);
