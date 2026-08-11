// A small tween engine plus a card-flight system. Card flights let the renderer
// draw a card "in the air" between piles while the game model has already been
// updated, which keeps logic and visuals cleanly separated.

import { Card } from "./cards";
import { Point } from "./layout";

export type Easing = (t: number) => number;

export const Easings = {
  linear: (t: number) => t,
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface Flight {
  card: Card;
  from: Point;
  to: Point;
  startScale: number;
  endScale: number;
  /** Animate a face flip (back -> face) across the flight when true. */
  flip: boolean;
  /** Whether the card currently shows its face (drives flip rendering). */
  faceShown: boolean;
  start: number;
  duration: number;
  easing: Easing;
  pos: Point;
  scale: number;
  /** Horizontal squeeze used to render a flip (1 = flat-on, 0 = edge-on). */
  flipX: number;
  done: boolean;
  onDone?: () => void;
}

interface Tween {
  start: number;
  duration: number;
  delay: number;
  easing: Easing;
  onUpdate?: (eased: number, t: number) => void;
  onDone?: () => void;
  done: boolean;
}

export interface FlightOptions {
  duration?: number;
  delay?: number;
  easing?: Easing;
  startScale?: number;
  endScale?: number;
  flip?: boolean;
  /** Initial face state (defaults to the card's faceUp). */
  faceShown?: boolean;
  onDone?: () => void;
}

export class Animator {
  private flights: Flight[] = [];
  private tweens: Tween[] = [];
  private flyingIds = new Set<number>();
  private now = 0;

  setNow(now: number): void {
    this.now = now;
  }

  isAnimating(): boolean {
    return this.flights.length > 0 || this.tweens.length > 0;
  }

  isFlying(cardId: number): boolean {
    return this.flyingIds.has(cardId);
  }

  /** Mark cards as hidden without animating them. Used to keep the dealt cards
   *  off-screen until the opening deal begins (they have no active flight, so
   *  the renderer skips them entirely). Cleared by `clear()`. */
  hideCards(ids: number[]): void {
    for (const id of ids) this.flyingIds.add(id);
  }

  activeFlights(): Flight[] {
    return this.flights;
  }

  /** Animate a single card from `from` to `to`. The flight begins at the next
   *  update tick relative to `delay`. */
  flyCard(card: Card, from: Point, to: Point, opts: FlightOptions = {}): void {
    const flight: Flight = {
      card,
      from,
      to,
      startScale: opts.startScale ?? 1,
      endScale: opts.endScale ?? 1,
      flip: opts.flip ?? false,
      faceShown: opts.faceShown ?? card.faceUp,
      start: this.now + (opts.delay ?? 0),
      duration: opts.duration ?? 280,
      easing: opts.easing ?? Easings.easeOutCubic,
      pos: { x: from.x, y: from.y },
      scale: opts.startScale ?? 1,
      flipX: 1,
      done: false,
      onDone: opts.onDone,
    };
    this.flights.push(flight);
    this.flyingIds.add(card.id);
  }

  /** Generic value tween for sequencing and timed callbacks. */
  tween(opts: {
    duration: number;
    delay?: number;
    easing?: Easing;
    onUpdate?: (eased: number, t: number) => void;
    onDone?: () => void;
  }): void {
    this.tweens.push({
      start: this.now + (opts.delay ?? 0),
      duration: opts.duration,
      delay: opts.delay ?? 0,
      easing: opts.easing ?? Easings.linear,
      onUpdate: opts.onUpdate,
      onDone: opts.onDone,
      done: false,
    });
  }

  /** Fire a callback after `ms`, integrated with the animation clock. */
  delay(ms: number, cb: () => void): void {
    this.tween({ duration: ms, onDone: cb });
  }

  clear(): void {
    this.flights = [];
    this.tweens = [];
    this.flyingIds.clear();
  }

  update(now: number): void {
    this.now = now;

    for (const f of this.flights) {
      if (now < f.start) continue;
      const t = f.duration <= 0 ? 1 : Math.min(1, (now - f.start) / f.duration);
      const e = f.easing(t);
      f.pos.x = lerp(f.from.x, f.to.x, e);
      f.pos.y = lerp(f.from.y, f.to.y, e);
      f.scale = lerp(f.startScale, f.endScale, e);
      if (f.flip) {
        f.flipX = Math.abs(Math.cos(t * Math.PI));
        f.faceShown = t >= 0.5;
      }
      if (t >= 1) f.done = true;
    }

    for (const tw of this.tweens) {
      if (now < tw.start) continue;
      const t = tw.duration <= 0 ? 1 : Math.min(1, (now - tw.start) / tw.duration);
      tw.onUpdate?.(tw.easing(t), t);
      if (t >= 1) tw.done = true;
    }

    // Resolve finished animations (fire callbacks once).
    if (this.flights.some((f) => f.done)) {
      const finished = this.flights.filter((f) => f.done);
      this.flights = this.flights.filter((f) => !f.done);
      for (const f of finished) {
        this.flyingIds.delete(f.card.id);
        f.onDone?.();
      }
    }
    if (this.tweens.some((t) => t.done)) {
      const finished = this.tweens.filter((t) => t.done);
      this.tweens = this.tweens.filter((t) => !t.done);
      for (const t of finished) t.onDone?.();
    }
  }
}

// ---- Win celebration (classic bouncing-card cascade) ---------------------

interface FallingCard {
  card: Card;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians, and how much it turns per frame — cards tumble as they fall so a wall
   *  of parallel rectangles never forms. */
  angle: number;
  spin: number;
}

/** A scrap of confetti or a firework spark. Short-lived, unlike the cards. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Frames remaining, and the total, so alpha can fade over the life. */
  life: number;
  maxLife: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
  /** Ribbons tumble and catch the light; sparks are round and just fade. */
  ribbon: boolean;
}

