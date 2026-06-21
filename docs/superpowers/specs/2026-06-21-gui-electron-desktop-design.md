---
topic: gui-electron-desktop
date: 2026-06-21
risk: MEDIUM
status: approved
---

# GUI Electron Desktop Window — Design

## Goal

Run the Mega Saver GUI (`@megasaver/gui`) as a desktop application window
instead of a browser tab. Scope for now: a working desktop window launched
by a single command. A packaged installer (`.dmg`/`.app`, code signing,
cross-platform) is explicitly out of scope and deferred.

## Context

`apps/gui` is a Vite + React renderer plus a Node bridge HTTP server
(`bridge/server.ts`, default port 5174) built on `@megasaver/core` and
`@megasaver/mcp-bridge`. The renderer calls the bridge through relative
`/api/*` paths; `vite.config.ts` already proxies `/api` to the bridge port.
There is no Electron wiring today.

## Approach (chosen: A)

**A — Electron loads the running Vite dev server.** Electron's main process
opens a `BrowserWindow` pointed at `http://localhost:5173`. The existing Vite
proxy forwards `/api` to the bridge (5174). Renderer, bridge, and
`vite.config.ts` are unchanged. Reuses all existing infra; hot reload works.

Rejected alternatives:
- **B** — Electron loads a production static build, bridge serves `dist/`.
  Needs a new static route on the bridge and Electron pointed at 5174. This
  is the natural installer-phase path; unnecessary for a working window.
- **C** — Electron loads `file://dist` with the renderer API base switched to
  absolute `http://localhost:5174` plus bridge CORS. Most invasive (renderer
  change). Rejected.

## Components

1. `apps/gui/electron/main.cjs` — Electron main process (CommonJS so Electron
   loads it directly, no build step). Creates a 1280×800 `BrowserWindow`
   titled "Mega Saver", loads `process.env.MEGASAVER_GUI_URL` or
   `http://localhost:5173`. Standard lifecycle: quit when all windows close
   (except macOS convention), re-create window on `activate`.
2. `apps/gui/package.json`:
   - devDependencies: `electron`, `wait-on`.
   - script `app`: runs Vite + bridge + Electron via `concurrently`, with
     `wait-on tcp:5173` gating Electron until Vite is ready.
3. Renderer / bridge / `vite.config.ts`: unchanged.

## Data flow

Electron window → Vite (5173) → React → `/api/*` → Vite proxy → bridge
(5174) → `@megasaver/core` store. Identical to the browser path; only the
host chrome changes (Electron instead of a browser tab).

## Testing & verification

The Electron main is BrowserWindow boilerplate plus a single env-default
(`MEGASAVER_GUI_URL || http://localhost:5173`) — orchestration/config with no
branching logic worth a unit test. Verification is the appropriate evidence
for a launch feature (DoD item 5, GUI → captured run):

- `pnpm --filter @megasaver/gui app` opens an Electron window.
- The window renders the Mega Saver UI (workspaces list loads from the
  bridge), confirming the proxy → bridge → core path works inside Electron.

## Risk

MEDIUM — dev tooling only. New dev dependency; no user-data mutation; no
changes to `@megasaver/core` or any connector path.

## Tradeoffs

- `electron` as a devDependency makes every `pnpm install` (incl. CI) fetch
  the ~150MB Electron binary. Acceptable for a single-developer project; can
  be moved to on-demand install later if CI cost matters.

## Out of scope (installer phase)

`.dmg`/`.app` packaging, code signing/notarization, serving the static build
without Vite, cross-platform builds.
