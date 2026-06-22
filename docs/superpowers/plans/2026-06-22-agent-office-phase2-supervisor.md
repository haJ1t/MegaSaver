# Agent Office Phase 2 — Supervisor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Strict TDD: failing test → RED → implement → GREEN → commit per task.

**Goal:** Wire the Phase 1 launcher into the office via a supervisor that runs queued tasks with safe-by-default permission gating, core Sessions, and an append-only audit log — all behind injected ports so tests use a fake launcher + in-memory core (no real `claude`).

**Architecture:** Everything in `@megasaver/agent-office` (new deps `@megasaver/core`, `@megasaver/connectors-shared`). Pure permission policy + launcher registry + audit store + a supervisor engine (`processNextTask`/`drainAgent`/`runWorkspace`). Plus brand `workspaceKey` on the schemas and add `cancel(signal?)` to the launcher handle.

**Tech Stack:** TypeScript strict ESM, zod, Vitest, Node fs.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-office-phase2-supervisor-design.md](../specs/2026-06-22-agent-office-phase2-supervisor-design.md). **Risk CRITICAL** — fake launcher only; no real `claude` in any test.

**Conventions (MUST follow):**
- Mirror existing patterns EXACTLY: stores follow `packages/agent-office/src/role-store.ts` (isErrno, parseXFile → store_corrupt, ENOENT → not_found/[], atomic-write, zod-on-load). Errors follow `AgentOfficeError`. ids/schemas follow existing `role.ts`/`agent.ts`.
- Keep all imports at file top. Run `pnpm lint` (= `biome check .`, the CI command) and fix before committing — NOT a single-file biome check.
- Run the project's CI gate `pnpm verify` at the end (it runs on ubuntu AND windows in CI — keep paths/tests platform-agnostic: build expected paths with `node:path` `join`, never hard-code `/`).
- Commit per task, message trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.
- TS strict + `exactOptionalPropertyTypes`: omit optional keys in fixtures; `noUncheckedIndexedAccess` — guard array indexing.

---

## File Structure

```
packages/agent-office/package.json                 # +deps @megasaver/core, @megasaver/connectors-shared
packages/agent-office/src/errors.ts                # +codes permission_denied, launcher_not_registered
packages/agent-office/src/agent.ts                 # workspaceKey → workspaceKeySchema
packages/agent-office/src/task.ts                  # workspaceKey → workspaceKeySchema
packages/agent-office/src/permission.ts            # new: resolveLauncherPermission
packages/agent-office/src/launcher-registry.ts     # new: createLauncherRegistry
packages/agent-office/src/audit.ts                 # new: auditEventSchema
packages/agent-office/src/audit-store.ts           # new: appendAudit/listAudit
packages/agent-office/src/supervisor.ts            # new: createSupervisor
packages/agent-office/src/paths.ts                 # +auditDir/auditPath builders
packages/agent-office/src/index.ts                 # export new public surface
packages/connectors/shared/src/launcher.ts         # cancel(signal?) in LaunchHandle
packages/connectors/claude-code/src/launcher.ts    # forward signal to child.kill
packages/agent-office/test/*.test.ts               # per-task tests
.changeset/agent-office-phase2-supervisor.md
```

---

## Task 1: deps + error codes + brand workspaceKey

- [ ] **Test:** add to `test/agent.test.ts` and `test/task.test.ts`: a valid 16-hex workspaceKey passes; an invalid one (e.g. `"WK"` uppercase / wrong length) is rejected. Add to `test/errors.test.ts`: `agentOfficeErrorCodeSchema.options` includes `permission_denied` and `launcher_not_registered`.
- [ ] **Run RED.**
- [ ] **Implement:**
  - `package.json` dependencies: add `"@megasaver/core": "workspace:*"`, `"@megasaver/connectors-shared": "workspace:*"`. Run `pnpm install`.
  - `errors.ts`: extend the enum to `["launcher_not_registered","not_found","permission_denied","schema_invalid","store_corrupt","write_failed"]` (keep alphabetical).
  - `agent.ts` / `task.ts`: import `workspaceKeySchema` from `@megasaver/shared`; change `workspaceKey: z.string().min(1)` → `workspaceKey: workspaceKeySchema`.
