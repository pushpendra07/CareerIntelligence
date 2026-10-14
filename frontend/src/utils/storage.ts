/**
 * Per-browser preferences (remembered sort and filters). Storage can be unavailable (private
 * windows, blocked site data), so every access is guarded and failures fall back to defaults.
 */
export const prefs = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null || value === "") window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch { /* not available: the preference just isn't remembered */ }
  },
};
