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
- `buildPredefinedRoles({now,newId})` — predefined role catalog, ALL
  `permissionMode: plan` (safe-by-default invariant, tested). **Updated
  2026-06-22:** the catalog is now **24 roles modeled on
  addyosmani/agent-skills** (one per skill, grouped by lifecycle phase; each
  carries its skill slug in `skillPacks`), replacing the original 13.
  `ensurePredefinedRoles` (idempotent) seeds them into the role store on bridge
  startup + via `mega office role seed`, so the roster actually appears in the
  GUI/CLI on first run (the builder was previously never called at runtime).
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

## Phase 4 shipped (GUI office board)

`agent-office` GUI view (`apps/gui/src`): workspace selector + global
**role manager** (CRUD; full-permission warning re `MEGA_OFFICE_ALLOW_FULL`) +
per-workspace **agent board** (cards: role/name, status dot, current task, last
audit event; controls run/pause/resume/stop/remove + inline assign; add-agent
form). `lib/office-client.ts` wraps the Phase 3 API + `openOfficeStream` SSE
(disposer). Live updates via the SSE `status` event. Built consistent with the
existing utilitarian GUI (no bespoke design pass — follow-up). Risk MEDIUM.
Reviewed by code-reviewer + critic — two reproduced UX bugs fixed before merge:
a stale-status overwrite race on fast workspace switch (per-run ignore flag) and
a sticky "Live stream disconnected" banner (cleared on the next status push),
both regression-tested. 360 gui tests; `pnpm verify` green; tests stub
fetch/EventSource (no real bridge/claude).

## Phase 5 shipped (CLI `mega office`)

`mega office` Citty subcommands in `apps/cli` (thin handlers over the engine):
`role list|create|rm`, `agent list|create|rm`, `assign <agent> <instruction>`,
`run <agent> [--allow-full]` (drives the supervisor, awaits drainAgent, prints
task outcomes, exit 1 on any failure), `status [agent]`, `logs [agent]`,
`pause|resume|stop <agent>`. Workspace = `encodeWorkspaceKey(cwd)`; roles global.
`OFFICE_PROJECT_ID` + `ensureOfficeProject` hoisted into `@megasaver/agent-office`
(bridge now re-exports them — one canonical office project id). Safe-by-default:
`allowFull` only via `--allow-full` / `MEGA_OFFICE_ALLOW_FULL=1`, default off,
`full` fails closed (test-asserted no spawn); `allowedTools` leading-`-` guard
inherited from `roleSchema`. Risk HIGH; reviewed by code-reviewer (APPROVED) +
critic (SHIP WITH FIXES → error-message/precheck fixes applied) + security-reviewer
(PASS). cli 719 / agent-office 113 / gui 360 tests; fake launcher + in-memory core
(no real claude).

## Auto workdir (2026-06-22)

Agent `workdir` is no longer user-chosen — it is the project directory,
derived automatically. The CLI `office agent create` dropped its `--workdir`
flag and uses the invocation `cwd`; the GUI add-agent form dropped its workdir
input and sends the selected workspace's `label` (= its cwd path; workspaces are
`{key: encodeWorkspaceKey(cwd), label: cwd}`). The bridge `handleCreateAgent`
now enforces `encodeWorkspaceKey(workdir) === wk` (400 on mismatch) — the
launcher-cwd invariant at the HTTP boundary. `role.defaultWorkdir` is left
untouched (separate, still inert — flagged follow-up). Risk HIGH (launcher cwd +
public CLI flag); spec + plan in `docs/superpowers/{specs,plans}/2026-06-22-office-auto-workdir-*`.

## Status: feature complete (Phases 0–5)

All Agent Office phases shipped to `main`: 0 engine data layer, 1 launcher, 2
supervisor, 3 bridge `/api/office`, 4 GUI board, 5 CLI. The office is usable end
to end from the GUI and the CLI. Open follow-ups (filed): cooperative cancel for
a running task, `workdir` confinement, full evidence-ledger integration,
per-agent raw-transcript stream, bridge task-create agent precheck, `status
--json` instruction-exposure doc note, flaky memory-graph-panel test hardening,
the atomicWriteFile dir-fsync shared-util hoist, and removing the inert
`role.defaultWorkdir` field.

See [[concepts/agent-agnostic-core]], [[entities/core]],
[[entities/connectors-shared]], [[entities/content-store]],
[[entities/evidence-ledger]].
