---
title: OO — Split handler.ts + sessions-view.tsx per §8 file size cap
risk: MEDIUM
status: approved
issue: 58
author: executor
date: 2026-05-10
---

# OO — Split `handler.ts` + `sessions-view.tsx` per §8 file size cap

## §1 Problem

CLAUDE.md §8 mandates one responsibility per file and a 300-LOC split
threshold. Two GUI files breach the cap and the multi-concern rule:

- `apps/gui/bridge/handler.ts` — **610 LOC**, mixing CORS posture,
  request parsing, JSON body reader, response helpers (incl. the CSP
  header from #61), Zod schemas for six bodies, error-class mapping,
  and per-endpoint logic for eight routes.
- `apps/gui/src/views/sessions-view.tsx` — **333 LOC**, mixing master
  shell state + data loading + list pane JSX + detail pane JSX + two
  inline write-form orchestrations (create + update + end).

Both files were created during GUI v1 (LL, #57). Code-reviewer finding
H3 on PR #57 logged them as deferred §8 cleanup → issue #58.

## §2 Bridge split shape

Target shapes after the split:

### `apps/gui/bridge/handler.ts` — ≤ 200 LOC

Stays the public entry point. Exports `createBridgeHandler(opts)` and
the re-exports (`BRIDGE_ERROR_CODES`, `BridgeErrorCode`). Internally:
imports the response helpers, the CORS gate, the route handlers, and
dispatches based on `(method, path)` patterns. Owns:

- `sendJson(res, status, body, origin)` — response helper, MUST keep
  the `content-security-policy: default-src 'self'` header from #61.
- `sendError(res, status, code, message, origin, details?)` — error
  envelope writer.
- `readJsonBody(req)` — body reader.
- `parseUrl(req)` — URL parser.
- The dispatch flow: CORS → OPTIONS → route match → handler call.

### `apps/gui/bridge/cors.ts` — origin gate

Standalone CORS posture. Exports:

- `ALLOWED_ORIGINS` constant.
- `applyCorsPolicy(req, res, sendError): { allowed: false } | { allowed: true; origin: string | undefined }`
  — checks Origin header, writes 403 if non-loopback, returns the
  matched origin (or `undefined` for no-Origin requests) on allow.
- `handleOptionsPreflight(res, origin): void` — writes 204 + headers.

Behaviour 1:1 with current code: no Origin → allow; allow-list match
→ echo; mismatch → 403 `origin_forbidden`.

### `apps/gui/bridge/error-mapping.ts`

Centralises Core error → bridge error mapping. Exports:

- `mapCoreRegistryError(err)` — same switch as today; returns
  `{ status, code } | null`.
- `handleCaughtError(res, origin, err, sendError)` — same heuristic
  ladder: `CoreRegistryError` (mapped) → `CorePersistenceError` →
  `ErrnoException` → `internal_error`.

Routes call this to keep the error mapping identical.

### `apps/gui/bridge/zod-schemas.ts`

Shared input schemas. Exports:

- `TITLE_SCHEMA` (NFC + control-char ban).
- `CREATE_SESSION_BODY`, `END_SESSION_BODY`, `PATCH_SESSION_BODY`,
  `CREATE_MEMORY_BODY`.
- `zodErrorMessage(err)` — Zod issue → human string.

### `apps/gui/bridge/routes/*.ts`

One file per endpoint group. Each ≤ 150 LOC. Each route receives a
`RouteContext` carrying `{ req, res, registry, origin, query, newId, now, sendJson, sendError, handleCaughtError }`.

- `routes/health.ts` — `handleGetHealth(ctx, storePath)`.
- `routes/projects.ts` — `handleGetProjects(ctx)`.
- `routes/sessions.ts` — `handleGetSessions`, `handlePostSession`,
  `handlePatchSession`, `handleEndSession`.
- `routes/memory.ts` — `handleGetMemory`, `handlePostMemory`.

Routes are plain async functions. No classes. No barrel re-export.

## §3 Sessions-view split shape

### `apps/gui/src/views/sessions-view.tsx` — ≤ 200 LOC

Master shell. Owns: `useState` for sessions/loadState/loadError/
selectedId/showCreateForm/showUpdateForm/endingId/endError, refs
(listRef + errorRef), `load()` callback, `handleEnd()`, the
`useEffect` for initial load + deep-link, and the JSX composition:
`<SessionsList … />` + `<SessionsDetail … />` + toolbar +
`<CreateSessionForm …>`.

### `apps/gui/src/views/sessions-list.tsx`

Pure list pane. Props:
`{ sessions, selectedId, onSelect, listRef, onKeyDown, formatDate }`.
Renders the `role="listbox"` + each session row (`shortId`, badges,
title, formatted date). No internal state.

### `apps/gui/src/views/sessions-detail.tsx`

Pure detail pane. Props:
`{ selected, endError, errorRef, onUpdate, onEnd, endingId, showUpdateForm, onUpdated, formatDate }`.
Renders the right pane: header, metadata grid via `<Field />`, error
region, action buttons, inline `<UpdateSessionForm />`.

`Field` helper moves with the detail file (only consumer).

## §4 Test impact

Bridge tests use `createBridgeHandler({ registry })` only — the
factory contract is preserved bit-for-bit, so all eight handler-*
test files keep passing without change.

`sessions-view.test.tsx` imports `SessionsView` only — public
component contract preserved. Internal helpers (`Field`, `formatDate`,
`handleListKeyDown`) move but were never exported, so no test churn.

Integration tests render the full app shell; they exercise the
mounted views via the bridge, so they ride on the bridge + view
factory contracts.

Net: **zero test edits expected**.

## §5 Alternatives considered

- **Barrel file (`bridge/routes/index.ts` re-exporting all routes)** —
  rejected. Tiny LOC win, adds an import indirection that hides the
  call graph and risks a circular import when routes need to call
  each other in v0.2. Deep imports are simpler.

- **Keep `handler.ts` monolithic** — rejected. §8 cap is the
  trigger; this is the cleanup ticket.

- **One file per endpoint (`routes/get-projects.ts`,
  `routes/post-session.ts`, …)** — rejected. Eight files for the
  current eight endpoints is over-granular; tight-coupling within
  a group (sessions has four endpoints sharing the
  `sessionMatch` path-parsing block) makes grouping by resource the
  right shape.

- **Move CORS into `error-mapping.ts` since both write 403** —
  rejected. CORS is the gate; error-mapping is the post-handler
  ladder. Conflating the two muddles responsibility.

## §6 Migration safety

- **TypeScript catches missed imports** — every internal call site
  inside the moved code becomes an explicit import; tsc is the
  first line of defence.
- **Tests catch behavioural drift** — the 28 bridge tests run the
  real HTTP server end-to-end. Any regression in CORS, error
  envelopes, validation, or routing surfaces immediately.
- **CSP smoke** — `handler.test.ts` line 31-34 asserts the CSP
  header. Cannot regress without that test going red.
- **No new deps** — pure rearrangement. No `package.json` edit.
- **Same file boundaries** — `server.ts` imports
  `createBridgeHandler` from `./handler.js` (unchanged).
