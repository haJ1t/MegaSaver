---
title: '@megasaver/agent-office'
tags: [entity, package, agent-office, orchestration, roles, tasks, v0.x]
sources:
  - docs/superpowers/specs/2026-06-22-agent-office-design.md
  - docs/superpowers/plans/2026-06-22-agent-office-phase0-engine.md
status: active
created: 2026-06-22
updated: 2026-06-22
---

# `@megasaver/agent-office`

Agent Office: a control room where the user creates/removes multiple
coding agents in one "office", assigns each a **role** + a **task
queue**, and watches what each agent is doing live. The engine is
agent-agnostic; process spawning is isolated to a connector capability.

Design decisions (brainstorming 2026-06-22, see spec):

- **Hybrid** — office *launches* agents via a new connector capability
  AND *tracks* them live.
- **Four agent kinds by interface, claude-code adapter ships first**
  (codex/cursor/aider are follow-on connector specs).
- **Rich roles** — persona + model + allowed tools/skills + permission
  policy + default workdir. Predefined roster seeded from CLAUDE.md §6;
  custom roles allowed.
- **Queue + lifecycle** per agent (queued → running → done/failed).
- **Execution** — headless `claude -p "<task>" --output-format
  stream-json --resume <session>` per task.
- **Surface** — engine package + GUI board + thin `mega office` CLI.
- **Safety (risk CRITICAL)** — safe-by-default: new agents
  `permissionMode: plan` (read-only); write modes opt-in per role;
  workdir confinement; evidence-ledger audit. User sign-off recorded in
  the spec frontmatter (source: docs/superpowers/specs/2026-06-22-agent-office-design.md).

## Phase 0 shipped (engine data layer)

