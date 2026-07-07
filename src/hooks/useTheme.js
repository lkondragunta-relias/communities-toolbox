import { useCallback, useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "roadmap-theme-preference";

export function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference) {
  if (preference === "light" || preference === "dark") return preference;
  return getSystemTheme();
}

export function applyTheme(resolved) {
  document.documentElement.dataset.theme = resolved;
}

function readStoredPreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* ignore */
  }
  return "system";
}

export function useTheme() {
  const [preference, setPreference] = useState(readStoredPreference);
  // Tracked in state (not just read once) so `resolved` stays correct when the
  // OS theme changes while preference is "system".
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const resolved = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    applyTheme(resolved);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      /* ignore */
    }
  }, [preference, resolved]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemTheme(media.matches ? "dark" : "light");

    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const setThemePreference = useCallback((next) => {
    setPreference(next);
  }, []);

  return { preference, resolved, setThemePreference };
}
