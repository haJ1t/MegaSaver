---
title: Agent Office Phase 2 — Supervisor (queue loop, permission gating, core Session, audit)
status: draft
risk: critical
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
parent_spec: docs/superpowers/specs/2026-06-22-agent-office-design.md
safety_confirmation: >
  Carries forward the user's CRITICAL safety sign-off from the parent spec
  (2026-06-22): office-spawned agents are safe-by-default. Phase 2 ENFORCES
  that: an agent's effective permission mode is its role's mode, but `full`
  (→ launcher `full` → claude `bypassPermissions`) is refused unless an
  explicit `allowFull` flag is passed at supervisor construction. Without it,
  a `full` role's task fails closed (never silently downgraded, never run with
  write/bypass power). All spawns + lifecycle transitions are recorded to an
  append-only office audit log with full metadata. Workdir confinement: each
  agent runs with cwd = its workdir, no `--add-dir`.
---

# Agent Office Phase 2 — Supervisor

## Summary

Wire the Phase 1 launcher into the office: a **supervisor** that pulls queued
`OfficeTask`s for an agent, enforces the safe-by-default permission policy,
creates a `@megasaver/core` Session, spawns the agent via the injected
launcher (resuming session for queue continuity), drives it to completion, and
records spawn + lifecycle to an append-only audit log. Risk **CRITICAL** —
this is the code that actually runs agents that modify repos.

## Scope

All in `@megasaver/agent-office` (gains deps `@megasaver/core`,
`@megasaver/connectors-shared`):

1. **Permission policy** (pure) — `resolveLauncherPermission`.
2. **Launcher registry** — `createLauncherRegistry`.
3. **Office audit log** — append-only atomic-json, metadata-complete.
4. **Supervisor** — `createSupervisor` (`processNextTask`, `drainAgent`,
   `runWorkspace`).
5. **Tighten `workspaceKey`** on `OfficeAgent`/`OfficeTask` to the branded
   `workspaceKeySchema` (carry-over from Phase 1 review).
6. **`cancel(signal?)`** on the launcher handle (connectors-shared +
   claude-code), enabling later SIGKILL escalation.

## Non-goals (later phases / deferred)

- No long-running daemon / process loop, no timers — the supervisor is a
  testable engine driven by callers (the bridge/CLI run it). SIGKILL
  *escalation timer* is a runtime concern (Phase 3).
- No bridge routes, GUI, or CLI (Phases 3–5).
- No full `@megasaver/evidence-ledger` integration — its `appendEvidence` API
  is content-redaction-shaped (requires `redactSourceRef`, `redactedRawContent`,
  `policyVersion`, …), a poor fit for spawn events. Phase 2 uses a dedicated
  lightweight office audit log; redaction-grade ledger integration is a future
  enhancement. (Recorded as a follow-up.)

## Risk & process

CRITICAL. Per §12: full chain + architect-grade design (this spec) + **critic**
adversarial review + **security-reviewer** + verifier. No autopilot/ralph.
Tests inject a **fake launcher** (no real `claude`) and the in-memory
`CoreRegistry` (`createInMemoryCoreRegistry`).

## §1 Permission policy (`src/permission.ts`)

`Role.permissionMode` (`plan|acceptEdits|full`) maps 1:1 to the launcher's
`LauncherPermissionMode`. The gate:

```ts
export function resolveLauncherPermission(
  roleMode: RolePermissionMode,
  opts: { allowFull: boolean },
): LauncherPermissionMode {
  if (roleMode === "full" && !opts.allowFull) {
    throw new AgentOfficeError(
      "permission_denied",
      "Role requests full permissions but allowFull was not granted.",
    );
  }
  return roleMode;
}
```

Add `permission_denied` and `launcher_not_registered` to
`agentOfficeErrorCodeSchema`.

## §2 Launcher registry (`src/launcher-registry.ts`)

```ts
export interface LauncherRegistry {
  get(kind: AgentId): AgentLauncher;
}
export function createLauncherRegistry(launchers: readonly AgentLauncher[]): LauncherRegistry;
```

`get` throws `AgentOfficeError("launcher_not_registered", …)` for an
unregistered kind. Duplicate kinds → last wins is rejected (throw at
construction on duplicate).

## §3 Office audit log (`src/audit.ts` + `src/audit-store.ts`)

```ts
export const auditEventTypeSchema = z.enum(["spawn", "task_done", "task_failed"]);
export const auditEventSchema = z.object({
  id: z.string().min(1),               // uuid; path segment (assertSafeSegment)
  ts: z.string().datetime({ offset: true }),
  type: auditEventTypeSchema,
  workspaceKey: workspaceKeySchema,
  officeAgentId: officeAgentIdSchema,
  taskId: officeTaskIdSchema,
  kind: agentIdSchema,
  permissionMode: rolePermissionModeSchema,
  workdir: z.string().min(1),
  coreSessionId: sessionIdSchema,
  claudeSessionId: z.string().min(1),
  exitCode: z.number().int().nullable().optional(),
}).strict();
```

Persist append-only: `office/<wk>/audit/<id>.json` (atomic-write, path-safe).
`appendAudit({storeRoot, event})`, `listAudit({storeRoot, workspaceKey})`
(sorted by `ts`). Mirrors the existing store idioms (`AgentOfficeError`,
zod-on-load).

## §4 Supervisor (`src/supervisor.ts`)

```ts
createSupervisor(deps: {
  storeRoot: string;
  registry: LauncherRegistry;
  coreRegistry: CoreRegistry;
  projectId: ProjectId;          // owning project for created Sessions
  now: () => string;             // ISO-8601
  newId: () => string;           // uuid factory
  allowFull?: boolean;           // default false (safe-by-default)
}): Supervisor
```

