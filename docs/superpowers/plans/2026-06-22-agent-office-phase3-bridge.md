# Agent Office Phase 3 — Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Strict TDD, commit per task, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.

**Goal:** `/api/office/*` bridge routes (role/agent/task CRUD, run/pause/resume/stop, audit, status, SSE) driving the Phase 2 supervisor + claude-code launcher, with HTTP-boundary validation.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-office-phase3-bridge-design.md](../specs/2026-06-22-agent-office-phase3-bridge-design.md). **Risk HIGH.**

**MUST follow patterns:**
- Mirror `apps/gui/bridge/routes/claude-session-memory.ts` for CRUD handler shape (`readJsonBody` → zod `safeParse` → `ctx.sendError(400,"validation_failed",zodErrorMessage(err),ctx.origin,err.issues)` → work → `ctx.sendJson(201/200,...)` → `catch → handleCaughtError(ctx.res,ctx.origin,err,ctx.sendError)`).
- Mirror `routes/claude-sessions.ts` for SSE (headers, heartbeat ~15s, `req.on("close")` cleanup).
- Dispatch: add `path.match(...)` + method checks in `handler.ts` mirroring existing entries.
- `apps/gui` deps already include `@megasaver/core`, `@megasaver/shared`; ADD `@megasaver/agent-office` and `@megasaver/connector-claude-code` to `apps/gui/package.json`, run `pnpm install`, and **commit `pnpm-lock.yaml`** (CI uses `--frozen-lockfile`).
- Run `pnpm lint` (= `biome check .`, the CI command) before each commit. Paths join-based. Run `pnpm verify` at the end (CI runs ubuntu + windows).

**Engine API available** (`@megasaver/agent-office`): `listRoles/saveRole/deleteRole`, `listAgents/saveAgent/deleteAgent`, `listTasks/saveTask`, `listAudit`, `roleSchema/officeAgentSchema/officeTaskSchema` (+ enums `rolePermissionModeSchema`,`roleModelSchema`,`agentStatusSchema`,`taskStatusSchema`), `createLauncherRegistry`, `createSupervisor`. `@megasaver/connector-claude-code`: `createClaudeCodeLauncher`. `@megasaver/core`: `createJsonDirectoryCoreRegistry`, `createInMemoryCoreRegistry`. `@megasaver/shared`: `roleIdSchema`,`officeAgentIdSchema`,`officeTaskIdSchema`,`workspaceKeySchema`,`agentIdSchema`,`titleSchema`.

---

## File Structure

```
apps/gui/package.json                         # +deps agent-office, connector-claude-code (+ lockfile)
apps/gui/bridge/route-context.ts              # +optional office deps
apps/gui/bridge/routes/office.ts              # new handlers
apps/gui/bridge/office-validation.ts          # new: input schemas (security-critical)
apps/gui/bridge/handler.ts                    # dispatch wiring
apps/gui/bridge/server.ts                     # production office deps assembly
apps/gui/bridge/error-mapping.ts              # +AgentOfficeError → HTTP mapping (if not auto-handled)
apps/gui/bridge/test/office-routes.test.ts    # new
.changeset/agent-office-phase3-bridge.md
```

## Task 1: RouteContext office deps + validation schemas

- [ ] **route-context.ts:** add (after `now`):
```ts
office?: {
  coreRegistry: import("@megasaver/core").CoreRegistry;
  registry: import("@megasaver/agent-office").LauncherRegistry;
  allowFull: boolean;
};
```
- [ ] **office-validation.ts** (TDD: a small test asserting a leading-`-` tool is rejected):
```ts
import { agentIdSchema, roleIdSchema, titleSchema } from "@megasaver/shared";
import { roleModelSchema, rolePermissionModeSchema } from "@megasaver/agent-office";
import { z } from "zod";

// Security: a tool entry must not be able to inject a CLI flag when spread into
// the claude argv (e.g. "--add-dir"). Reject leading '-'.
export const allowedToolSchema = z.string().min(1).regex(/^[^-]/, "tool must not start with '-'");

export const roleCreateInputSchema = z.object({
  name: titleSchema,
  kind: agentIdSchema,
  persona: z.string().min(1),
  model: roleModelSchema,
  allowedTools: z.array(allowedToolSchema),
  skillPacks: z.array(z.string().min(1)),
  permissionMode: rolePermissionModeSchema,
  defaultWorkdir: z.string().min(1).optional(),
}).strict();

export const agentCreateInputSchema = z.object({
  name: titleSchema,
  roleId: roleIdSchema,
  workdir: z.string().min(1),
}).strict();

export const taskCreateInputSchema = z.object({ instruction: z.string().min(1) }).strict();
export const controlInputSchema = z.object({ action: z.enum(["pause", "resume", "stop"]) }).strict();
```
- [ ] commit `feat(gui): office route context deps + input validation`.

## Task 2: office route handlers (`routes/office.ts`)

Implement, mirroring `claude-session-memory.ts`. Each handler `(ctx, ...params)`; guard `ctx.office` (else `sendError(500,"internal_error","office not configured")`). Validate ids with the shared schemas (bad → 404). Validate bodies with the Task 1 schemas (bad → 400 `validation_failed`). Use `ctx.newId()`/`ctx.now()` to build full entities; `saveRole/saveAgent/saveTask`; `sendJson(201|200|...)`; `catch → handleOfficeError`.

