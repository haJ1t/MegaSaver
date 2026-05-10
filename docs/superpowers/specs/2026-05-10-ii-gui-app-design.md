---
title: II — GUI app bootstrap (apps/gui)
date: 2026-05-10
status: approved
risk: MEDIUM
author: feat/ii-gui-app
---

# II — GUI App Bootstrap (`apps/gui`)

## Problem

Mega Saver v0.2 ships as CLI only. The store on disk
(`~/.local/share/megasaver` by default, or `--store` override) holds
projects, sessions, and memory entries as JSON. Today the only way to
inspect that state is the `mega` command. v0.3 calls for a GUI app
that lets the developer browse the same state in a window. This spec
covers the v0.3 II slice: **bootstrap only**, two read views, smoke
test. Not feature-complete.

## Goal

Land `apps/gui` as a new workspace package whose `dev` script opens
a window/page with two views:

- **Sessions** — lists sessions across all projects in the active store.
- **Memory entries** — lists memory entries across all projects in
  the active store.

A reload re-fetches from disk. No write paths, no filtering UI, no
project picker; v0.3 ships the read shell only.

## Framework Decision

Four options were on the table:

| # | Option | Pros | Cons | Verdict |
|---|---|---|---|---|
| 1 | Tauri (Rust + system webview) | small bundle, native | Rust toolchain dep | rejected — adds a non-Node toolchain to repo CI risk surface |
| 2 | Electron (Node + Chromium) | familiar | heaviest (~150 MB), bloats `apps/gui` deps | rejected — bootstrap only, packaging overkill |
| 3 | Plain Vite + React + Tao/Wails | flexible | unproven combo, packaging undefined | rejected — unfamiliar shape |
| 4 | **Vite + React SPA + tiny Node bridge** | smallest possible diff, all-Node, runs in browser, packaging deferred to v0.4 | no signed binary | **selected** |

**Selection: Option 4.**

Rationale:

- **No new toolchain.** Pure Node/pnpm/TypeScript. CI behavior matches
  every other workspace package.
- **`@megasaver/core` is reused directly.** The bridge imports the
  same `JsonDirectoryRegistry` the CLI uses. No subprocess parsing,
  no `--json` shape duplication.
- **Smallest viable bootstrap.** Vite dev server + a 30-LOC HTTP
  bridge using `node:http`. No Express, no fastify, no `@types/cors`.
- **Packaging deferred.** v0.4 II series can add Tauri or Electron
  on top of the same React component tree. The shell stays portable.
- **Browser-native preview.** `pnpm --filter @megasaver/gui dev`
  prints a URL; the developer opens it. Matches the CLI's
  zero-ceremony onboarding.

The "GUI" in v0.3 is therefore a **localhost web app**, not a
windowed binary. This matches the wiki v0.2 close-out note:
"GUI app: deferred (CLI-first per v0.1 decision)" — v0.3 lifts that
deferral but keeps shipping discipline tight.

## Architecture

```
apps/gui/
├─ package.json           # @megasaver/gui, ESM, type=module
├─ tsconfig.json          # extends ../../tsconfig.base.json (DOM lib added)
├─ tsconfig.test.json     # vitest typecheck
├─ tsconfig.test-d.json   # closed-enum tuple-ordering pins
├─ vite.config.ts         # Vite + React plugin, /api proxy → bridge
├─ vitest.config.ts       # vitest run + jsdom env
├─ biome.json (optional)  # per-package overrides if needed
├─ index.html             # Vite entry
├─ src/
│  ├─ main.tsx            # React mount
│  ├─ app.tsx             # <App /> root with view switcher
│  ├─ views/
│  │  ├─ sessions-view.tsx
│  │  └─ memory-view.tsx
│  ├─ lib/
│  │  └─ api-client.ts    # fetch wrappers for /api/sessions, /api/memory
│  └─ view-id.ts          # ViewId closed enum (sessions | memory)
├─ bridge/
│  ├─ server.ts           # node:http bridge, imports @megasaver/core
│  └─ store-path.ts       # resolves store dir same way CLI does
└─ test/
   ├─ app.test.tsx        # smoke test: renders without crash
   └─ view-id.test-d.ts   # tuple-ordering pin
```

### Data flow

```
Browser SPA (Vite dev:5173)
   ↓ fetch /api/sessions, /api/memory
Vite dev proxy
   ↓ http://localhost:5174/api/...
Bridge server (node:http, imports @megasaver/core)
   ↓ JsonDirectoryRegistry.listSessions() / .listMemoryEntries()
~/.local/share/megasaver/{projects,sessions}.json + entries dir
```