`Supervisor`:

- `processNextTask(workspaceKey, officeAgentId): Promise<OfficeTask | null>`
  1. Load agent (`loadAgent`); if status `error`/`stopped`/`paused` → return null (don't run).
  2. Load tasks (`listTasks`); pick the earliest `queued` by `queuedAt`; none → return null.
  3. Load role (`loadRole(agent.roleId)`). `resolveLauncherPermission(role.permissionMode, {allowFull})` — on throw: mark task `failed` (record nothing spawned), agent `error`, audit `task_failed` (with the not-yet-created session? no session → use a sentinel: skip session fields by failing BEFORE session creation; see error handling), return task.
  4. Mark task `running` (startedAt=now), agent `working`; persist both.
  5. `coreRegistry.createSession({ id: newId(), projectId, agentId: agent.kind, riskLevel: "high", title: truncate(task.instruction), startedAt: now(), endedAt: null })`.
  6. Decide session continuity: if `agent.claudeSessionId` set → `resumeSessionId`; else `sessionId = newId()` (a fresh claude session id).
  7. `appendAudit(spawn, …)`.
  8. `handle = registry.get(agent.kind).launch(launchInput)`. Subscribe `onEvent` (Phase 2: ignore payloads; presence proves wiring) and `onExit`. `await` exit via `new Promise(res => handle.onExit(res))`.
  9. Exit `code === 0` → task `done` (finishedAt, exitCode 0); agent `idle`, `claudeSessionId = handle.sessionId`; `coreRegistry.endSession`; audit `task_done`. Non-zero/null → task `failed`; agent `error`; `endSession`; audit `task_failed`. Persist task + agent. Return task.

- `drainAgent(workspaceKey, officeAgentId): Promise<OfficeTask[]>` — loop
  `processNextTask` until it returns null (no queued / agent not runnable);
  return the processed tasks.

- `runWorkspace(workspaceKey, opts?: { maxConcurrent?: number }): Promise<void>`
  — `listAgents`, drain each agent's queue, at most `maxConcurrent` agents in
  flight (default 4) via a small promise pool. Agents are independent.

`truncate(instruction)`: Session title is the first 120 chars of the
instruction (Session.title is nullable; never empty → fallback to a constant if
the instruction is whitespace, though `OfficeTask.instruction` is `.min(1)`).

## §5 Schema tighten + launcher cancel(signal)

- `OfficeAgent.workspaceKey` and `OfficeTask.workspaceKey`:
  `z.string().min(1)` → `workspaceKeySchema`. Fixtures already use a valid
  16-hex key, so tests are unaffected.
- `LaunchHandle.cancel(signal?: NodeJS.Signals)` (default `"SIGTERM"`) in
  connectors-shared; claude-code adapter forwards the signal to `child.kill`.
  Existing `cancel()` callers unaffected (optional arg).

## Error handling

- `permission_denied` / `launcher_not_registered` → task `failed` with the
  error recorded; agent `error`. For `permission_denied`, the failure happens
  **before** session creation, so the `task_failed` audit for this case omits
  `coreSessionId`/`claudeSessionId` — therefore audit events for pre-spawn
  failures are NOT written through the spawn-shaped schema; instead the task is
  simply marked failed (no audit row, since nothing spawned). Spawn/done/failed
  audit rows are only written once a spawn has a session. (Keeps the audit
  schema's required session fields honest.)
- Launcher spawn error (exit code null) → task `failed`, agent `error`, audit
  `task_failed` with `exitCode: null`.
- Store/schema errors propagate as `AgentOfficeError`.

## Testing (no real claude; in-memory core)

- **permission policy:** plan/acceptEdits pass; full throws without `allowFull`,
  passes with it.
- **registry:** get returns the launcher by kind; unknown kind throws; duplicate
  kinds throw at construction.
- **audit store:** round-trip, list sorted by ts, path-safety, store_corrupt.
- **supervisor (fake launcher + in-memory CoreRegistry + tmp store):**
  - new-session run: queued→running→done; agent idle + claudeSessionId set to
    the assigned id; a core Session created then ended; spawn + task_done audit
    rows written; LaunchInput has the right model/persona/allowedTools/workdir
    and `--session-id` path (first run).
  - resume run: agent with existing claudeSessionId → LaunchInput uses
    `resumeSessionId`; handle.sessionId carried back.
  - failed run (fake launcher exits non-zero) → task failed, agent error,
    task_failed audit.
  - spawn-error run (exit code null) → task failed, agent error.
  - permission gate: full role without allowFull → task failed, no spawn, no
    launcher call; with allowFull → spawns with `full`.
  - drainAgent processes queued tasks in `queuedAt` order, stops on failure.
  - runWorkspace drains multiple agents within the concurrency cap.
  - paused/stopped/error agent → processNextTask returns null (no run).

## Definition of Done

- Permission policy, registry, audit store, supervisor implemented + exported.
- `workspaceKey` branded on agent/task schemas; `cancel(signal?)` added.
- Full test suite green with fake launcher + in-memory core (no real claude).
- `pnpm verify` green on ubuntu + windows CI.
- Changeset (minor: agent-office, connectors-shared, connector-claude-code).
- code-reviewer + critic + security-reviewer passes (author ≠ reviewer).

## Follow-ups (recorded for later phases)

- SIGKILL escalation timer (Phase 3 runtime).
- Event buffering for async subscribers (launcher onEvent) if a Phase 3 caller
  subscribes after an `await` — current supervisor subscribes synchronously.
- Redaction-grade `evidence-ledger` integration for audit (replace/augment the
  lightweight log).
- Surface live activity (last event) on the agent for the board (Phase 3/4).
