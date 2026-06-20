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
}

export class Celebration {
  private cards: FallingCard[] = [];
  private gravity = 0.45;
  private bounce = 0.82;
  active = false;

  start(seeds: { card: Card; x: number; y: number }[]): void {
    this.active = true;
    this.cards = seeds.map((s, i) => ({
      card: s.card,
      x: s.x,
      y: s.y,
      vx: (i % 2 === 0 ? -1 : 1) * (2 + Math.random() * 4),
      vy: -(4 + Math.random() * 7),
    }));
  }

  stop(): void {
    this.active = false;
    this.cards = [];
  }

  /** Advance the physics one frame; returns the cards to draw (with trails). */
  step(width: number, height: number, cardW: number, cardH: number): FallingCard[] {
    for (const c of this.cards) {
      c.vy += this.gravity;
      c.x += c.vx;
      c.y += c.vy;
      if (c.y + cardH > height) {
        c.y = height - cardH;
        c.vy = -c.vy * this.bounce;
        c.vx *= 0.98;
        if (Math.abs(c.vy) < 1.5) c.vy = -(6 + Math.random() * 6);
      }
      if (c.x + cardW < 0 || c.x > width) {
        // Respawn from a foundation-like position once it leaves the screen.
        c.x = width * (0.55 + Math.random() * 0.4);
        c.y = -cardH;
        c.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4);
        c.vy = -(2 + Math.random() * 4);
      }
    }
    return this.cards;
  }
}