/** The win cascade.
 *
 *  Three things happen at once, on purpose. The cards launch **one at a time** rather
 *  than all together — the classic behaviour, and it lets the screen fill in a rhythm
 *  instead of a single dump. They **tumble** as they fall, so a wall of parallel cards
 *  never forms. And fireworks keep going off behind them, which is what makes it read
 *  as a celebration rather than a physics demo.
 *
 *  The canvas is deliberately never cleared while this runs (see `runCelebrationFrame`),
 *  so everything here paints trails — which is why sparks look like streaks and why the
 *  board slowly fills. That is the iconic look and worth keeping. */
export class Celebration {
  private cards: FallingCard[] = [];
  /** Cards still waiting their turn to launch. */
  private pending: FallingCard[] = [];
  private particles: Particle[] = [];
  private gravity = 0.45;
  private bounce = 0.82;
  private frame = 0;
  /** Confetti and fireworks. Off under prefers-reduced-motion, where the plain
   *  cascade is celebration enough. */
  private extras = true;
  active = false;

  /** One card every few frames: fast enough to feel eager, slow enough to see. */
  private static readonly LAUNCH_EVERY = 3;
  private static readonly FIREWORK_EVERY = 34;
  private static readonly MAX_PARTICLES = 420;

  start(seeds: { card: Card; x: number; y: number }[], opts: { extras?: boolean } = {}): void {
    this.active = true;
    this.extras = opts.extras ?? true;
    this.frame = 0;
    this.cards = [];
    this.particles = [];
    // Top of each foundation first, so the piles visibly unstack.
    this.pending = seeds
      .map((s, i) => ({
        card: s.card,
        x: s.x,
        y: s.y,
        vx: (i % 2 === 0 ? -1 : 1) * (2 + Math.random() * 4),
        vy: -(4 + Math.random() * 7),
        angle: 0,
        spin: (Math.random() - 0.5) * 0.22,
      }))
      .reverse();
  }

  stop(): void {
    this.active = false;
    this.cards = [];
    this.pending = [];
    this.particles = [];
  }

  /** A burst of sparks. Used for the opening flourish and for each firework. */
  private burst(x: number, y: number, count: number, colors: string[], speed: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= Celebration.MAX_PARTICLES) return;
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const v = speed * (0.45 + Math.random() * 0.75);
      const life = 34 + Math.floor(Math.random() * 30);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life,
        maxLife: life,
        size: 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        ribbon: Math.random() < 0.45,
      });
    }
  }

  /** The opening flourish: a burst over each foundation as the sweep finishes. */
  openingBurst(points: { x: number; y: number }[], cardW: number, cardH: number): void {
    if (!this.extras) return;
    for (const p of points) {
      this.burst(p.x + cardW / 2, p.y + cardH / 2, 22, CONFETTI, 6);
    }
  }

  /** Advance one frame. Returns what to draw: cards first, then particles on top. */
  step(
    width: number,
    height: number,
    cardW: number,
    cardH: number,
  ): { cards: FallingCard[]; particles: Particle[] } {
    this.frame++;

    if (this.pending.length && this.frame % Celebration.LAUNCH_EVERY === 0) {
      this.cards.push(this.pending.pop()!);
    }

    for (const c of this.cards) {
      c.vy += this.gravity;
      c.x += c.vx;
      c.y += c.vy;
      c.angle += c.spin;
      if (c.y + cardH > height) {
        c.y = height - cardH;
        c.vy = -c.vy * this.bounce;
        c.vx *= 0.98;
        c.spin *= 0.7; // a bounce scrubs off some tumble
        if (Math.abs(c.vy) < 1.5) c.vy = -(6 + Math.random() * 6);
        if (this.extras) this.burst(c.x + cardW / 2, height, 4, SPARKS, 3);
      }
      if (c.x + cardW < 0 || c.x > width) {
        // Respawn from a foundation-like position once it leaves the screen.
        c.x = width * (0.55 + Math.random() * 0.4);
        c.y = -cardH;
        c.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4);
        c.vy = -(2 + Math.random() * 4);
        c.spin = (Math.random() - 0.5) * 0.22;
      }
    }

    if (this.extras && this.frame % Celebration.FIREWORK_EVERY === 0) {
      this.burst(
        width * (0.12 + Math.random() * 0.76),
        height * (0.12 + Math.random() * 0.45),
        26,
        CONFETTI,
        7,
      );
    }

    for (const p of this.particles) {
      p.vy += 0.12; // lighter than the cards: confetti drifts
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < height + 20);

    return { cards: this.cards, particles: this.particles };
  }
}

/** Festive, and deliberately not the felt's greens — confetti has to read as thrown
 *  over the table rather than part of it. */
const CONFETTI = ["#ffd34e", "#ff5d6c", "#7ee0ff", "#b98cff", "#fdfdf7", "#6ef0a5"];
/** Struck off the floor by a bouncing card: warm and brief. */
const SPARKS = ["#ffd34e", "#fff3c4", "#ffb14e"];
