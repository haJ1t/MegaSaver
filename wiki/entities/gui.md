---
title: '@megasaver/gui'
tags: [entity, app, gui, v0.4]
sources:
  - docs/superpowers/specs/2026-05-10-ii-gui-app-design.md
  - docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md
  - docs/superpowers/specs/2026-07-03-gui-redesign-v3-design.md
  - docs/superpowers/plans/2026-07-03-gui-redesign-v3.md
status: published
created: 2026-05-10
updated: 2026-07-03
---

# `@megasaver/gui`

Localhost web shell over the core registry. App at `apps/gui/`,
`private: true`. v1 turns the v0.3 read-only bootstrap into a
single-developer console.

## Stack

Vite + React 18 + Tailwind v3.4 (JIT) + a tiny `node:http` bridge
that imports `@megasaver/core` directly. No router. No state lib —
React `useState`/`useEffect` hooks. Token system via CSS variables
in `apps/gui/src/styles/tokens.css`; design language documented in
`apps/gui/DESIGN.md` ("Editorial Terminal" — DM Mono + zinc + amber
accent, light/dark via `prefers-color-scheme`).

## Ports

- Vite dev server: `5173` (fixed; proxies `/api → 5174`).
- Bridge: `5174` (env override `MEGASAVER_GUI_BRIDGE_PORT`).

`pnpm --filter @megasaver/gui dev` boots both via `concurrently`
with `--kill-others-on-fail`. Escape hatches: `dev:vite`,
`dev:bridge` (preserved for isolated debugging).

## Bridge endpoints (`apps/gui/bridge/`)

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/api/health` | `routes/health.ts` | `{ ok: true, store }` |
| GET | `/api/projects` | `routes/projects.ts` | sorted createdAt asc |
| GET | `/api/sessions[?projectId]` | `routes/sessions.ts` | sorted startedAt desc |
| GET | `/api/memory[?projectId]` | `routes/memory.ts` | sorted createdAt desc |
| POST | `/api/sessions` | `routes/sessions.ts` | 201 with created Session |
| POST | `/api/sessions/:id/end` | `routes/sessions.ts` | 200; 409 if already ended |
| PATCH | `/api/sessions/:id` | `routes/sessions.ts` | 200; 409 if ended; 400 empty patch |
| POST | `/api/memory` | `routes/memory.ts` | 201; cross-field guard on scope/sessionId |

Errors carry the closed envelope `{ error, code, details? }` per
spec §4b. CORS posture: loopback only — Origin must be missing or
match `localhost|127.0.0.1:5173` (spec §4c).

### Bridge file shape (#58)

Split per CLAUDE.md §8 (file cap 300 LOC, one responsibility per file):

- `bridge/handler.ts` — `createBridgeHandler({ registry, … })`
  entry, request dispatch, response helpers (`sendJson` carries the
  CSP `default-src 'self'` header from #61).
- `bridge/cors.ts` — `applyCorsPolicy`, `handleOptionsPreflight`.
- `bridge/error-mapping.ts` — `mapCoreRegistryError`,
  `handleCaughtError` (Core errors → Bridge envelope).
- `bridge/zod-schemas.ts` — shared input schemas (`TITLE_SCHEMA`,
  the four body schemas, `zodErrorMessage`).
- `bridge/route-context.ts` — `RouteContext` type wired per request.
- `bridge/routes/{health,projects,sessions,memory}.ts` — endpoint
  groups; each handler `(ctx, …) => void | Promise<void>`.
- `bridge/routes/_body.ts` — shared `readJsonBody` helper.

### View file shape (#58)

The `SessionsView` master-detail was split into three:

- `views/sessions-view.tsx` — shell + state + data loading +
  write-form orchestration. Composes the two below.
- `views/sessions-list.tsx` — list pane (`role="listbox"` rows,
  keyboard handler taken as a prop).
- `views/sessions-detail.tsx` — detail pane (header, metadata grid,
  end-action buttons, inline `<UpdateSessionForm />`).

## Closed-enum surfaces

- `ViewId = ["memory", "sessions"]` (preserved from v0.3).
- `WriteAction = ["create-memory", "create-session", "end-session", "update-session"]`.
- `BridgeErrorCode = [...]` (10 codes, alphabetic; mirrored bridge
  ↔ frontend, see `apps/gui/src/bridge-error-code.ts`).

Each pinned with a `.test-d.ts` AA3-canonical assertion.

## Accessibility commitments (spec §9)

Keyboard-reachable, focus-visible everywhere, `role="alert"` on
bridge errors, `aria-current="page"` on the active view, full
labels on icon-only controls, `prefers-reduced-motion` honoured.

## Boundary rules

- The bridge is a system boundary: every request body parsed at
  the boundary with Zod, no internal trust of unparsed input.
- The frontend never imports `node:*` — bridge is server-only.
- No agent-specific logic. Project / session / memory shapes are
  Core's, surfaced verbatim.
- Project lifecycle (create / update / delete) remains CLI-only in
  v1; GUI is read-only for projects.

## Risk

Risk MEDIUM. Full superpowers chain shipped: architect spec →
designer skill chain → test-engineer (152 tests) → executor
(handler + integration + concurrently) → code-reviewer + verifier
in fresh contexts.

## Lint posture

`biome.json` disables `useSemanticElements` for four files:
`apps/gui/src/components/project-picker.tsx`,
`apps/gui/src/views/sessions-view.tsx`,
`apps/gui/src/views/sessions-list.tsx`, and
`apps/gui/src/views/memory-view.tsx`.

These components use `<div role="...">` patterns (e.g. `role="list"`,
`role="listitem"`, `role="listbox"`/`role="option"`) rather than native
`<ul>`/`<li>`/`<select>` because the design system's token-driven hover
and selection states require a flat element hierarchy; wrapping in
semantic list elements breaks the CSS custom-property cascade. The
override is intentional and scoped to the four affected files only.

## AA1 / Mega Saver Mode

- Sessions detail pane gains a `TokenSaverPanel` (mode picker,
  enable/disable, savings ratio, recent events, raw/sent viewer) plus
  `token-saver-{modal,stats}` and `savings-badge` (BB10).
- `agent-setup-doctor` view + `agent-setup-row` drive setup/repair
  with no terminal (BB11).
- Bridge routes: `/api/sessions/:id/token-saver/{status,stats,events,
  enable,disable}` (BB10) and `/api/mcp/{status,install,repair,
  uninstall}` (BB11). The doctor routes run real `McpSetupOps` via
  `createMcpOps` → `buildMcpSetupOps`; status is `{ agents: [...] }`
  keyed by `agentId` (source: AA1 §6c).

## Related

- [[entities/core]]
- [[entities/cli]]
- [[entities/mcp-bridge]]
- [[concepts/agent-agnostic-core]]

## v1.1 / post-v1.0 (2026-06-03/2026-06-04)

**PR #84 — AgentSetupDoctor + CONTEXT_GATE connector block (BB11):**

Already captured in the `## AA1 / Mega Saver Mode` section above.
Summarised for navigation: `agent-setup-doctor` view (setup/repair
without a terminal); bridge `/api/mcp/{status,install,repair,uninstall}`
routes; each agent row carries a `restartHint`. The `connectors-shared`
`CONTEXT_GATE` block coexists with the legacy block.

