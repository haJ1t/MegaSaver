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

## Phases not yet built

2. Supervisor (queue loop, resume continuity, concurrency cap) +
   per-role permission/workdir enforcement + evidence-ledger audit
   (composes `@megasaver/core` `CoreRegistry`). Also tighten
   `workspaceKey` to the branded `workspaceKeySchema` here.
3. Bridge `/api/office` routes + reuse `tailTranscript`/SSE.
4. GUI office board view + role manager.
5. CLI `mega office` commands.

See [[concepts/agent-agnostic-core]], [[entities/core]],
[[entities/connectors-shared]], [[entities/content-store]],
[[entities/evidence-ledger]].
