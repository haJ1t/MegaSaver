---
title: Agent Office Phase 3 — Bridge /api/office routes + audit SSE
status: draft
risk: high
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
parent_spec: docs/superpowers/specs/2026-06-22-agent-office-design.md
safety_confirmation: >
  Exposes office control (create agents, assign tasks, run the supervisor) over
  the localhost GUI bridge. Carries the CRITICAL safe-by-default contract: the
  bridge constructs the supervisor with `allowFull` = false unless the
  `MEGA_OFFICE_ALLOW_FULL` env var is explicitly set; create payloads are
  re-validated at the HTTP boundary, and `allowedTools` entries are rejected if
  they could inject CLI flags (no leading `-`). The bridge binds localhost only
  (existing GUI bridge behavior).
---

# Agent Office Phase 3 — Bridge

## Summary

Expose the office over the GUI bridge: REST `/api/office/*` routes for role /
agent / task CRUD, supervisor control (run / pause / resume / stop), an audit
feed, a status snapshot, and an SSE stream of office state changes. This is the
runtime that drives the Phase 2 supervisor with the real claude-code launcher.

## Scope (all in `apps/gui/bridge`)

1. Office deps on `RouteContext` (injected; fake in tests).
2. `routes/office.ts` — the handlers.
3. Dispatch wiring in `handler.ts` (path-match, mirroring existing routes).
4. HTTP-boundary validation (zod create-input schemas + `allowedTools` guard).
5. Audit-tail SSE.
6. Server deps assembly in `server.ts` (production CoreRegistry + claude-code
   launcher registry + allowFull-from-env).

## Non-goals

- No GUI components (Phase 4) — this is the API only.
- No per-agent claude raw-transcript SSE — Phase 4 may add it; Phase 3 streams
  office-native state (agent status + tasks + audit), which answers "what is
  each agent doing" at the task level.
- No new agent kinds (claude-code only, per the registry).

## Risk & process

HIGH (network-exposed spawn control, localhost). Reviews: code-reviewer +
critic + security-reviewer. Route handlers are plain async fns tested in
isolation with a fake `RouteContext` (fake CoreRegistry + fake launcher
registry + tmp storeRoot) — no real `claude`, no real HTTP server in unit tests.

## §1 RouteContext office deps

Add (optional so existing tests/handlers are unaffected):

```ts
office?: {
  coreRegistry: CoreRegistry;           // @megasaver/core
  registry: LauncherRegistry;           // @megasaver/agent-office
  allowFull: boolean;
};
```

`createBridgeHandler` resolves it (production) / accepts an injected fake
(tests). Routes that need it 400/500 cleanly if absent (should never be absent
in production).

## §2 Routes (`routes/office.ts`)

Roles (global):
- `GET  /api/office/roles` → `listRoles`
- `POST /api/office/roles` → validate role-create-input → build full `Role`
  (server `newId()` + `now()`) → `saveRole` → 201 the role
- `DELETE /api/office/roles/:roleId` → `deleteRole` → 204

Agents (workspace-scoped):
- `GET  /api/office/:wk/agents` → `listAgents`
- `POST /api/office/:wk/agents` → validate agent-create-input (roleId, name,
  workdir; `kind` defaulted from the role; status defaults `idle`) → build
  `OfficeAgent` → `saveAgent` → 201
- `DELETE /api/office/:wk/agents/:agentId` → `deleteAgent` → 204

Tasks:
- `GET  /api/office/:wk/agents/:agentId/tasks` → `listTasks`
- `POST /api/office/:wk/agents/:agentId/tasks` → validate `{ instruction }` →
  build `OfficeTask` (status `queued`, `queuedAt`) → `saveTask` → 201

Control:
- `POST /api/office/:wk/agents/:agentId/run` → kick off
  `supervisor.drainAgent(wk, agentId)` in the background (fire-and-forget; the
  handler returns 202 immediately with the current agent snapshot). The
  supervisor persists task/agent/audit progress; clients observe via status /
  SSE. A run already in progress is a no-op-accept (agent already `working`).
- `POST /api/office/:wk/agents/:agentId/control` `{ action: "pause"|"resume"|"stop" }`
  → transition `agent.status` (pause: working/idle→paused; resume: paused→idle;
  stop: →stopped). `resume` from `error` also allowed (clears the error).
  Persist; 200 the agent.