**PRs #85, #87 — WCAG AA contrast:**

- `#85`: accent colour `#c4681a` → `#a25616`; muted text channel
  retuned. All body text ≥4.5:1.
- `#87`: active nav-item and chip text switched from accent colour to
  `text-primary`. Resolves the remaining failing contrast pairs.

**PR #97 — Token-savings observability (gui@1.1.0):**

- Token-savings inline-SVG chart added to `TokenSaverPanel`; renders
  the savings ratio history for the current session.
- Raw-output retention controls: `GET /api/sessions/:id/raw-output/summary`
  returns aggregate size; destructive clear requires two-step user
  confirmation (session-scoped, irreversible).
- `<output>` element gains `aria-live="polite"` for screen-reader
  announcements on savings updates.

## GUI coverage audit (2026-06-14)

Source-backed review of `/Users/halitozger/Desktop/MegaSaver_GUI_Analiz.md`
against the current code confirmed the main diagnosis: the GUI remains a
thin shell over three views (`agent-setup`, `memory`, `sessions`) while
the CLI/core surface now includes project create, typed memory mutation
and approval, rules, failures, index, context packs, task plans, tools,
and audit summaries.

Implementation caveat for future GUI expansion: new surfaces are not only
"bridge route + api-client + view". The bridge has a closed
`BridgeErrorCode` enum, Zod boundary schemas, type-pin tests, CORS/error
contracts, and store-root concerns for file-backed features such as audit,
index, and context. Mutating flows should preserve the existing boundary
style and add bridge/integration/component tests with each route.

## Workspace Saver Mode activation (live-first, 2026-06-14)

