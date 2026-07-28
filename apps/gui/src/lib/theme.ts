// Theme resolution. The canvas follows the OS by default; a manual choice
// overrides it and persists. `system` removes the attribute entirely so the
// `prefers-color-scheme` block in tokens.css takes over again.

export type ThemeChoice = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "megasaver.theme";

export function readStoredTheme(storage: Pick<Storage, "getItem">): ThemeChoice {
  const raw = storage.getItem(STORAGE_KEY);
  return raw === "dark" || raw === "light" ? raw : "system";
}

export function storeTheme(
  storage: Pick<Storage, "removeItem" | "setItem">,
  choice: ThemeChoice,
): void {
  if (choice === "system") storage.removeItem(STORAGE_KEY);
  else storage.setItem(STORAGE_KEY, choice);
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

// tokens.css keys off this attribute: absent = follow the OS.
export function applyTheme(
  root: Pick<Element, "removeAttribute" | "setAttribute">,
  choice: ThemeChoice,
): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

// Flipping always yields an explicit choice — never back to `system`, because
// "the opposite of what I'm looking at" is only meaningful as a pinned value.
export function nextTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  return resolveTheme(choice, prefersDark) === "dark" ? "light" : "dark";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

// matchMedia is absent in jsdom and in older embedders. Treat the browser API
// as a boundary: probe it, fall back to light, never let it throw into render.
export function prefersDarkNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(DARK_QUERY).matches;
}

// Returns an unsubscribe. No-ops when matchMedia is unavailable.
export function subscribePrefersDark(onChange: (prefersDark: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  const handler = (e: MediaQueryListEvent): void => onChange(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
