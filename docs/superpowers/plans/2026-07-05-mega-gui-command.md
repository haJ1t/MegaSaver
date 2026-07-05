# `mega gui` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD: failing test first → red → minimal impl → green → commit. Build after src edits (`pnpm --filter @megasaver/gui build`; tests resolve `@megasaver/*` from dist). `pnpm verify` at each slice boundary.

**Goal:** Ship the GUI to npm users — `mega gui` starts the bridge (now serving both `/api` AND the built GUI, loopback-bound, token-gated) and opens the browser. First visible saving < 5 min from `npm i -g`.

**Architecture:** The frontend is already relative-path (`/api`), so the built vite bundle works same-origin from whatever host serves it. The bridge gains: (1) loopback bind + bearer-token wall + origin derivation, (2) static serving of the GUI dist, (3) the CLI bundles the dist and inlines the bridge (tsup pattern from the CLI). No new runtime, no signing.

**Tech Stack:** TypeScript ESM, node:http bridge, Vitest, tsup (CLI bundle), Citty (CLI). Packages: `apps/gui` (bridge + frontend), `apps/cli`.

**Spec:** `docs/superpowers/specs/2026-07-05-mega-gui-command-design.md`. Risk HIGH → code-reviewer + critic + security-reviewer.

**Verified anchors:** `server.ts:62` `server.listen(port, cb)` (no host → all-interfaces); `cors.ts:4` `ALLOWED_ORIGINS = ["http://127.0.0.1:5173","http://localhost:5173"]`; `handler.ts:65` `BridgeHandlerOptions`, `:151` `createBridgeHandler`, `:189` `handleRequest`, `:191` `applyCorsPolicy`, `:202` ctx build, `/api/...` dispatch then `sendError(...,404,...)` at the tail; `api-client.ts:27` `getJson(path)=fetch(path)`, `:33` `postJson`, `:45` `deleteJson` (+ any patch helper) — the CENTRAL fetch helpers; 3 EventSource sites: `office-client.ts:161,212`, `claude-sessions-client.ts:135`; `proxy-control.ts:45` `superviseArgv:[process.execPath,"mega",...]` (literal bug); `vite.config.ts:19` `sourcemap:true`; store path `bridge/store-path.ts resolveBridgeStorePath`.

---

## Slice A — bridge hardening (loopback + token + origin + argv)

### Task A1: loopback bind

**Files:** Modify `apps/gui/bridge/server.ts:62`; Test `apps/gui/test/bridge/server-bind.test.ts` (new).

- [ ] **Step 1: Test** — start the server (import `main` or factor a `startBridge({port:0})` helper), assert `server.address()` returns `address === "127.0.0.1"`. If `main()` isn't testable, extract a `createBridgeServer(handler, port)` returning the http.Server and test its bound address.
- [ ] **Step 2: Run → FAIL** (binds `::`/`0.0.0.0` today).
- [ ] **Step 3: Implement** — `server.listen(port, "127.0.0.1", () => {...})`. Keep the log line.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `fix(gui): bind bridge to loopback only`.

### Task A2: bearer-token wall in the handler

**Files:** Modify `apps/gui/bridge/handler.ts` (`BridgeHandlerOptions` + `handleRequest`); Test `apps/gui/test/bridge/token-auth.test.ts` (new).