- [ ] **Run GREEN** (`pnpm --filter @megasaver/agent-office test`), **lint**, **commit** `feat(agent-office): brand workspaceKey + supervisor error codes`.

## Task 2: permission policy (`src/permission.ts`)

- [ ] **Test** (`test/permission.test.ts`): plan→"plan"; acceptEdits→"acceptEdits"; full + `{allowFull:true}`→"full"; full + `{allowFull:false}`→throws `AgentOfficeError` code `permission_denied`.
- [ ] **RED.**
- [ ] **Implement:**

```ts
import { AgentOfficeError } from "./errors.js";
import type { RolePermissionMode } from "./role.js";
import type { LauncherPermissionMode } from "@megasaver/connectors-shared";

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

- [ ] **GREEN, lint, commit** `feat(agent-office): add resolveLauncherPermission`.

## Task 3: launcher registry (`src/launcher-registry.ts`)

- [ ] **Test** (`test/launcher-registry.test.ts`): registry built from `[{kind:"claude-code", launch(){...}}]` returns it via `get("claude-code")`; `get("codex")` throws `launcher_not_registered`; building with two `claude-code` launchers throws.
- [ ] **RED.**
- [ ] **Implement:**

```ts
import type { AgentId } from "@megasaver/shared";
import type { AgentLauncher } from "@megasaver/connectors-shared";
import { AgentOfficeError } from "./errors.js";

export interface LauncherRegistry {
  get(kind: AgentId): AgentLauncher;
}

export function createLauncherRegistry(launchers: readonly AgentLauncher[]): LauncherRegistry {
  const map = new Map<AgentId, AgentLauncher>();
  for (const l of launchers) {
    if (map.has(l.kind)) {
      throw new AgentOfficeError("launcher_not_registered", `Duplicate launcher for kind: ${l.kind}`);
    }
    map.set(l.kind, l);
  }
  return {
    get(kind) {
      const l = map.get(kind);
      if (l === undefined) {
        throw new AgentOfficeError("launcher_not_registered", `No launcher for kind: ${kind}`);
      }
      return l;
    },
  };
}
```

- [ ] **GREEN, lint, commit** `feat(agent-office): add launcher registry`.

## Task 4: audit schema + store (`src/audit.ts`, `src/audit-store.ts`, paths)

- [ ] **Test** (`test/audit-store.test.ts`): round-trip append→list; list sorted by `ts`; `[]` when none; bad-json file → `store_corrupt`; unsafe id segment rejected. Also `test/audit.test.ts`: schema accepts a valid event, rejects extra keys (strict) and a non-enum type.
- [ ] **RED.**
- [ ] **Implement `audit.ts`:**

```ts
import {
  agentIdSchema, officeAgentIdSchema, officeTaskIdSchema, sessionIdSchema, workspaceKeySchema,
} from "@megasaver/shared";
import { z } from "zod";
import { rolePermissionModeSchema } from "./role.js";

