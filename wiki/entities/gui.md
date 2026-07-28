---
title: '@megasaver/gui'
tags: [entity, app, gui, v0.4]
sources:
  - docs/superpowers/specs/2026-05-10-ii-gui-app-design.md
  - docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md
  - docs/superpowers/specs/2026-07-03-gui-redesign-v3-design.md
  - docs/superpowers/plans/2026-07-03-gui-redesign-v3.md
  - docs/superpowers/specs/2026-07-28-gui-console-redesign-design.md
  - docs/superpowers/plans/2026-07-28-gui-console-redesign.md
status: published
created: 2026-05-10
updated: 2026-07-28
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
`apps/gui/DESIGN.md` ("Console" since 2026-07-28 — Instrument Sans +
Instrument Serif + DM Mono, warm paper + amber accent; light/dark
follows the OS **and** can be pinned by a sidebar toggle, see the
console-redesign section below). Fonts are self-hosted `@fontsource`
packages, never Google Fonts — the bridge sends CSP `default-src 'self'`.

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

> **Superseded 2026-07-28** by the console redesign. The five files this
> section used to name (`project-picker`, `token-saver-modal`,
> `sessions-view`, `sessions-list`, `memory-view`) had all been deleted by
> earlier redesigns, so the `biome.json` override matched nothing at all.

`biome.json` now disables `useSemanticElements` for exactly one file:
`apps/gui/src/components/command-palette.tsx`, which uses
`<div role="dialog">` rather than a native `<dialog>` because jsdom does not
implement `showModal()` — a native dialog would make the palette untestable.
Escape handling and initial focus are explicit in the component.

Everything else uses native semantics: the workspace dropdown is a plain
`<ul>` of `<button>`s (a disclosure, not a listbox — buttons are natively
focusable, so no ARIA role is needed), and the toast is an `<output>`
(implicit `role=status`).

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

## Memory visualization layout (2026-07-09)

The Memory page now uses a responsive grid: notes are a bounded desktop
column, the memory graph uses the fluid remaining column, and Decision Trace
spans the complete row below. Both visualizations keep a minimum canvas height;
on smaller screens they return to a single-column flow.

Source: `docs/superpowers/specs/2026-07-09-memory-visualization-layout-design.md`.

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

## Console redesign (2026-07-28, `feat/gui-console-redesign`)

Imports the "Mega Saver Console" prototype from Claude Design
(`claude.ai/design/p/124f5957…`, `Mega Saver Console.dc.html`) and rebuilds the
shell around it. **Frontend-only** — no bridge route, no Core change, no new
`BridgeErrorCode` member. Source: the spec/plan in frontmatter.

- **Seven nav items in three groups** (`NAV_GROUPS` in `components/sidebar.tsx`):
  Monitor (Overview, Sessions) · Optimize (Token saver, Memory) · Configure
  (Workspace, Agent office, Setup). `VIEW_IDS` gains `"overview"`, still
  alphabetically pinned; `agent-setup`'s label is now "Setup".
- **New chrome:** `components/top-bar.tsx` (global workspace switcher + ⌘K
  trigger + live count), `command-palette.tsx`, `toast.tsx`, `theme-toggle.tsx`.
  The per-page `WorkspacePicker` is **deleted** — the top bar is the single
  switcher. Agent office keeps its own selector because office agents are keyed
  by workspace at the bridge, not by the session-derived option list.
- **Overview page** (`views/overview-page.tsx`, new): savings headline via
  `fetchAllWorkspaceTotals` → `computeSavingsHeadline` (the `$` is computed by
  `@megasaver/stats`, never a literal), 5 readiness checks over the existing
  hook/proxy/MCP/daemon/index routes, and a live-session list.
- **Agent office floor plan** (`views/office/office-floor.tsx`): desks rendered
  from the real roster, status-driven animation, one floor of ten. Overflow past
  ten desks is stated in the UI, never silently hidden.

### Token system v3

`tokens.css` moves from `@media (prefers-color-scheme: dark)`-only to
`:root` (light) / `[data-theme="dark"]` (manual) / `@media (prefers-color-scheme:
dark) :root:not([data-theme="light"])` (OS default). The dark palette is
therefore declared **twice** — a media query cannot join a selector list — and
`accent-contrast.test.ts` pins the two copies identical so they cannot drift.
That test also selects blocks **by selector, not by `indexOf("@media")`**, which
the old version did and which this structure breaks.

New roles (spec amendment per the `tokens.css` header rule): `--color-line-soft`,
`--color-accent-soft`, `--color-shadow`. Fonts are self-hosted `@fontsource`
packages (Instrument Sans/Serif), not Google Fonts — the bridge sends CSP
`default-src 'self'`.

**Three prototype colours were corrected for WCAG AA** and must not be reverted
(the contrast suite fails if they are): light `--color-text-muted`
`#8d877c`→`#6a645a` (3.19:1), dark `--color-text-muted` `#71747c`→`#868a93`
(3.48:1), light `--color-accent` `#b45309`→`#a84d07` (4.49:1 on the warmer
`#f4f2ee` canvas). All roles now clear 4.5:1 against background, surface, raised
and their own soft fill, in both themes.

### Deliberately NOT built (no backing route)

The prototype's script is entirely mock constants. Four surfaces had no bridge
route and were omitted rather than faked (user decision, 2026-07-28):
the 18-day savings sparkline, the cross-workspace "recent activity" feed, the
Memory "Live brain" panel, and Agent-office multi-floor + provider picker.
Building them means new endpoints, Zod boundary schemas, new `BridgeErrorCode`
members and store-root work — a materially larger, non-frontend change.

### Evidence

`pnpm verify`: biome clean, `tsc -b` clean, GUI 641 tests / 85 files green.
Note `packages/context-gate` `test/saver-seen-concurrency.test.ts` fails under a
loaded parallel `turbo` run (`expected 40 to be greater than 48`) — reproduced
on a clean tree with these changes stashed, so it is a **pre-existing
load-sensitive flake**, not a regression from this work. It passes standalone
(369/369). Related: [[concepts/redos-growth-ratio-measurement]] records the same
"ratios break under a parallel turbo run" effect.

Also cleaned up: the `biome.json` `useSemanticElements` override listed five
files that had all been deleted long before this change and matched nothing; it
now scopes to `command-palette.tsx` alone (role=dialog div, because jsdom does
not implement `showModal()`).