Observability:
- `GET  /api/office/:wk/audit` → `listAudit`
- `GET  /api/office/:wk/status` → `{ agents: [{ agent, currentTask, lastEvent }] }`
  where currentTask = the agent's `running` task (or earliest queued), lastEvent
  = newest audit row for the agent.
- `GET  /api/office/:wk/stream` → SSE: emit a `snapshot` event (the status
  payload), then re-emit `status` on audit-dir change (fs.watch the
  `office/<wk>/audit` dir, debounced), heartbeat comment ~15s, clean up watcher
  on `req` close. Mirror the SSE mechanics in `routes/claude-sessions.ts`.

All `:wk`/`:roleId`/`:agentId` segments are decoded + validated; path-safety is
already enforced inside the agent-office stores (`assertSafeSegment`), but the
routes also reject obviously bad ids (400) before calling the engine.

## §3 Validation (HTTP boundary)

Re-parse request bodies (parse-on-handoff) with dedicated input schemas in
`routes/office.ts` (NOT the full entity schemas, since the server supplies
id/createdAt/status):

- `roleCreateInputSchema`: `name` (titleSchema), `kind` (agentIdSchema), `persona`
  (min 1), `model` (roleModelSchema), `allowedTools` (array of
  `allowedToolSchema`), `skillPacks` (array of string), `permissionMode`
  (rolePermissionModeSchema), `defaultWorkdir?` (min 1).
- `allowedToolSchema = z.string().min(1).regex(/^[^-]/, "tool must not start with '-'")`
  — **security: prevents a tool entry from injecting a CLI flag** (e.g.
  `--add-dir`) when spread into the claude argv. (Addresses the Phase 2
  security carry-over.)
- `agentCreateInputSchema`: `name` (titleSchema), `roleId` (roleIdSchema),
  `workdir` (min 1). (`kind` derived from the loaded role; status `idle`.)
- `taskCreateInputSchema`: `instruction` (min 1).
- `controlInputSchema`: `action` enum `pause|resume|stop`.

On invalid body → `sendError(400, "invalid_request", …)`. Map `AgentOfficeError`
codes to HTTP: `not_found`→404, `schema_invalid`/`permission_denied`→400,
`launcher_not_registered`→500, `store_corrupt`/`write_failed`→500.

## §4 Server deps assembly (`server.ts`)

Production office deps:
- `coreRegistry = createJsonDirectoryCoreRegistry(storeRoot)` (or the existing
  registry the bridge already uses, if any — reuse it).
- `registry = createLauncherRegistry([createClaudeCodeLauncher()])`.
- `allowFull = process.env.MEGA_OFFICE_ALLOW_FULL === "1"` (default false).
- A supervisor is created per office request (or once) via `createSupervisor({
  storeRoot, registry, coreRegistry, projectId, now, newId, allowFull })`. The
  owning `projectId` for created Sessions: derive a stable office project id
  (e.g. a fixed namespace id) — document the choice.

## Testing

Route-level unit tests (no HTTP server, no real claude): build a fake
`RouteContext` with a tmp `storeRoot`, an in-memory `CoreRegistry`, and a
`LauncherRegistry` wrapping a fake launcher; call each handler with a fake
`req`/`res` capturing `sendJson`/`sendError`. Cover:
- role/agent/task create (happy + invalid body 400 + `allowedTools` with a
  leading-`-` rejected), list, delete.
- run → drives the supervisor (fake launcher) → task ends done; status reflects
  it; audit rows present.
- control pause/resume/stop transitions.
- status snapshot shape; SSE emits an initial snapshot (test the handler writes
  the snapshot frame; fs.watch behavior can be lightly tested or the watcher
  injected).
- error mapping (not_found→404, permission_denied→400, etc.).
- allowFull defaulting: with allowFull false, a `full`-role agent run → task
  failed (permission_denied surfaced via audit/status), no spawn.

## Definition of Done

- Routes + dispatch + validation + SSE + server wiring implemented.
- Unit tests green (fake context; no real claude/HTTP). `pnpm verify` green on
  ubuntu + windows. Commit the lockfile if deps change.
- Changeset (minor: `@megasaver/gui`; patch any others touched).
- code-reviewer + critic + security-reviewer (author ≠ reviewer).

## Follow-ups

- Per-agent claude raw-transcript SSE (Phase 4).
- Surface launcher live `onEvent` activity on the agent record (Phase 4).
- Rate-limit / auth on office routes if the bridge ever binds non-localhost.
