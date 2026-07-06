---
title: mega gui — packaged GUI served by the bridge from the npm CLI
date: 2026-07-05
status: proposed
risk: HIGH
scope: new public CLI command `mega gui`; bridge static serving + loopback bind + token auth; GUI dist bundled into @megasaver/cli
base: main (eefc8c52)
reviewers: [code-reviewer, critic, security-reviewer]
---

# `mega gui` — the packaged GUI

## Motivation (GTM Faz 0, KPI: install → first visible saving < 5 min)

The GUI is the most sellable surface (savings chart, decision-trace, memory
graph) but today runs ONLY from a source checkout (`pnpm --filter
@megasaver/gui dev`) — an npm user never sees it. Recon verdict (2026-07-05,
user-approved): bundle the built GUI + bridge into the published CLI as
`mega gui` NOW; Tauri/desktop shell is Faz-2 Pro polish. Nothing here is
throwaway for a later shell (same dist, same bridge).

## Locked decisions (user-approved 2026-07-05)

1. **Path A**: `mega gui` in `@megasaver/cli` — no new runtime, no signing.
2. **Security: loopback + token now** (not fast-follow). The bridge currently
   binds ALL interfaces with NO auth (`server.listen(port)`, `server.ts:62`) —
   unacceptable once distributed. Non-negotiable in this feature.
3. GTM plan re-scope: Faz-0 item becomes "`mega gui` (A)"; Tauri moves to Faz 2.

## Design

### 1. Bridge hardening (applies to dev AND packaged mode)

- **Loopback bind**: `server.listen(port, "127.0.0.1")`. No opt-out flag (YAGNI;
  remote access is a Faz-2/team concern).
- **Token auth**: bridge generates a random bearer token per process start
  (crypto.randomUUID or 32-hex) unless `MEGASAVER_GUI_TOKEN` provides one
  (dev-mode convenience: the `dev` script exports one so vite + bridge share it).
  - Every `/api` request must present it: `Authorization: Bearer <token>`
    header, OR `?token=` query for EventSource/SSE routes (EventSource cannot
    set headers).
  - Bootstrap: `mega gui` opens `http://127.0.0.1:<port>/?token=<t>`; the
    frontend reads it once from `location.search`, stores in `sessionStorage`,
    strips it from the URL (`history.replaceState`), and attaches it to every
    fetch/EventSource. This is the deferred "launch cap → token" item
    (wiki/log.md:1893) made real; cookie+CSRF upgrade stays deferred.
  - Missing/wrong token → 401 (JSON error). Static assets (`/`, `/assets/*`)
    are served WITHOUT the token (they contain no data; the app is useless
    without a valid token for `/api`).
- **CORS**: allowlist derives from the actual serving origin
  (`http://127.0.0.1:<port>` + `http://localhost:<port>`) in packaged mode;
  keeps the vite-dev origins (5173) in dev. Origin-less requests remain allowed
  (curl) but now hit the token wall.
- **superviseArgv fix** (`bridge/proxy-control.ts:45`): literal `"mega"` →
  resolve like the CLI does (`process.argv[1]`), correct under the bundle.

### 2. Bridge static serving

- Non-`/api` GET paths serve the built GUI from a configured `distDir`:
  `/` → `index.html`, `/assets/*` + font files with correct content-types,
  404 for anything else (no SPA deep-link fallback needed — views are internal
  state, `src/view-id.ts`). `distDir` absent (dev mode today) → current
  JSON-only behavior unchanged.
- Shipped dist excludes sourcemaps (vite `sourcemap: false` for the shipped
  build or copy-filter; keeps the tarball ~+280 KB gzip).

### 3. Frontend token plumbing

- A tiny auth module: read `?token=` once → sessionStorage → strip URL; export
  `authHeaders()` + `withToken(url)` helpers.
- `api-client.ts` `getJson/mutateJson` attach the header; the 3 EventSource
  call sites (`office-client.ts` ×2, `claude-sessions-client.ts`) use
  `withToken(url)`.
- Dev mode: `MEGASAVER_GUI_TOKEN` is injected by the dev script (vite `define`
  or a `/api/health`-style bootstrap is NOT used — keep it simple: dev script
  sets the same token in both processes and vite injects it via
  `import.meta.env`).

### 4. CLI command + packaging

- `apps/cli/src/commands/gui.ts`: `mega gui [--port <n>] [--no-open]` —
  resolve store root, generate token, start the bridge (imported handler +
  static distDir), print the tokenized URL, open the browser (`open`/`start`/
  `xdg-open`, best-effort). Ctrl-C stops it. Registered like `trace`.
- Packaging: `@megasaver/gui` becomes a CLI devDependency (tsup inlines the
  bridge; 16/18 workspace deps already inline — evidence-ledger + stats are
  small pure-TS additions). `prepack` builds the GUI and copies `dist/` into
  the CLI's shipped `files` (e.g. `dist-bundle/gui/`); `gui.ts` resolves it
  relative to its own module path.
- Windows: `mega gui` works (bridge is portable; store path already win32-aware,
  `bridge/store-path.ts`). The proxy TOGGLE inside the GUI stays macOS-only
  (launchd) — the panel already communicates state honestly; no new work.

## Non-goals (deferred)

Tauri/Electron shell (Faz 2); cookie+CSRF upgrade; remote/team access;
auto-update; `mega gui` daemonization (runs foreground); serving the GUI from
the context daemon.

## Testing (TDD, the critic's mutation targets)

- **Token wall**: /api without token → 401; with wrong token → 401; with
  header token → 200; SSE route with `?token=` → 200. Mutation: disable the
  check → tests fail. Static `/` serves without token.
- **Loopback**: the listen call binds 127.0.0.1 (assert on the server address).
- **Static**: `/` → index.html (content-type text/html), `/assets/x.js` →
  correct type, unknown path → 404, `distDir` absent → non-/api 404s exactly as
  today (dev regression guard).
- **CORS**: packaged origin allowed; foreign origin still 403 on POST.
- **Frontend**: auth module reads+strips+stores the token; api-client attaches
  it; EventSource URLs carry `?token=`.
- **CLI**: `mega gui --no-open` prints a tokenized 127.0.0.1 URL and serves
  both `/` and an authed `/api/health` (integration test against the real
  handler); command registered in help.
- **Bundle smoke** (final gate): real `npm pack` → install into a temp prefix →
  `mega gui --no-open` → curl `/` (200 html) + `/api/health` with token (200) +
  without (401). Evidence captured.
- `pnpm verify` green at every slice boundary.

## Slices

- **A: bridge hardening** — loopback bind + token wall + CORS derivation +
  superviseArgv fix (+ dev-script token wiring so dev keeps working).
- **B: static serving + frontend token plumbing** — distDir serving; auth
  module; client attach; sourcemap-free build config.
- **C: `mega gui` command + packaging** — command, prepack dist copy, tsup
  inlining, bundle smoke, docs (README quickstart update).
