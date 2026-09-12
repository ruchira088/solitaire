// Custom tooltips for the toolbar and dialog buttons, replacing the browser's
// `title` box. Text lives in `data-tip` — it must not stay in `title`, or the
// native tooltip appears alongside this one. One element serves every trigger,
// positioned with `fixed` coordinates so it can sit over the modal stats dialog
// and clear the toolbar's edges alike.

/** A tip split into its label and an optional trailing keyboard shortcut. */
export type Tip = { label: string; key: string | null };

/** Only a trailing "(T)" / "(Ctrl+Shift+Z)" is a shortcut; a date or a prose
 *  aside in parentheses stays part of the label. */
const SHORTCUT = /^(.*\S)\s+\(((?:Ctrl\+|Shift\+|Alt\+)*[A-Z0-9])\)$/;

export function parseTip(text: string): Tip {
  const m = SHORTCUT.exec(text);
  return m ? { label: m[1], key: m[2] } : { label: text, key: null };
}

/** The one writer for a trigger's tip, so no caller can reach for `.title`. */
export function setTip(el: HTMLElement, text: string): void {
  el.dataset.tip = text;
}

/** Hover waits this long, as the native tooltip does; once one tip is up, moving
 *  to the next trigger shows it at once, and this is how long that stays true. */
const SHOW_DELAY = 350;
const WARM_FOR = 250;
const GAP = 8;
const MARGIN = 6;

export function initTooltips(): void {
  const tip = document.getElementById("tooltip");
  if (tip) attach(tip);
}

function attach(tip: HTMLElement): void {
  let current: HTMLElement | null = null;
  let showTimer = 0;
  let warmUntil = 0;

  const triggerOf = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? t.closest<HTMLElement>("[data-tip]") : null;

  function render(text: string): void {
    const { label, key } = parseTip(text);
    tip.textContent = label;
    if (key) {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      tip.appendChild(kbd);
    }
  }

  function place(anchor: HTMLElement): void {
    const a = anchor.getBoundingClientRect();
    tip.style.left = "0px"; // a stale left near the right edge would squash the measure
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // Centred under the trigger, clamped to the viewport; above it when the
    // bottom edge is closer than the tip is tall.
    const x = Math.min(
      Math.max(MARGIN, a.left + a.width / 2 - w / 2),
      window.innerWidth - w - MARGIN,
    );
    const below = a.bottom + GAP + h <= window.innerHeight - MARGIN;
    const y = below ? a.bottom + GAP : a.top - GAP - h;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    tip.classList.toggle("is-above", !below);
    // The arrow tracks the trigger even when the box has been pushed off-centre.
    tip.style.setProperty("--arrow-x", `${Math.round(a.left + a.width / 2 - x)}px`);
  }

  function show(anchor: HTMLElement): void {
    const text = anchor.dataset.tip;
    if (!text) return;
    current = anchor;
    render(text);
    tip.hidden = false;
    place(anchor);
    anchor.setAttribute("aria-describedby", "tooltip");
  }

  function hide(): void {
    window.clearTimeout(showTimer);
    showTimer = 0;
    if (!current) return;
    current.removeAttribute("aria-describedby");
    current = null;
    tip.hidden = true;
    warmUntil = performance.now() + WARM_FOR;
  }

  function schedule(anchor: HTMLElement, delay: number): void {
    if (anchor === current) return;
    hide();
    if (delay === 0 || performance.now() < warmUntil) {
      show(anchor);
      return;
    }
    showTimer = window.setTimeout(() => show(anchor), delay);
  }

  /** The pointer has left the trigger — but keyboard focus keeps a tip up. */
  function leave(): void {
    if (current?.matches(":focus-visible")) return;
    hide();
  }

  // A finger has nowhere to hover and a tap would leave the tip stuck, so only a
  // mouse or pen opens one. Delegated at the document, so the pointer landing
  // anywhere that isn't a trigger is what closes the tip; `pointerout` is only
  // needed for the pointer leaving the window, where nothing else fires.
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const anchor = triggerOf(e.target);
    if (anchor) schedule(anchor, SHOW_DELAY);
    else leave();
  });
  document.addEventListener("pointerout", (e) => {
    if (e.relatedTarget === null) leave();
  });
  // Keyboard focus shows at once — Tab-walking the toolbar reads each tip — but
  // not the focus a click leaves behind, which :focus-visible distinguishes.
  document.addEventListener("focusin", (e) => {
    const anchor = triggerOf(e.target);
    if (anchor?.matches(":focus-visible")) schedule(anchor, 0);
  });
  document.addEventListener("focusout", (e) => {
    if (triggerOf(e.target) === current) hide();
  });
  // Pressing the button is the answer to the question the tip asks.
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " " || e.key === "Enter") hide();
  }, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}
