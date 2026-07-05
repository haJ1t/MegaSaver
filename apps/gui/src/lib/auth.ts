// Bridge-token plumbing. `mega gui` opens the app at `/?token=<t>`; the frontend
// reads it once, keeps it in sessionStorage (survives reloads within the tab,
// not persisted to disk), and strips it from the URL so it never lingers in the
// address bar or history. Every /api call then attaches it.

const STORAGE_KEY = "megasaver.gui.token";

type TokenLocation = { search: string; pathname: string };
type ReplaceState = (data: unknown, unused: string, url: string) => void;

// The dev build injects a shared token so the vite frontend can reach the
// (always-on) bridge wall without a packaged `?token=` bootstrap. Read it via
// import.meta.env so it is inlined at build time and absent from prod bundles.
function devToken(): string | undefined {
  const value = import.meta.env.VITE_MEGASAVER_GUI_TOKEN;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Run once at app entry. Reads ?token= from the URL, persists it, strips it from
// the address bar, and returns the effective token (URL → storage → dev env).
export function readAndStoreToken(
  location: TokenLocation,
  storage: Storage,
  replaceState: ReplaceState,
): string | undefined {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("token");
  if (fromUrl !== null && fromUrl.length > 0) {
    storage.setItem(STORAGE_KEY, fromUrl);
    params.delete("token");
    const rest = params.toString();
    replaceState(null, "", rest.length > 0 ? `${location.pathname}?${rest}` : location.pathname);
    return fromUrl;
  }
  return storage.getItem(STORAGE_KEY) ?? devToken();
}

// Current token for attach-time use. Prefers the bootstrapped/stored token, then
// the dev-injected fallback. Reads sessionStorage so it stays correct after a
// reload where readAndStoreToken already persisted the value.
function currentToken(): string | undefined {
  return sessionStorage.getItem(STORAGE_KEY) ?? devToken();
}

export function authHeaders(): Record<string, string> {
  const token = currentToken();
  return token !== undefined ? { Authorization: `Bearer ${token}` } : {};
}

// Append the token as a query param for EventSource URLs (SSE cannot set headers).
export function withToken(url: string): string {
  const token = currentToken();
  if (token === undefined) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}
