// A short vibration alongside the card sounds, on devices that have one. Android
// Chrome does; iOS Safari and every desktop leave `navigator.vibrate` undefined, so
// there this is a no-op rather than an error.
//
// It rides on the sound toggle rather than having one of its own: the toolbar has no
// width to spare, and 🔇 already means "stop this device reacting to my moves". The
// pulses are kept to a few milliseconds — a tick you feel, not a buzz you hear — and
// the deal's 28 ticks are deliberately left silent, since a phone rattling through
// the whole deal is the one thing this must not do.

export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* refused without a user gesture, or blocked by policy: haptics are a bonus */
  }
}