Branch `worktree-feat+agent-office`. New package
`@megasaver/agent-office` (depends only on `@megasaver/shared` + zod;
no core edge yet — that arrives in Phase 2's supervisor).

- Domain schemas (zod `.strict()`): `Role`, `OfficeAgent`,
  `OfficeTask`; enums `rolePermissionMode` (plan|acceptEdits|full),
  `roleModel` (opus|sonnet|haiku), `agentStatus`, `taskStatus`.
- New branded ids in `@megasaver/shared`: `roleId`, `officeAgentId`,
  `officeTaskId`.
- Atomic-json stores (content-store pattern: temp→fsync→rename,
  `assertSafeSegment` path confinement incl. NUL guard, zod on
  save+load, typed `AgentOfficeError`). Layout:
  `office/roles/<id>.json`, `office/<wk>/agents/<id>.json`,
  `office/<wk>/tasks/<agent>/<id>.json`.
- `buildPredefinedRoles({now,newId})` — 13 seed roles, ALL
  `permissionMode: plan` (safe-by-default invariant, tested).
- 57 tests, `pnpm verify` green. Risk this phase: MEDIUM (pure data
  layer; no spawning).

## Phase 1 shipped (launcher capability)

`AgentLauncher` interface (+ `LauncherError`, `launcherPermissionMode`/
`launcherModel` schemas) in `@megasaver/connectors-shared`, and a
claude-code adapter in `@megasaver/connector-claude-code`:

- `buildClaudeArgs(input)` (pure): `claude -p <instruction>
  --output-format stream-json --verbose --model <alias> --permission-mode
  <plan|acceptEdits|bypassPermissions> [--allowedTools …]
  [--append-system-prompt <persona>] (--session-id | --resume)`. Exactly
  one of new/resume session id (throws `LauncherError` otherwise).
- `createClaudeCodeLauncher({ spawn })`: injectable spawn; stdout
  line-buffered + `StringDecoder` (UTF-8 multibyte-safe) → `JSON.parse`
  (non-JSON skipped) → `{kind:"stream"}` events; stderr events;
  one-shot `onExit` latch (at-most-once, replays to late subscribers);
  `cancel()` → SIGTERM. `cwd = workdir`, no `--add-dir` (workdir
  confinement); argv array (no shell → no injection).
- Risk HIGH (introduces spawning); tests inject a fake spawn — never a
  real `claude`. `pnpm verify` green. Reviewed by code-reviewer + critic.
- Phase 2 carry-overs (from critic): event buffering for async
  subscribers, SIGKILL escalation, gate `full`/`bypassPermissions`,
  listener teardown.

## Phase 2 shipped (supervisor)

Supervisor in `@megasaver/agent-office` (now deps `core` +
`connectors-shared`):

- `resolveLauncherPermission(roleMode, {allowFull})` — safe-by-default
  gate: `full` refused (throws `permission_denied`) unless `allowFull`
  explicitly granted to `createSupervisor`; never silently downgrades or
  bypasses. (security-reviewer: airtight.)
- `createLauncherRegistry` — `get(kind)` → `AgentLauncher`; engine stays
  agent-agnostic (launchers injected).
- Office audit log (`auditEventSchema` + `appendAudit`/`listAudit`) —
  append-only, metadata-complete; spawn + terminal (done/failed) rows.
  (Lightweight; full evidence-ledger redaction integration deferred.)
- `createSupervisor` — `processNextTask`/`drainAgent`/`runWorkspace`:
  pulls earliest queued task, gates permission, creates a `core` Session,
  spawns via launcher (new `--session-id` / resume continuity), awaits
  exit, settles task+agent, audits. **Failure-hardened** (critic SHIP):
  try/catch settles task→failed + agent→error on ANY throw (no poisoned
  running/working state), endSession exactly once, terminal audit per
  spawn; `taskTimeoutMs` (30 min default) → SIGKILL on hang; agent→error
  persisted first on double-fault. `workspaceKey` branded;
  `cancel(signal?)` added. Session title is `Office: <role>` (no
  instruction cleartext in core store). Risk CRITICAL; fake launcher +
  in-memory core in tests (no real claude). 105 tests; reviewed by
  code-reviewer + critic + security-reviewer.
- Phase 3+ carry-overs: SIGKILL escalation timer wiring, event buffering
  for async subscribers, `allowedTools` validation before HTTP exposure,
  full evidence-ledger integration, a startup reconciliation reaper for
  double-fault residue.

## Phase 3 shipped (bridge)

`/api/office/*` REST routes on the GUI bridge (`apps/gui/bridge`) driving the
supervisor + claude-code launcher:

- Routes: role/agent/task CRUD, `run` (202 fire-and-forget drainAgent; no-op if
  agent already `working`), `control` (pause/resume/stop), `audit`, `status`
  snapshot, `stream` (audit-tail SSE). HTTP-boundary zod validation
  (parse-on-handoff); `wk` (workspaceKeySchema) + ids validated → 400/404.
- Safe-by-default over HTTP: `allowFull` is env-only (`MEGA_OFFICE_ALLOW_FULL=1`,
  default off) — no request field can set it; a `full` role fails closed.
  `allowedTools` leading-`-` flag-injection guard hoisted into `roleSchema`
  (launcher trust boundary) + the HTTP create schema.
- **Office Project seeded** at server startup (`ensureOfficeProject`,
  `OFFICE_PROJECT_ID`) — without it `createSession` throws `project_not_found`
  and every task fails (critic-caught prod-breaker; now covered by a
  drain-to-`done` integration test).
- Risk HIGH; reviewed by code-reviewer + critic (DO NOT SHIP → fixed → ship) +
  security-reviewer (PASS with remediations). gui 318 / agent-office 107 tests;
  tests use a fake launcher + in-memory core (no real claude, no real HTTP).
- Posture/limits (spec Non-goals): localhost-only/no-auth; `control stop` does
  NOT cancel an in-flight spawn (cooperative cancel = Phase 4); `workdir`
  unconfined (confinement deferred).

## Phases not yet built

4. GUI office board view + role manager.
5. CLI `mega office` commands.

See [[concepts/agent-agnostic-core]], [[entities/core]],
[[entities/connectors-shared]], [[entities/content-store]],
[[entities/evidence-ledger]].