- [ ] **Step 1: Read** `handler.ts:65-88` (`BridgeHandlerOptions`, `BridgeHandler`) and `:189-215` (`handleRequest`: cors → OPTIONS → ctx → dispatch). The token check goes AFTER cors/OPTIONS and BEFORE the `/api` route matching, gating ONLY `/api/*` paths.
- [ ] **Step 2: Test** — build a handler via `createBridgeHandler({ ...minimal, token: "SECRET" })` and drive it with a fake req/res (mirror the existing bridge route tests' harness):
  - `GET /api/health` with `authorization: "Bearer SECRET"` → not 401 (reaches the route).
  - `GET /api/health` with no auth → 401 `unauthorized`.
  - `GET /api/health` with `authorization: "Bearer WRONG"` → 401.
  - `GET /api/claude-sessions/x/y/stream?token=SECRET` (SSE) → not 401 (query token accepted).
  - handler built WITHOUT `token` (existing tests) → no 401 (backward-compatible; enforcement only when configured).
  Add `unauthorized` to `BRIDGE_ERROR_CODES` (`src/bridge-error-code.ts`) if absent.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** — add `token?: string` to `BridgeHandlerOptions`. In `handleRequest`, after the OPTIONS/cors block, before the first `/api` match:
  ```ts
  if (opts.token !== undefined && path.startsWith("/api/")) {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const supplied = bearer.length > 0 ? bearer : (query.get("token") ?? "");
    if (supplied !== opts.token) {
      sendError(res, 401, "unauthorized", "Missing or invalid bridge token.", origin);
      return;
    }
  }
  ```
  (`opts` is closed over; `query` is the parsed URLSearchParams already in scope — verify its name at `:202`/parseUrl.) Use a constant-time compare only if trivial; a plain `!==` is acceptable for a localhost random token (note WHY in a comment).
- [ ] **Step 5: Run → PASS**, full gui suite (existing route tests must stay green since they pass no token). Commit `feat(gui): bearer-token wall on bridge /api`.

### Task A3: server generates/reads the token + CORS origin derivation

**Files:** Modify `apps/gui/bridge/server.ts` (token + pass to handler + print) and `apps/gui/bridge/cors.ts` (derive allowlist); Tests: extend `cors` test + a server token test.

- [ ] **Step 1: Test (cors)** — `applyCorsPolicy` currently hardcodes 5173. Change `applyCorsPolicy` to accept an `allowedOrigins: readonly string[]` param (or a factory). Test: with allowlist `["http://127.0.0.1:5174","http://localhost:5174"]`, an Origin of `http://localhost:5174` → allowed; `http://evil.com` → 403; no Origin → allowed. Keep the dev origins working.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `applyCorsPolicy(req,res,sendError,allowedOrigins)`; `handleRequest` passes an allowlist derived from `opts.origins ?? DEFAULT_DEV_ORIGINS` (add `origins?: readonly string[]` to `BridgeHandlerOptions`; default `["http://127.0.0.1:5173","http://localhost:5173"]` to preserve dev). `server.ts` computes `origins = [\`http://127.0.0.1:${port}\`, \`http://localhost:${port}\`]` and passes it (packaged mode serves same-origin) — OR keeps dev origins when a `MEGASAVER_GUI_DEV=1` flag is set. Simplest: server passes both its own port origins AND 5173 (dev vite) — a superset that works in both modes; note WHY.
- [ ] **Step 4: Test (server token)** — `server.ts` reads `MEGASAVER_GUI_TOKEN` env; if absent, generates `randomUUID()`; passes it to `createBridgeHandler({token})` and prints the tokenized URL `http://127.0.0.1:${port}/?token=${token}`. Test via a small `resolveGuiToken(env)` pure fn (env set → that; absent → a 32+ char value).
- [ ] **Step 5: Implement + Run → PASS.** Commit `feat(gui): bridge token + derived CORS origins`.

### Task A4: superviseArgv literal fix

**Files:** Modify `apps/gui/bridge/proxy-control.ts:45`; Test: the proxy-control test.

- [ ] **Step 1: Test** — `defaultProxyGuiDeps(storeRoot).superviseArgv[1]` should be the real script path (`process.argv[1]`), not the literal `"mega"`. Assert `superviseArgv` = `[process.execPath, process.argv[1], "proxy", "supervise", "--store", storeRoot]`.
- [ ] **Step 2: Run → FAIL** (literal `"mega"`).
- [ ] **Step 3: Implement** — `superviseArgv: [process.execPath, process.argv[1] ?? "mega", "proxy", "supervise", "--store", storeRoot]` (fallback keeps dev-tsx working). Mirror the CLI (`apps/cli/src/commands/proxy/commands.ts:28-35`).
- [ ] **Step 4: Run → PASS.** Commit `fix(gui): resolve proxy supervise argv from argv[1]`.

**Slice A boundary:** `pnpm --filter @megasaver/gui test` + `pnpm verify` green. The `dev` script must still work — update `apps/gui/package.json dev` to export a shared `MEGASAVER_GUI_TOKEN` for both vite + bridge (so dev has a known token; vite injects it via `define`/`import.meta.env` per Task B2) OR document that dev uses `MEGASAVER_GUI_DEV` to relax the wall. Decide in Task A3.

---

## Slice B — static serving + frontend token plumbing

### Task B1: bridge serves the GUI dist

**Files:** Create `apps/gui/bridge/static.ts`; Modify `handler.ts` (`distDir` option + serve non-`/api` GET); Test `apps/gui/test/bridge/static-serving.test.ts`.

- [ ] **Step 1: Test** — handler built with `distDir` pointing at a temp dir containing `index.html` + `assets/app.js`:
  - `GET /` → 200, `content-type: text/html`, body = index.html.
  - `GET /assets/app.js` → 200, `content-type` javascript.
  - `GET /nope.png` → 404.
  - handler built WITHOUT `distDir` → `GET /` → 404 (today's behavior, dev regression guard).
  - Token is NOT required for `/` (static served even with no/invalid token) — assert `GET /` (no token) → 200.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `static.ts`: `serveStatic(res, distDir, path): boolean` — resolve `path === "/" ? "index.html" : path` under `distDir`, reject `..`/absolute escapes (join + verify the resolved path stays within distDir), map extension→content-type (html/js/css/woff2/svg/json/map), stream the file, return true; missing file → return false. In `handleRequest`, for a GET that did NOT match any `/api` route and `opts.distDir !== undefined`, call `serveStatic` before the final 404. Add `distDir?: string` to `BridgeHandlerOptions`. The token wall (Task A2) already only gates `/api/` so static is unauthenticated by construction.
- [ ] **Step 4: Run → PASS.** Commit `feat(gui): bridge serves built GUI dist when distDir set`.

### Task B2: frontend token bootstrap + attach

**Files:** Create `apps/gui/src/lib/auth.ts`; Modify `apps/gui/src/lib/api-client.ts` (attach header to getJson/postJson/deleteJson + any patch helper), `office-client.ts:161,212`, `claude-sessions-client.ts:135` (SSE `?token=`); Test `apps/gui/test/lib/auth.test.ts`.

- [ ] **Step 1: Test (auth module)** — `readAndStoreToken(location, storage)`: given `location.search = "?token=ABC"` → returns "ABC", writes it to `storage`, and (via an injected `replaceState`) strips `token` from the URL. Second call with no `?token=` but storage set → returns "ABC" from storage. `authHeaders()` → `{ Authorization: "Bearer ABC" }` when set, `{}` when not. `withToken(url)` → appends `?token=ABC` (or `&token=`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `auth.ts` with `readAndStoreToken`, `authHeaders`, `withToken` (sessionStorage-backed; pure-ish with injectable deps for the test). Call `readAndStoreToken(window.location, sessionStorage)` once at app entry (`main.tsx`/root). In `api-client.ts`, merge `authHeaders()` into every fetch's headers (getJson needs an init now: `fetch(path, { headers: authHeaders() })`; postJson/deleteJson merge into existing headers). At the 3 EventSource sites, wrap the url: `new EventSource(withToken(url))`.
- [ ] **Step 4: Run → PASS**, full gui suite. Commit `feat(gui): frontend reads+attaches bridge token`.

### Task B3: sourcemap-free shipped build

**Files:** Modify `apps/gui/vite.config.ts:19` (or add a build mode); no new test (build config).

- [ ] **Step 1:** Set `sourcemap: false` for the shipped build (either flip it, or gate on an env: `sourcemap: process.env.GUI_SHIP !== "1"`). Simplest: `sourcemap: false` (dev debugging uses the vite dev server, not the built bundle).
- [ ] **Step 2: Verify** — `pnpm --filter @megasaver/gui build` → `dist/` has no `.map` files; note the dist size (~825 KB).
- [ ] **Step 3: Commit** `chore(gui): drop sourcemaps from the shipped build`.

**Slice B boundary:** `pnpm verify` green. Manual: `pnpm --filter @megasaver/gui build` then a tiny node script that starts the handler with `distDir=dist` + a token and curls `/` (200) + `/api/health` without token (401) + with token (200).

---

## Slice C — `mega gui` command + packaging

### Task C1: the command

**Files:** Create `apps/cli/src/commands/gui.ts`; Modify the root command registration (mirror `trace`); Test `apps/cli/test/commands/gui.test.ts`.

- [ ] **Step 1: Read** how `apps/cli/src/commands/trace/` registers + how the CLI resolves the store (`readStoreEnv`/`resolveStorePath`) and how `apps/gui`'s `createBridgeHandler` + `createBridgeServer` are imported (add `@megasaver/gui` as a CLI dependency; export the bridge factory + a `resolveShippedGuiDistDir()` from `@megasaver/gui`'s package entry).
- [ ] **Step 2: Test** — `runGui({ port: 0, open: false, store, deps })` where deps inject the browser-opener + a token generator: starts the server on an ephemeral port bound to 127.0.0.1, serves `/` (200 html) and `/api/health` with the token (200) / without (401), prints a `http://127.0.0.1:<port>/?token=<t>` line, does NOT open the browser (open:false), and returns a stop handle. Assert the printed URL contains `127.0.0.1` + `token=`.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement** `gui.ts`: resolve store; generate token (randomUUID); resolve `distDir` = the shipped GUI dist (bundled path, resolved relative to the module) or, when running from source, `@megasaver/gui`'s `dist`; build the handler `createBridgeHandler({ storePath, registry, mcpOps, office, token, distDir, origins })`; start via `createBridgeServer(handler, port)` bound to 127.0.0.1; print the tokenized URL; `open` the browser best-effort (`open` on darwin / `start` win32 / `xdg-open` linux) unless `--no-open`; keep the process foreground; Ctrl-C stops. Register `gui` in the root command with flags `--port <n>`, `--no-open`, `--store <dir>`.
- [ ] **Step 5: Run → PASS**, cli suite + any command-parity test. Commit `feat(cli): mega gui — serve the packaged GUI`.

### Task C2: packaging (bundle the dist + inline the bridge)

**Files:** Modify `apps/cli/package.json` (devDep `@megasaver/gui`, `files`, `prepack`), `apps/cli/tsup.bundle.config.ts` (inline `@megasaver/gui` + new `evidence-ledger`/`stats` — verify the negative-lookahead already covers them), a copy step for the GUI dist.

- [ ] **Step 1: Read** `apps/cli/tsup.bundle.config.ts:45-83` (`noExternal` negative-lookahead + CJS banner shims) + `apps/cli/package.json:8-10,29` (`prepack`, `files`). Confirm `@megasaver/gui`, `@megasaver/evidence-ledger`, `@megasaver/stats` are inlined by the existing lookahead (they match `@megasaver/*`).
- [ ] **Step 2: Implement** — add `@megasaver/gui` to the CLI `devDependencies` (workspace:*). Add a prepack/build step that runs `pnpm --filter @megasaver/gui build` and copies `apps/gui/dist/` → `apps/cli/dist-bundle/gui/` (inside the published `files`). `gui.ts`'s `resolveShippedGuiDistDir()` resolves `dist-bundle/gui` relative to `import.meta.url` (built) with a dev fallback to the workspace `apps/gui/dist`.
- [ ] **Step 3: Verify** — `pnpm --filter @megasaver/cli build` succeeds; the bundle includes the bridge (grep the output for a bridge-only symbol) and `dist-bundle/gui/index.html` exists. Note the tarball delta (`npm pack --dry-run` → size).
- [ ] **Step 4: Commit** `build(cli): bundle GUI dist + inline bridge for mega gui`.

### Task C3: docs + changeset

**Files:** `README.md` (quickstart: `npm i -g @megasaver/cli && mega gui`), `docs/getting-started.md`; `.changeset/mega-gui.md`.

- [ ] **Step 1:** README quickstart — add `mega gui` as the "see your savings" step right after install. Update the GUI section that says "clone the repo + pnpm dev" to point at `mega gui`.
- [ ] **Step 2:** Changeset: `@megasaver/cli` minor (new command + bundled GUI), `@megasaver/gui` minor (bridge auth + static serving).
- [ ] **Step 3: Commit** `docs: mega gui quickstart + changeset`.

---

## Final gate

- `pnpm verify` green.
- **Bundle smoke (the real proof):** `cd apps/cli && npm pack` → install the tarball into a temp prefix (`npm i -g ./megasaver-cli-*.tgz --prefix /tmp/mgtest`) → `mega gui --no-open` → in another shell: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/` = 200; `curl .../api/health` = 401; `curl ".../api/health?token=<t>"` = 200. Capture output. (Do NOT publish.)
- Changesets present.
- **Reviewers: code-reviewer + critic + security-reviewer.** Security focus: token wall covers EVERY `/api` route (no bypass), loopback bind verified on the real server, static path-traversal (`..`) rejected, token not logged, no-token dev mode can't ship enabled, the origin-less-request path still hits the token wall. Critic focus: dev mode still works (vite + bridge share the token), the existing route tests didn't just get a token-less bypass baked in, static serving doesn't shadow `/api`.

## Deferred (non-goals)
Tauri/Electron shell (Faz 2); cookie+CSRF upgrade; remote/team access; auto-update; daemonized `mega gui`; Windows proxy-toggle parity.
