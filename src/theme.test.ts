// The theme preference: what "auto" paints as, and the order the button cycles.

import { describe, expect, it } from "vitest";
import { isThemePref, nextThemePref, resolveTheme, THEME_NAMES, ThemePref } from "./theme";

describe("resolveTheme", () => {
  it("follows the OS when the preference is auto", () => {
    expect(resolveTheme("auto", true)).toBe("light");
    expect(resolveTheme("auto", false)).toBe("dark");
  });

  it("ignores the OS for a chosen theme", () => {
    expect(resolveTheme("claret", true)).toBe("claret");
    expect(resolveTheme("light", false)).toBe("light");
  });
});

describe("nextThemePref", () => {
  it("visits auto and every theme exactly once before coming round", () => {
    const seen: ThemePref[] = [];
    let p: ThemePref = "auto";
    do {
      seen.push(p);
      p = nextThemePref(p);
    } while (p !== "auto" && seen.length < 50);
    expect(seen).toEqual(["auto", ...THEME_NAMES]);
  });
});

describe("isThemePref", () => {
  it.each(["auto", "dark", "parchment"])("accepts %p", (v) => {
    expect(isThemePref(v)).toBe(true);
  });

  it.each(["Auto", "system", "", null, 1, "toString"])("rejects %p", (v) => {
    expect(isThemePref(v)).toBe(false);
  });
});
