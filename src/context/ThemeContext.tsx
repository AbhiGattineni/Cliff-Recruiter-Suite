// Light/dark theming.
//
// Three stored states, two rendered ones. `pref` is what the person chose —
// "light", "dark", or "system" if they have never chosen; `theme` is what that
// resolves to right now. The distinction matters: someone who has picked light
// must stay on light when their laptop flips to dark at sunset, and someone who
// has picked nothing should follow the laptop. A CSS media query alone cannot
// express that, which is why the resolved value is written to a `data-theme`
// attribute and the stylesheet keys off the attribute rather than off
// prefers-color-scheme.
//
// index.html does the same resolution inline, before first paint, so a
// light-preferring viewer never sees a dark frame flash by. This module must
// agree with that script — if the storage key or the resolution rule changes
// here, change it there too.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_KEY = "cliff.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The OS setting, or dark when the browser will not say. */
function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Storage can throw, not just come back empty — a private window, blocked site
 * data, or an embedded webview will raise on access rather than return null.
 * A theme preference is never worth taking the app down for, so every read and
 * write here is swallowed and the caller falls back to the system setting.
 */
function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function writePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Preference won't survive the reload. The session still themes correctly.
  }
}

/** Mobile browsers paint their address bar from this. */
const THEME_COLOR: Record<Theme, string> = { dark: "#0a0a14", light: "#f4f5f9" };

function apply(theme: Theme): void {
  const el = document.documentElement;
  el.setAttribute("data-theme", theme);
  // Tells the browser which way to paint scrollbars, form controls and the
  // overscroll gutter — the parts of the page the stylesheet cannot reach.
  el.style.colorScheme = theme;

  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[theme];
}

interface ThemeContextValue {
  /** What the person chose. "system" means they have not chosen. */
  pref: ThemePref;
  /** What that resolves to now — what is actually on screen. */
  theme: Theme;
  setPref: (pref: ThemePref) => void;
  /** Flip to the opposite of what is currently showing, and make it explicit. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<Theme>(() => {
    const p = readPref();
    return p === "system" ? systemTheme() : p;
  });

  // Follow the OS only while the choice is still "system".
  useEffect(() => {
    if (pref !== "system") {
      setTheme(pref);
      return;
    }
    setTheme(systemTheme());
    if (!window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    writePref(next);
  }, []);

  // Toggling always lands on an explicit choice, never back on "system" —
  // someone who reaches for the switch is telling us what they want.
  const toggle = useCallback(() => {
    setPref(theme === "dark" ? "light" : "dark");
  }, [theme, setPref]);

  return (
    <ThemeContext.Provider value={{ pref, theme, setPref, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
