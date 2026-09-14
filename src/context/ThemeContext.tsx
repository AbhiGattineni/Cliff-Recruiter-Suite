// Light/dark theming.
//
// Light is the default. Not "follow the operating system" — a deliberate
// default, so that everyone who has never touched the switch sees the same
// thing, and what someone is shown does not depend on a setting they made on
// their laptop for unrelated reasons.
//
// Once a person uses the toggle, their choice is stored and wins from then on,
// on that browser. There is no third "system" state: the stored value is either
// their explicit choice or nothing at all.
//
// index.html does the same resolution inline, before first paint, so the page
// never flashes the wrong theme while the bundle loads. This module must agree
// with that script — if the storage key or the default changes here, change it
// there too.

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

export type Theme = "light" | "dark";

export const THEME_KEY = "cliff.theme";
export const DEFAULT_THEME: Theme = "light";

/**
 * Storage can throw, not just come back empty — a private window, blocked site
 * data, or an embedded webview will raise on access rather than return null.
 * A theme preference is never worth taking the app down for, so every read and
 * write here is swallowed and the caller falls back to the default.
 */
function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Won't survive the reload. The session still themes correctly.
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
  /** What is on screen. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