Add an AgentOfficeError→HTTP mapper (in office.ts or error-mapping.ts):
`not_found`→404, `schema_invalid`/`permission_denied`→400, others→500. For non-AgentOfficeError, delegate to `handleCaughtError`.

Handlers:
- `handleListRoles`, `handleCreateRole`, `handleDeleteRole`
- `handleListAgents`, `handleCreateAgent` (load role via `loadRole(roleId)`; `kind = role.kind`; build OfficeAgent status `idle`), `handleDeleteAgent`
- `handleListTasks`, `handleCreateTask` (status `queued`, `queuedAt=now`)
- `handleRunAgent`: build a supervisor `createSupervisor({ storeRoot: ctx.storeRoot, registry: ctx.office.registry, coreRegistry: ctx.office.coreRegistry, projectId: OFFICE_PROJECT_ID, now: ctx.now, newId: ctx.newId, allowFull: ctx.office.allowFull })`; call `supervisor.drainAgent(wk, agentId)` WITHOUT awaiting (fire-and-forget; `.catch(()=>{})` to avoid unhandled rejection); immediately `sendJson(202, await loadAgent(...))`. (Define `OFFICE_PROJECT_ID` as a fixed namespaced ProjectId constant — a lowercase uuid literal — and document it.)
- `handleControlAgent`: parse body; load agent; transition status (pause: → paused; resume: paused|error → idle; stop: → stopped); `saveAgent`; `sendJson(200, agent)`.
- `handleListAudit`: `listAudit` → sendJson(200).
- `handleOfficeStatus`: build `{ agents: [{ agent, currentTask, lastEvent }] }` (currentTask = running task or earliest queued from `listTasks`; lastEvent = newest `listAudit` row for that agent).
- `handleOfficeStream` (SSE): mirror claude-sessions SSE — write snapshot (the status payload) as an `event: snapshot`, then `fs.watch(auditDir)` (build via the office store's audit dir path — reuse a helper or `join(storeRoot,"office",wk,"audit")`) debounced → re-emit `event: status`; heartbeat; cleanup on close.

- [ ] TDD each handler; commit `feat(gui): office route handlers`.

## Task 3: dispatch wiring (`handler.ts`)

Add (order before generic fallbacks), mirroring existing `path.match` blocks. Use method (`ctx.req.method`) to pick handler. Sketch:
```
/^\/api\/office\/roles$/                         GET→list  POST→create
/^\/api\/office\/roles\/([^/]+)$/                DELETE→delete(roleId)
/^\/api\/office\/([^/]+)\/agents$/               GET→list(wk) POST→create(wk)
/^\/api\/office\/([^/]+)\/agents\/([^/]+)$/      DELETE→delete(wk,id)
/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/tasks$/   GET→listTasks POST→createTask
/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/run$/     POST→run
/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/control$/ POST→control
/^\/api\/office\/([^/]+)\/audit$/                GET→audit
/^\/api\/office\/([^/]+)\/status$/               GET→status
/^\/api\/office\/([^/]+)\/stream$/               GET→stream
```
`decodeURIComponent` each captured segment (mirror existing). Commit `feat(gui): dispatch office routes`.

## Task 4: server deps assembly (`server.ts`)

Wire production `ctx.office` in `createBridgeHandler`/`server.ts`:
```ts
const office = {
  coreRegistry: createJsonDirectoryCoreRegistry(storeRoot),
  registry: createLauncherRegistry([createClaudeCodeLauncher()]),
  allowFull: process.env.MEGA_OFFICE_ALLOW_FULL === "1",
};
```
Pass into the RouteContext build. (Reuse the bridge's existing CoreRegistry if it already constructs one.) Ensure tests can inject a fake `office`. Commit `feat(gui): wire office supervisor into the bridge server`.

## Task 5: tests + changeset + verify

- [ ] `apps/gui/bridge/test/office-routes.test.ts`: fake `RouteContext` (tmp storeRoot, `createInMemoryCoreRegistry()`, `createLauncherRegistry([fakeLauncher])`, capturing `sendJson`/`sendError`, fake `req`/`res`). Cover: role/agent/task create (happy + 400 invalid body + leading-`-` allowedTools rejected), list, delete; run drives supervisor (fake launcher → task done; status reflects; audit rows); control transitions; status snapshot shape; error mapping (not_found→404, permission_denied→400); allowFull=false + full-role agent run → task failed via audit (no spawn). SSE: assert the handler writes an initial snapshot frame (inject/avoid a real long-lived watcher — write snapshot then close).
- [ ] changeset `.changeset/agent-office-phase3-bridge.md` (minor `@megasaver/gui`).
- [ ] `pnpm verify` green; commit lockfile if deps changed. Commit `feat(gui): office routes tests + changeset`.

## Definition of Done
Per spec. Unit tests green (fake context, no real claude/HTTP). `pnpm verify` green ubuntu+windows. Lockfile committed. code-reviewer + critic + security-reviewer.

## Self-Review (author)
Spec §1→T1, §2→T2+T3, §3→T1(schemas)+T2(usage), §4→T4, testing→T5. Security: allowedTools leading-`-` guard (T1) + allowFull-from-env default false (T4) + body re-validation at boundary. No real claude (fake launcher). Lockfile committed (frozen-install CI). Paths join-based.
