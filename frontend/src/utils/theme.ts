import { useEffect, useState } from "react";
import { prefs } from "./storage";

export type Theme = "light" | "dark" | "system";
const KEY = "theme"; // also read by the inline script in index.html (no flash on load)

const systemDark = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && systemDark()));
}

/** The chosen theme, remembered in this browser; "system" follows the OS setting live. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => (prefs.get(KEY) as Theme | null) ?? "system");
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);
  return [theme, (t: Theme) => { prefs.set(KEY, t === "system" ? null : t); setTheme(t); }];
}
