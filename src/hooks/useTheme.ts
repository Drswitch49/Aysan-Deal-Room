import { useCallback, useSyncExternalStore } from "react";

/**
 * Light / dark theme, shared by the deal room and every portal.
 *
 * The theme is a class on <html> ("light" or "dark"); every colour in the app
 * reads CSS variables that flip on that class (see tailwind.config.js). The
 * inline script in index.html applies the saved choice before first paint, so
 * a light-mode user never sees a dark flash on load. Dark is the default.
 */
export type Theme = "light" | "dark";

const STORAGE_KEY = "acp-theme";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the choice just won't survive a reload.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
  const toggleTheme = useCallback(() => applyTheme(readTheme() === "light" ? "dark" : "light"), []);
  return { theme, toggleTheme };
}