The bridge process is a separate Node process started by a `pnpm
--filter @megasaver/gui bridge` script. The `dev` script runs both
concurrently using `npm-run-all` (already-on-disk) — or simpler,
two terminals. Bootstrap accepts the two-terminal flow; one-command
`dev` lands in a follow-up.

**Trade-off documented:** v0.3 ships `pnpm --filter @megasaver/gui
dev` as the Vite-only script. A separate `bridge` script must be
run alongside. This is honest bootstrap shape — not pretending to
be a single-command experience until packaging lands.

### Bridge endpoints

| Endpoint | Method | Returns |
|---|---|---|
| `GET /api/health` | GET | `{ ok: true, store: "<absolute path>" }` |
| `GET /api/sessions` | GET | flat array of every session across every project (each carries its `projectId`) |
| `GET /api/memory` | GET | flat array of every memory entry across every project |

Shape note: bridge returns the registry's native JSON shape directly,
without per-command renaming. This matches the v0.2 `--json` policy
(`wiki/entities/cli.md` JSON output policy).

### Store path resolution

The bridge reuses the CLI's resolution rules:

1. `--store <dir>` flag (bridge CLI flag, passed via env or argv) →
2. `XDG_DATA_HOME/megasaver` →
3. `$HOME/.local/share/megasaver`.

For v0.3 bootstrap, the bridge accepts only the env-var path
(`MEGASAVER_GUI_STORE`) plus the XDG/HOME fallbacks. A `--store`
flag at the bridge layer is a v0.4 follow-up.

## Closed-Enum Discipline

The only new enum is `ViewId`:

```ts
export const VIEW_IDS = ["sessions", "memory"] as const;
export type ViewId = typeof VIEW_IDS[number];
```

Pinned via `view-id.test-d.ts` with a tuple-ordering assertion
parallel to AA3 (alphabetic for human-facing rendering). Member
addition requires updating the assertion explicitly. No additional
enums introduced.

## Tests

One smoke test minimum (per task):

1. **`app.test.tsx`** — `import { App } from "../src/app"`, render
   with `@testing-library/react`, assert the view-switcher renders
   without throwing and shows both view labels. Bridge calls are
   mocked at the `fetch` boundary via `vi.stubGlobal("fetch", ...)`.

Plus one type-level test:

2. **`view-id.test-d.ts`** — tuple-ordering assertion.

No bridge-process tests in v0.3. Bridge is dev-only, dev surface
area covered by manual smoke (visit the URL, see entries).

## Scripts

```jsonc
// apps/gui/package.json scripts
{
  "dev": "vite",
  "bridge": "node --import tsx bridge/server.ts",
  "build": "vite build",
  "test": "vitest run",
  "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
  "clean": "rm -rf dist .turbo"
}
```

Root `pnpm test` (Turborepo) runs `apps/gui` tests, since the
package is in the workspace. Root `pnpm build` runs `vite build`
(emits static SPA bundle into `apps/gui/dist`). `pnpm build`
output is **not** a runnable binary — it is a static SPA + the
bridge stays a Node script. Bootstrap accepts this asymmetry.

## Biome Build Artifacts

Vite emits `dist/` for the SPA bundle. The root `biome.json`
already ignores `**/dist`, so no additional ignores are required.

## Workspace Wiring

- `pnpm-workspace.yaml` already includes `apps/*`. The new package
  picks up automatically.
- Root `package.json` unchanged. All Vite/React/Vitest-React deps
  scoped to `apps/gui/package.json`.

## Risk

MEDIUM. New surface area (React + Vite) but no existing-feature
regressions possible — the bridge is read-only and the SPA is
isolated to `apps/gui`. CLI byte-compat is unchanged. Core is
unchanged.

## Out of Scope (v0.3 II)

- Project picker / filtering UI
- Memory entry detail view (show single entry's full content)
- Session detail view (show single session's risk/agent/title)
- Write actions (create session, create memory, end session)
- Packaging into native window (Tauri/Electron) — v0.4
- Single-command `dev` (Vite + bridge under one process) — v0.4
- `--store` flag at bridge CLI layer — v0.4
- Auth, multi-store switching, settings page

## Definition of Done (II only)

1. `pnpm install` succeeds at repo root.
2. `pnpm exec vitest run --no-coverage` from worktree root passes
   (existing 587 + new app smoke test).
3. `pnpm --filter @megasaver/gui dev` runs (opens browser).
4. `pnpm --filter @megasaver/gui bridge` runs (serves `/api`).
5. Manual smoke: with a seeded store, both views render at least
   one row.
6. Biome clean (`pnpm lint`).
7. Wiki entry appended to `wiki/log.md` under 2026-05-10.
8. PR opened with title `feat(apps): GUI app bootstrap (II)`.
