---
title: Agent Office Phase 5 — CLI `mega office`
status: approved
risk: high
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
parent_spec: docs/superpowers/specs/2026-06-22-agent-office-design.md
safety_confirmation: >
  The CLI can spawn agents that modify the current repo (`mega office run`).
  Carries the CRITICAL safe-by-default contract: the supervisor is built with
  `allowFull` = false unless the operator passes `--allow-full` OR sets
  `MEGA_OFFICE_ALLOW_FULL=1`; without it a `full`-role task fails closed (no
  spawn). Agents run with `cwd = agent.workdir`. The `allowedTools` flag guard
  lives in `roleSchema` (engine), so CLI-created roles inherit it.
---

# Agent Office Phase 5 — CLI

## Summary

`mega office` subcommands so the office is fully usable from the terminal:
manage roles + agents, assign tasks, run the supervisor, and inspect
status/audit — the dogfood CLI surface (CLAUDE.md §7) mirroring the GUI (Phase 4)
and bridge (Phase 3).

## Scope (`apps/cli`)

1. New deps `@megasaver/agent-office` + `@megasaver/connector-claude-code` (commit lockfile).
2. Hoist `OFFICE_PROJECT_ID` + `ensureOfficeProject` from the bridge into
   `@megasaver/agent-office` (engine) so CLI + bridge share ONE canonical office
   project id; refactor `apps/gui/bridge/routes/office.ts` to import + re-export
   them from the engine (1-line swap; preserves the same id).
3. `commands/office/` command group + leaf commands (mirroring `commands/memory/`).
4. Tests (inject a fake launcher + in-memory core; tmp store; no real claude).

## Commands

Workspace is derived from cwd: `wk = encodeWorkspaceKey(cwd)` (from
`@megasaver/shared`). Roles are global. Each `runOfficeX` follows the
`RunMemoryCreateInput` pattern (store-env spread, stdout/stderr, json flag,
injectable now/newId, return `0 | 1`).

- `mega office role list` — list global roles (table or `--json`).
- `mega office role create --name --persona --model --permission-mode [--kind claude-code] [--tools a,b] [--workdir] [--json]` — build + `saveRole`; print id. Validates via the engine schemas (incl. the `allowedTools` leading-`-` guard); maps errors.
- `mega office role rm <roleId>` — `deleteRole`.
- `mega office agent list` — `listAgents(wk)`.
- `mega office agent create --name --role <roleId> --workdir [--json]` — load role (kind from role); build + `saveAgent` (status idle); print id.
- `mega office agent rm <agentId>` — `deleteAgent(wk, agentId)`.
- `mega office assign <agentId> <instruction>` — build + `saveTask` (queued); print task id.
- `mega office run <agentId> [--allow-full] [--json]` — build the supervisor
  (`createLauncherRegistry([createClaudeCodeLauncher()])` + the `ensureStoreReady`
  CoreRegistry + `ensureOfficeProject`), `allowFull = flag || MEGA_OFFICE_ALLOW_FULL==="1"`,
  `await drainAgent(wk, agentId)`, print each processed task's `{id, status, exitCode}`.
  Exit 1 if any task ended `failed`.
- `mega office status [agentId] [--json]` — print agents with current task +
  last audit event (all agents, or one).
- `mega office logs [agentId] [--json]` — `listAudit(wk)` (filtered to agentId if given).
- `mega office pause|resume|stop <agentId>` — load agent, transition status
  (pause→paused; resume→idle [from paused or error]; stop→stopped), `saveAgent`.

## Risk & process

HIGH (CLI spawns agents that edit the cwd repo). Safe-by-default via the engine
permission gate (Phase 2) — `full` needs `--allow-full`/env. Reviews:
code-reviewer + critic + security-reviewer. **Tests inject a fake launcher +
in-memory CoreRegistry — no real `claude`.** `run` in tests uses an injected
registry.

## Testing

Mirror `commands/memory/*` tests: construct `RunOfficeXInput` with a tmp store
(`MEGA_HOME`/store flag), `MEGA_TEST_*` / injected now/newId, captured
stdout/stderr. For `run`, inject `{ registry: createLauncherRegistry([fake]),
coreRegistry: createInMemoryCoreRegistry() }` (add an optional injection point to
`RunOfficeRunInput`, defaulting to the real ones in production). Cover:
- role create (happy + leading-`-` tool rejected + bad model/permissionMode),
  list, rm.
- agent create (happy + unknown role → error), list, rm.
- assign → queued task; status/logs shape.
- run: queued task → drained to `done` (fake launcher exit 0), audit rows,
  exit 0; a fake non-zero exit → task failed, exit 1; a `full` role WITHOUT
  `--allow-full` → task failed (permission denied), no spawn, exit 1; WITH
  `--allow-full` → spawns full.
- pause/resume/stop transitions.
- ensureOfficeProject seeds the office project (run path doesn't throw
  project_not_found).

## Definition of Done

- Commands implemented + registered in `main.ts`; engine `ensureOfficeProject`
  hoist + bridge re-import done (bridge tests still green).
- `pnpm --filter @megasaver/cli test` green; `pnpm verify` green ubuntu+windows;
  lockfile committed.
- Changeset (minor `@megasaver/cli`, `@megasaver/agent-office`; patch
  `@megasaver/gui` for the import swap).
- code-reviewer + critic + security-reviewer (author ≠ reviewer).

## Follow-ups

- `role edit` (load/modify/save) — deferred; create+rm cover the core need.
- Cooperative cancel for `stop` of a running task (shared Phase 4+ follow-up).
- Confine `workdir` (shared follow-up).