export const auditEventTypeSchema = z.enum(["spawn", "task_done", "task_failed"]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditEventSchema = z.object({
  id: z.string().min(1),
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
export type AuditEvent = z.infer<typeof auditEventSchema>;
```

- [ ] **paths.ts:** add (mirroring existing builders, `assertSafeSegment` on each segment):

```ts
export function auditDir(storeRoot: string, workspaceKey: string): string {
  assertSafeSegment(workspaceKey);
  return join(storeRoot, "office", workspaceKey, "audit");
}
export function auditPath(input: { storeRoot: string; workspaceKey: string; auditId: string }): string {
  assertSafeSegment(input.auditId);
  return join(auditDir(input.storeRoot, input.workspaceKey), `${input.auditId}.json`);
}
```

- [ ] **audit-store.ts:** `appendAudit({storeRoot, event})` (validate via auditEventSchema → schema_invalid; atomicWriteFile to auditPath) and `listAudit({storeRoot, workspaceKey})` (readdir, parse each → store_corrupt, sort by `ts` ascending, `[]` on ENOENT). Mirror `role-store.ts` structure exactly.
- [ ] **GREEN, lint, commit** `feat(agent-office): add office audit log`.

## Task 5: launcher `cancel(signal?)` (connectors-shared + claude-code)

- [ ] **Test:** in `packages/connectors/claude-code/test/launcher.test.ts` add: `handle.cancel("SIGKILL")` calls `child.kill("SIGKILL")`; `handle.cancel()` still calls `child.kill("SIGTERM")`.
- [ ] **RED.**
- [ ] **Implement:**
  - connectors-shared `launcher.ts`: `cancel(signal?: NodeJS.Signals): void;` in `LaunchHandle`.
  - claude-code `launcher.ts`: `cancel(signal) { child.kill(signal ?? "SIGTERM"); }`.
- [ ] **GREEN** (`pnpm --filter @megasaver/connector-claude-code test`), **lint**, **commit** `feat(connectors): launcher cancel accepts a signal`.

## Task 6: supervisor (`src/supervisor.ts`)

This is the core. Implement per spec §4. Inject all ports. Use a fake launcher in tests (an object `{ kind:"claude-code", launch(input){ return handle } }` whose handle lets the test drive `onEvent`/`onExit` synchronously, like the Phase 1 adapter tests) and `createInMemoryCoreRegistry()` from `@megasaver/core`.

- [ ] **Tests** (`test/supervisor.test.ts`) — cover every bullet in spec §"Testing":
  new-session done; resume run; failed (non-zero); spawn-error (null); permission gate (full without/with allowFull); drainAgent order + stop-on-failure; runWorkspace concurrency; paused/stopped/error agent → null. Each uses tmp storeRoot (mkdtemp), seeds role+agent+task via the stores, injects fake launcher + in-memory core + fixed `now`/`newId`.
- [ ] **RED.**
- [ ] **Implement `createSupervisor`** per spec §4. Key points:
  - `processNextTask`: load agent → runnable check → earliest queued task → load role → `resolveLauncherPermission` (catch → task failed + agent error + return, BEFORE session/spawn, no audit row) → mark running → `createSession` → choose `sessionId` vs `resumeSessionId` (agent.claudeSessionId) → `appendAudit("spawn")` → `registry.get(kind).launch(input)` → `await new Promise<{code:number|null}>(res => handle.onExit(res))` → on 0: task done + agent idle + `claudeSessionId = handle.sessionId` + endSession + audit task_done; else task failed + agent error + endSession + audit task_failed → persist → return task.
  - Build `LaunchInput` with `model`/`persona`/`allowedTools` from role, `workdir` from agent, `permissionMode` resolved, and EXACTLY one of sessionId/resumeSessionId.
  - `drainAgent`: loop processNextTask until null; collect.
  - `runWorkspace`: listAgents → promise pool (maxConcurrent default 4) draining each.
  - Session title: `task.instruction.slice(0, 120)`.
- [ ] **GREEN, lint, commit** `feat(agent-office): add supervisor engine`.

## Task 7: exports + changeset + full verify

- [ ] **index.ts:** export `resolveLauncherPermission`, `createLauncherRegistry` + `LauncherRegistry`, `auditEventSchema`/`auditEventTypeSchema` + types, `appendAudit`/`listAudit`, `createSupervisor` + `Supervisor` type. Add a `test/public-surface.test.ts` assertion for the new names (extend the existing one).
- [ ] **changeset** `.changeset/agent-office-phase2-supervisor.md`: minor for `@megasaver/agent-office`, `@megasaver/connectors-shared`, `@megasaver/connector-claude-code`.
- [ ] **`pnpm verify`** → green (lint, typecheck, all tests, conventions:check). Fix any Biome/format with `pnpm lint:fix`.
- [ ] **commit** `feat(agent-office): export supervisor surface + changeset`.

---

## Definition of Done

Per spec. All tests green with fake launcher + in-memory core (no real claude). `pnpm verify` green. Changeset added. Reviews: code-reviewer + critic + security-reviewer (author ≠ reviewer).

## Self-Review (author)

Spec §1→T2, §2→T3, §3→T4, §4→T6, §5→T1+T5, exports→T7. No real claude (fake launcher). Platform-agnostic paths (join). Error codes alphabetical. workspaceKey branded; fixtures use valid 16-hex so existing tests hold.
