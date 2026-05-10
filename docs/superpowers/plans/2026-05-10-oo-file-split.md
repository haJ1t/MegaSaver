---
title: Plan — OO file split (#58)
spec: 2026-05-10-oo-file-split-design.md
risk: MEDIUM
issue: 58
date: 2026-05-10
---

# Plan — OO file split (#58)

Pure structural refactor. No behavioural change. TypeScript + tests
gate every step.

## Step 1 — Extract Zod schemas

Create `apps/gui/bridge/zod-schemas.ts`. Move:

- `TITLE_SCHEMA`
- `CREATE_SESSION_BODY`
- `END_SESSION_BODY`
- `PATCH_SESSION_BODY`
- `CREATE_MEMORY_BODY`
- `zodErrorMessage(err)`

`handler.ts` re-imports them.

**Gate:** `pnpm --filter @megasaver/gui typecheck` → 0.

## Step 2 — Extract CORS gate

Create `apps/gui/bridge/cors.ts`. Move:

- `ALLOWED_ORIGINS`.
- A new `applyCorsPolicy(req, res, sendError)` function wrapping the
  Origin-header check + 403 emit.
- `handleOptionsPreflight(res, origin)` for the OPTIONS branch.

`handler.ts` uses both at the top of `handleRequest`.

**Gate:** bridge tests (`pnpm --filter @megasaver/gui test test/bridge`) → green.

## Step 3 — Extract error mapping

Create `apps/gui/bridge/error-mapping.ts`. Move:

- `mapCoreRegistryError(err)`.
- `handleCaughtError(res, origin, err, sendError)` (now takes
  `sendError` as a dependency).

Routes call `handleCaughtError` directly.

**Gate:** all bridge tests → green.

## Step 4 — Extract route handlers

Create `apps/gui/bridge/routes/` directory. Create:

- `routes/health.ts` — `handleGetHealth(ctx, storePath)`.
- `routes/projects.ts` — `handleGetProjects(ctx)`.
- `routes/sessions.ts` — four exported handlers
  (`handleGetSessions`, `handlePostSession`, `handlePatchSession`,
  `handleEndSession`).
- `routes/memory.ts` — `handleGetMemory`, `handlePostMemory`.

Each takes a `RouteContext` (defined in `handler.ts` or a small
`bridge/route-context.ts`). Move the corresponding switch-case body
from `handler.ts` into the new file.

`handler.ts` becomes a dispatch table that calls these.

**Gate:** all bridge tests → green per group.

## Step 5 — Verify handler.ts ≤ 200 LOC

After steps 1-4, `handler.ts` should be: imports + factory entry +
dispatch + the three response helpers (`sendJson`, `sendError`,
`readJsonBody`, `parseUrl`). The CSP header lives inside `sendJson`.

**Gate:** `wc -l apps/gui/bridge/handler.ts` ≤ 200.

## Step 6 — Extract sessions-list pane

Create `apps/gui/src/views/sessions-list.tsx`. Move the
`role="listbox"` block + row rendering + `formatDate` helper + the
keyboard handler signature (as a prop).

Props: `{ sessions, selectedId, onSelect, listRef, onKeyDown }`.

**Gate:** view tests → green.

## Step 7 — Extract sessions-detail pane

Create `apps/gui/src/views/sessions-detail.tsx`. Move the right-pane
JSX, the inline `<Field />` helper, `<UpdateSessionForm>` usage, the
end-action buttons + endError region.

Props:
`{ selected, endError, errorRef, onEnd, onUpdate, endingId, showUpdateForm, setShowUpdateForm, onUpdated, formatDate }`.

**Gate:** view tests → green.

## Step 8 — Thin sessions-view.tsx

Master shell composes `<SessionsList />` + `<SessionsDetail />`, owns
state + data loading + write-form orchestration.

**Gate:**
- `wc -l apps/gui/src/views/sessions-view.tsx` ≤ 200.
- `pnpm --filter @megasaver/gui test` → all green.

## Step 9 — Full verify + smoke + commit

- `pnpm --filter @megasaver/core build`
- `pnpm --filter @megasaver/gui typecheck`
- `pnpm --filter @megasaver/gui test`
- `pnpm verify`
- `wc -l` of every new file — each < 300.
- Smoke: `curl /api/health` (CSP), `curl /api/projects` (200),
  `curl -H "Origin: https://evil…" …` (403).
- Wiki log + `wiki/entities/gui.md` update.
- Single squash commit with the message from the issue body.
- Push, open PR.
