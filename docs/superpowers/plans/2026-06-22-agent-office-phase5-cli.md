# Agent Office Phase 5 — CLI `mega office` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, commit per task, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.

**Goal:** `mega office` CLI commands (role/agent CRUD, assign, run, status, logs, pause/resume/stop) over the agent-office engine + claude-code launcher.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-office-phase5-cli-design.md](../specs/2026-06-22-agent-office-phase5-cli-design.md). **Risk HIGH** (CLI `run` spawns repo-mutating agents; safe-by-default via the engine gate; fake launcher in tests).

**MUST mirror:** `apps/cli/src/commands/memory/create.ts` + `memory/index.ts` (the `runX(input): Promise<0|1>` + `defineCommand` + `RunXInput` with store-env spread + injectable now/newId + `mapErrorToCliMessage` pattern), `apps/cli/src/store.ts` (`resolveStorePath`/`readStoreEnv`/`ensureStoreReady`), `apps/cli/src/errors.ts` (extend `ZodContext` + add office messages). Engine API: `@megasaver/agent-office` (`saveRole`/`loadRole`/`listRoles`/`deleteRole`, `saveAgent`/`loadAgent`/`listAgents`/`deleteAgent`, `saveTask`/`listTasks`, `listAudit`, `roleSchema`/`officeAgentSchema`/`officeTaskSchema` + enums, `createLauncherRegistry`, `createSupervisor`), `@megasaver/connector-claude-code` (`createClaudeCodeLauncher`), `@megasaver/shared` (`encodeWorkspaceKey`, id schemas, `titleSchema`), `@megasaver/core` (`createInMemoryCoreRegistry` for tests).

**CI discipline:** add deps → run `pnpm install` → **commit `pnpm-lock.yaml`** (frozen-install CI). `pnpm lint` before commits; paths join-based; `pnpm verify` at end (ubuntu+windows).

---

## Task 1: hoist ensureOfficeProject to the engine
- [ ] Move `OFFICE_PROJECT_ID` + `ensureOfficeProject(coreRegistry, now)` from `apps/gui/bridge/routes/office.ts` into `@megasaver/agent-office` (e.g. `src/office-project.ts`); export from the package index (keep the EXACT id `00000000-beef-0000-0000-000000000001`).
- [ ] `apps/gui/bridge/routes/office.ts`: import them from `@megasaver/agent-office` and re-export (so existing bridge imports + tests keep working). 
- [ ] Test: an agent-office test for `ensureOfficeProject` (idempotent; seeds the project via a fake/in-memory CoreRegistry). Bridge office tests must still pass.
- [ ] `pnpm --filter @megasaver/agent-office test` + `pnpm --filter @megasaver/gui test` green. Commit `refactor(agent-office): hoist office project seeding into the engine`.

## Task 2: deps + office command scaffold + role commands
- [ ] `apps/cli/package.json`: add `@megasaver/agent-office` + `@megasaver/connector-claude-code` (workspace:*). `pnpm install`; commit lockfile.
- [ ] `apps/cli/src/errors.ts`: extend `ZodContext` with office kinds (e.g. `{ kind: "office_role" }`, `{ kind: "office_agent" }`, `{ kind: "office_task" }`) and add an `officeNotFoundMessage`/reuse mapping for `AgentOfficeError` (not_found, permission_denied, schema_invalid → exit 1 with clear text). Mirror existing message helpers.
- [ ] `commands/office/role.ts`: `runOfficeRoleList`/`Create`/`Rm` (+ commands). create: validate name(titleSchema)/persona/model(roleModelSchema)/permissionMode(rolePermissionModeSchema)/kind(default claude-code)/tools(split comma → array; engine roleSchema enforces leading-`-` guard)/workdir; `saveRole`; print id (or `--json`). list: `listRoles` → table/json. rm: `deleteRole`.
- [ ] Tests `test/.../office-role.test.ts`: create happy + leading-`-` tool rejected + bad model; list; rm. Commit `feat(cli): mega office role commands`.

## Task 3: agent + assign commands
- [ ] `commands/office/agent.ts`: `runOfficeAgentList`/`Create`/`Rm`. wk = `encodeWorkspaceKey(input.cwd)`. create: `loadRole(roleId)` (kind from role) → build OfficeAgent (status idle) → `saveAgent`; print id. list: `listAgents(wk)`. rm: `deleteAgent(wk, id)`.
- [ ] `commands/office/assign.ts`: `runOfficeAssign(agentId, instruction)` → build OfficeTask (queued, queuedAt=now) → `saveTask`; print task id.
- [ ] Tests: agent create (happy + unknown role → error) / list / rm; assign → queued. Commit `feat(cli): mega office agent + assign commands`.

## Task 4: run + control + status + logs
- [ ] `commands/office/run.ts`: `RunOfficeRunInput` includes an OPTIONAL injection `{ registry?, coreRegistry? }` (defaults: `createLauncherRegistry([createClaudeCodeLauncher()])` + the `ensureStoreReady` registry). `allowFull = input.allowFull || readEnv("MEGA_OFFICE_ALLOW_FULL")==="1"`. `ensureOfficeProject(coreRegistry, now)`. `createSupervisor({ storeRoot, registry, coreRegistry, projectId: OFFICE_PROJECT_ID, now, newId, allowFull })`. `await drainAgent(wk, agentId)`. Print each task `{id,status,exitCode}`; return 1 if any `failed`.
- [ ] `commands/office/control.ts`: `runOfficeControl(agentId, action)` (pause/resume/stop) + 3 thin commands. `commands/office/status.ts` + `logs.ts`: build status (agents + currentTask + lastEvent) / `listAudit`.
- [ ] `commands/office/index.ts`: group all into `officeCommand` subCommands; `main.ts`: import + register `office: officeCommand`.
- [ ] Tests: run drains to done (fake launcher exit 0, exit 0) + non-zero (exit 1) + full-without-allow-full (task failed, no spawn, exit 1) + with --allow-full; pause/resume/stop; status/logs shape; ensureOfficeProject seeded (no project_not_found). Commit `feat(cli): mega office run/control/status/logs + register`.

## Task 5: changeset + verify
- [ ] `.changeset/agent-office-phase5-cli.md` (minor `@megasaver/cli` + `@megasaver/agent-office`; patch `@megasaver/gui`).
- [ ] `pnpm verify` green (commit lockfile if not already). Commit `feat(cli): office changeset`.

## Definition of Done
Per spec. CLI tests green (fake launcher + in-memory core; no real claude); bridge tests still green; `pnpm verify` green ubuntu+windows; lockfile committed; changeset. code-reviewer + critic + security-reviewer.

## Self-Review (author)
Spec commands→T2/T3/T4; hoist→T1; safe-by-default (allowFull flag/env default off, engine gate) tested in T4; lockfile committed (T2/T5). Mirrors memory command pattern; fake launcher only.
