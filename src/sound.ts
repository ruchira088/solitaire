// Lightweight card sound effects synthesized with the Web Audio API — no
// asset files needed. Each sound is a short filtered noise burst that evokes
// a card sliding / flicking. The AudioContext is created lazily on the first
// user gesture (browsers block audio until then).

let ctx: AudioContext | null = null;
let enabled = true;

function ensureCtx(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Resume if the browser auto-suspended it (e.g. after losing focus).
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A short burst of band-passed white noise — the "shuffle/slide" texture. */
function noiseBurst(
  ac: AudioContext,
  opts: { duration: number; freq: number; q: number; gain: number; delay?: number },
): void {
  const { duration, freq, q, gain, delay = 0 } = opts;
  const t0 = ac.currentTime + delay;
  const frames = Math.floor(ac.sampleRate * duration);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Deterministic pseudo-noise (avoids Math.random; sounds identical anyway).
    data[i] = Math.sin(i * 12.9898) * 43758.5453;
    data[i] -= Math.floor(data[i]);
    data[i] = data[i] * 2 - 1;
  }

  const src = ac.createBufferSource();
  src.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;

  const env = ac.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  src.connect(filter);
  filter.connect(env);
  env.connect(ac.destination);
  src.start(t0);
  src.stop(t0 + duration);
}

/** Card drawn from the stock — a crisp flick. */
export function playDraw(): void {
  const ac = ensureCtx();
  if (!ac) return;
  noiseBurst(ac, { duration: 0.12, freq: 1800, q: 0.8, gain: 0.18 });
}

/** Card placed onto a pile — a softer, lower "tap". */
export function playPlace(): void {
  const ac = ensureCtx();
  if (!ac) return;
  noiseBurst(ac, { duration: 0.1, freq: 1100, q: 0.7, gain: 0.14 });
}

/** Card flipped face-up — a light, high snap. */
export function playFlip(): void {
  const ac = ensureCtx();
  if (!ac) return;
  noiseBurst(ac, { duration: 0.08, freq: 2400, q: 1.0, gain: 0.12 });
}

/** Card dealt at the start — a quick, soft tick (one per card during the deal). */
export function playDeal(): void {
  const ac = ensureCtx();
  if (!ac) return;
  noiseBurst(ac, { duration: 0.07, freq: 1500, q: 0.9, gain: 0.1 });
}

/** Create / resume the AudioContext from within a user gesture so subsequent
 *  sounds (including the opening deal) are allowed to play. */
export function unlockAudio(): void {
  ensureCtx();
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function isSoundEnabled(): boolean {
  return enabled;
}
