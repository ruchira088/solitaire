// The four things a player sets once and keeps: theme, sound, whether the toolbar is
// folded away, and which side the portrait rail sits on. Each is a button that
// reflects its state, a saved value, and — for the last two — a layout consequence.
// None of it touches the game, so it lives apart from main.ts; the two things it
// needs from the board come in as callbacks.

import { isSoundEnabled, setSoundEnabled } from "./sound";
import { readItem, writeItem } from "./storage";
import {
  AUTO_ICON,
  getFelt,
  isThemePref,
  nextThemePref,
  resolveTheme,
  setTheme,
  themePrefLabel,
  ThemePref,
} from "./theme";
import { setTip } from "./tooltip";

export interface PreferenceDeps {
  /** The canvas must repaint: the theme changed the felt, backs and placeholders. */
  repaint: () => void;
  /** The rail moved sides: rebuild the layout and drop anything measured against it. */
  handChanged: () => void;
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Preferences {
  private readonly themeBtn = byId<HTMLButtonElement>("btn-theme");
  private readonly soundBtn = byId<HTMLButtonElement>("btn-sound");
  private readonly startMute = byId<HTMLButtonElement>("start-mute");
  private readonly chromeBtn = byId<HTMLButtonElement>("btn-chrome");
  private readonly handBtn = byId<HTMLButtonElement>("btn-hand");
  private readonly toolbar = byId("toolbar");
  private readonly controls = document.querySelector(".controls") as HTMLElement;
  /** The OS colour scheme, watched so "Auto" follows it live — the same pattern as
   *  reduced motion in main.ts, and for the same reason: changing the OS setting
   *  shouldn't need a reload. */
  private readonly prefersLight = window.matchMedia("(prefers-color-scheme: light)");
  private themePref: ThemePref = "auto";
  private chromeHidden = false; // toolbar folded down to its toggle
  /** Portrait only: which edge the stock/waste/foundation rail sits on. The hand
   *  holding a phone covers the side it's on, and the stock is the pile you tap most. */
  leftHanded = false;

  constructor(private deps: PreferenceDeps) {
    this.themeBtn.addEventListener("click", () => this.toggleTheme());
    this.soundBtn.addEventListener("click", () => this.toggleSound());
    this.startMute.addEventListener("click", () => this.toggleSound());
    this.chromeBtn.addEventListener("click", () => this.toggleChrome());
    this.handBtn.addEventListener("click", () => this.applyHand(!this.leftHanded));
    this.prefersLight.addEventListener("change", () => {
      if (this.themePref === "auto") this.applyTheme("auto");
    });
    // Whether the bar fits on one row is a function of its width, so re-ask on resize
    // (and on orientation change, which fires the same event). This only measures the
    // toolbar — the height it may change feeds the canvas observer, which is debounced.
    window.addEventListener("resize", () => this.updateChromeToggle());
  }

  /** Restore everything saved. The order matters: the toolbar before the hand, since
   *  the hand rebuilds the board and it must be measured against the bar the player
   *  left behind. `?theme=` wins over the saved theme, and anything unrecognised — a
   *  hand-edited value, or a theme from an older build — falls back to "auto", which
   *  is also the default for anyone who has never chosen. */
  load(): void {
    const urlTheme = new URLSearchParams(location.search).get("theme");
    const savedTheme = isThemePref(urlTheme) ? urlTheme : readItem("solitaire-theme");
    this.applyTheme(isThemePref(savedTheme) ? savedTheme : "auto");
    this.applySound(readItem("solitaire-sound") !== "off");
    this.applyChrome(readItem("solitaire-chrome") === "hidden");
    this.applyHand(readItem("solitaire-hand") === "left");
  }

  applyTheme(pref: ThemePref): void {
    this.themePref = pref;
    const name = resolveTheme(pref, this.prefersLight.matches);
    setTheme(name);
    this.deps.repaint();
    // One attribute rather than a class per theme: CSS keys its chrome palette off it,
    // and adding a theme can't leave a stale class behind.
    document.body.dataset.theme = name;
    // The button shows where you are and says where you'd go, since with more than two
    // themes the icon alone can no longer imply the destination.
    this.themeBtn.textContent = pref === "auto" ? AUTO_ICON : getFelt().icon;
    const here = pref === "auto" ? `Auto (${getFelt().label})` : getFelt().label;
    const label = `Theme: ${here} — click for ${themePrefLabel(nextThemePref(pref))}`;
    setTip(this.themeBtn, label);
    this.themeBtn.setAttribute("aria-label", label);
    writeItem("solitaire-theme", pref);
  }

  toggleTheme(): void {
    this.applyTheme(nextThemePref(this.themePref));
  }

  applySound(on: boolean): void {
    setSoundEnabled(on);
    const icon = on ? "🔊" : "🔇";
    const title = on ? "Mute sound and vibration" : "Unmute sound and vibration";
    for (const btn of [this.soundBtn, this.startMute]) {
      btn.textContent = icon;
      setTip(btn, title);
    }
    writeItem("solitaire-sound", on ? "on" : "off");
  }

  toggleSound(): void {
    this.applySound(!isSoundEnabled());
  }

  /** Publish the toolbar's height, which is what the win panel centres below. Kept
   *  beside the toggle measurement because the same events change both: a window
   *  resize can rewrap the bar, and folding it changes its height outright. */
  syncBarHeight(): void {
    document.body.style.setProperty("--bar-h", `${this.toolbar.offsetHeight}px`);
  }

  /** The ☰ only earns its place when the buttons and the stats can't share one row.
   *  Measured with the button in flow, so its own width counts and the answer can't
   *  oscillate: a bar that fits *with* the toggle still fits once it's out. While the
   *  bar is folded away the toggle always shows — it's the only way back. */
  updateChromeToggle(): void {
    this.syncBarHeight();
    if (this.chromeHidden) {
      this.toolbar.classList.add("needs-toggle");
      return;
    }
    this.toolbar.classList.add("is-measuring");
    const fits = isSingleRow(this.toolbar) && isSingleRow(this.controls);
    this.toolbar.classList.remove("is-measuring");
    this.toolbar.classList.toggle("needs-toggle", !fits);
  }

  /** Fold the buttons away, handing the reclaimed height to the board — the
   *  ResizeObserver on the canvas re-lays the piles out by itself. The glyph stays a
   *  hamburger in both states: an ✕ on a game reads as "quit", and the bar being there
   *  or not is state enough (aria-expanded says so too). */
  applyChrome(hidden: boolean): void {
    this.chromeHidden = hidden;
    document.body.classList.toggle("chrome-hidden", hidden);
    const label = hidden ? "Show the toolbar" : "Hide the toolbar";
    setTip(this.chromeBtn, `${label} (T)`);
    this.chromeBtn.setAttribute("aria-label", label);
    this.chromeBtn.setAttribute("aria-expanded", hidden ? "false" : "true");
    writeItem("solitaire-chrome", hidden ? "hidden" : "shown");
    this.updateChromeToggle();
  }

  toggleChrome(): void {
    this.applyChrome(!this.chromeHidden);
  }

  /** Which side the portrait rail sits on. A preference rather than a per-game
   *  setting: which hand you hold the phone in doesn't change between deals. */
  applyHand(left: boolean): void {
    this.leftHanded = left;
    const label = left ? "Rail on the right" : "Rail on the left";
    setTip(this.handBtn, `${label} — click to switch sides`);
    this.handBtn.setAttribute("aria-label", label);
    this.handBtn.setAttribute("aria-pressed", left ? "true" : "false");
    writeItem("solitaire-hand", left ? "left" : "right");
    this.deps.handChanged();
  }
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