The live-first pivot (PR #134) left token-saver activation orphaned: the
session token-saver panel and live bridge route became read-only, and the
overlay `enabled` flag was written by nothing. Re-hosted as a
**workspace-scoped** control (activation is per-cwd, not per Claude session —
the runtime lever is the `CONTEXT_GATE` block in the folder's shared
`CLAUDE.md`, which the MCP proxy honours; the bridge never sees a Claude
session id per call).

- Activation UI: a `SaverModeActivation` sub-component (toggle + mode select +
  `blockPresent` / `mcpInstalled` status + an MCP-not-installed warning) lives
  inside the single **`token-saver` "Token saver" tab**, rendered above the
  this-session stats. (Originally shipped as a separate `ws-token-saver` "Saver
  Mode" workspace tab; merged into the Token saver tab — one tab, activation on
  top + stats below, sub-headings keep the workspace-vs-session scope clear.)
- Bridge route `GET|POST /api/claude-sessions/:dir/:id/token-saver/workspace`
  (extends `routes/claude-session-token-saver.ts`). cwd is derived server-side
  from the transcript via `resolveSessionWorkspace` — never client-supplied
  (traversal guard). POST persists `{enabled,mode}` to
  `<storeRoot>/stats/<wk>/workspace-token-saver.json` and upserts the
  CONTEXT_GATE block into `<cwd>/CLAUDE.md` via the connectors-shared
  sentinel-bounded atomic helpers. MCP install stays AgentSetupDoctor's job;
  this route only reports `mcpInstalled`.
- Source: `docs/superpowers/specs/2026-06-14-gui-workspace-token-saver-activation-design.md`.

## Connect Saver hook toggle (PR #141, 2026-06-15)

Closes the gap that "Saver Mode enabled" does nothing unless the global Claude
Code hook is installed (previously terminal-only `mega hooks install`). The
Token saver panel now renders a `HookConnection` toggle (above
`SaverModeActivation`) that connects/disconnects the **global** hook in the
background — honestly labelled global ("applies to all Claude Code sessions"),
with confirm-on-disconnect.

- Global bridge route (NOT session-scoped) `routes/claude-hooks.ts`:
  `GET /api/hooks/claude-code` → `{ connected, preInstalled, postInstalled }`,
  `POST` connect, `DELETE` disconnect. Injectable
  `RouteContext.claudeSettingsPath` (prod = `resolveClaudeCodeSettingsPath()`,
  tests inject a temp path).
- Calls `install/uninstall/readClaudeCodeHookStatus` from
  `@megasaver/connector-claude-code` (new `apps/gui` dependency); see
  [[entities/connectors-claude-code]] for atomic-write + command-level-strip.
- Client: `fetch/connect/disconnectClaudeHook` (no dir/id — global).
- Scope ≠ effect: this only **installs** the hook; per-workspace Saver enable
  (`SaverModeActivation`) is the orthogonal runtime gate. Both must hold, and
  `mega hooks saver` must resolve on PATH, for compression to run. Hooks load
  at CC **session start** → mid-session connect needs `/hooks` review or a new
  session.
- Source: `docs/superpowers/specs/2026-06-15-gui-connect-saver-hook-design.md`.

## GUI Redesign v3 (2026-07-03)

Rebuilds the app shell as a six-page amber-accented sidebar console with a
slim session cockpit, moving workspace/global panels out of the previously
overloaded cockpit. Frontend-only — no bridge/Core change.

- **Sidebar shell:** a persistent left `Sidebar`
  (`apps/gui/src/components/sidebar.tsx`) replaces the top-nav. Six items,
  amber active pill (`bg-accent text-accent-fg`). Display order lives in a
  local `NAV_ORDER` constant (Sessions, Token Saver, Memory, Workspace, Agent
  Office, Agent Setup), decoupled from the alphabetic `VIEW_IDS` tuple pinned
  in `apps/gui/src/view-id.ts` (`agent-office`, `agent-setup`, `memory`,
  `sessions`, `token-saver`, `workspace`). The `claude-sessions` view id is
  renamed to `sessions`.
- **Amber accent:** `--color-accent`/`--color-accent-fg` flip from black/white
  to amber — light `#b45309`/`#fff7ed`, dark `#f59e0b`/`#0c0d0f`. Contrast
  ≥4.5:1 pinned by `apps/gui/test/styles/accent-contrast.test.ts`.
- **Six pages:** Sessions (home — summary strip of Workspaces/Sessions/Live
  counts over the grouped session list, feeding the slim cockpit), Token
  Saver, Memory, Workspace, Agent Office, Setup.
- **Workspace-context seam:** Memory and the Token Saver page's per-workspace
  saver-activation stay session-anchored at the bridge (routes take
  `dir`/`id`, not a workspace key). `apps/gui/src/lib/workspace-context.ts`
  (`deriveWorkspaceOptions`) derives one option per `cwd` from the fetched
  session list, each carrying a representative `(dir, id)` (its newest
  session); `apps/gui/src/components/workspace-picker.tsx` is the shared
  selector consumed by all workspace-scoped pages. Entirely frontend — **no
  bridge route was added** for this seam.
- **Slim cockpit:** `apps/gui/src/cockpit/session-cockpit.tsx` reduces to the
  active panel beside a right rail carrying `SessionSaverStats`
  (`apps/gui/src/cockpit/panels/session-saver-stats.tsx`, the per-session
  tokens-saved figure). The panel registry
  (`apps/gui/src/cockpit/panel-registry.ts`) shrinks to `transcript` /
  `telemetry` / `tasks`; the former workspace/memory/token-saver cockpit
  adapters and the composite token-saver panel are deleted (their underlying
  panels now compose directly into the Workspace/Memory/Token-Saver pages).
- **Deferred:** a cross-session, cross-workspace daily token-saved aggregate
  has no bridge route yet and is not shown on the home page; only the
  per-session figure (cockpit rail) is live.
- Source: `docs/superpowers/specs/2026-07-03-gui-redesign-v3-design.md`,
  `docs/superpowers/plans/2026-07-03-gui-redesign-v3.md`.

## `mega gui` — packaged GUI served by the bridge (Slice A–C, feat/mega-gui-command)

The GUI now ships inside `@megasaver/cli`: `npm i -g @megasaver/cli && mega gui`
starts the bridge (serving `/api` AND the built GUI, loopback-bound,
token-gated) and opens the browser — no clone, no `pnpm dev`.

- **Shared boot factory** — `apps/gui/bridge/start.ts`
  `startGuiBridge({storeDir,port,token?,distDir?,origins?})` is the single
  source of truth for booting: registry/office setup → handler (token + distDir)
  → loopback bind → returns `{server,url,port,token}`. `server.ts main()` (dev)
  and `mega gui` (packaged) both call it. `createBridgeServer` + `deriveGuiOrigins`
  live here (not `server.ts`) so the inlined bridge never pulls `server.ts`'s
  entrypoint boot guard — under the bundle `import.meta.url` collapses to
  `mega.mjs`, so that guard misfired and started the dev bridge on :5174 on
  EVERY `mega` command (EADDRINUSE); moving the helpers fixed it.
- **Public entry** — `@megasaver/gui` `exports` map exposes `./bridge`
  (`apps/gui/bridge/public.ts` → `startGuiBridge` + `resolveShippedGuiDistDir`),
  built by `tsup.bridge.config.ts` into `dist-bridge/{index.js,index.d.ts}`
  (workspace deps external). Building a real dist entry (not raw `.ts`) keeps the
  GUI's frontend source graph — `auth.ts`'s `import.meta.env`, `.tsx` reached via
  type-only imports — out of the CLI's `tsc` and bundle.
- **CLI command** — `apps/cli/src/commands/gui.ts` `runGui(input)`: resolve store
  (`resolveStorePath`, `--store`), ALWAYS mint a token (`crypto.randomUUID`),
  resolve the shipped distDir, `startGuiBridge(...)`, print
  `http://127.0.0.1:<port>/?token=<t>`, open the browser best-effort
  (`open`/`start`/`xdg-open`) unless `--no-open`, foreground (Ctrl-C stops).
  Registered `mega gui [--port <n>] [--no-open] [--store <dir>]` like `trace`.
  CRITICAL: there is no code path that starts the packaged GUI without the token
  wall.
- **Packaging** — `apps/cli` prepack: `pnpm --filter @megasaver/gui build` →
  `tsup` bundle (inlines the bridge via `@megasaver/gui/bridge`) →
  `scripts/copy-gui-dist.mjs` copies `apps/gui/dist` → `apps/cli/dist-bundle/gui`
  (inside published `files`) → strip manifest. `resolveShippedGuiDistDir(callerUrl)`
  resolves `dist-bundle/gui` beside the bundle, dev-fallback `apps/gui/dist`.
- **CORS from the BOUND port** — `startGuiBridge` binds first, reads the real
  ephemeral port, then derives origins from it (a `--port 0` default otherwise
  allowlisted `http://127.0.0.1:0` and 403'd every same-origin browser write).
- **Bundle smoke (proof)** — real `npm pack` → temp-prefix install → installed
  `mega gui --no-open`: `/` 200 html, `/api/health` no-token 401, `?token=` 200,
  Bearer 200, same-origin Origin 200, foreign Origin 403, bound addr 127.0.0.1.
- Source: `docs/superpowers/specs/2026-07-05-mega-gui-command-design.md`,
  `docs/superpowers/plans/2026-07-05-mega-gui-command.md`.
