# Live-First Phase 5: Remove the project model

**Date:** 2026-06-14
**Status:** Spec — pending implementation
**Risk:** HIGH → CRITICAL for the migration step (mutates the user's overlay store on disk; renames per-project files). Full superpowers chain + `architect` design + `critic` adversarial review + `security-reviewer` + verifier-with-reproduction per §12 of `CLAUDE.md`. The migration carries an explicit user-confirmation note (it touches `~/.local/share/megasaver` at scale).

> Parent architecture: `docs/superpowers/specs/2026-06-14-live-first-architecture.md` (§3.4 storage re-key, §3.5 API shape, §5 Phase 5, §6/§7 locked decisions). Read it first.

---

## 1. Goal & depends on

**Goal.** Delete the "project" abstraction now that every feature has been re-homed onto the live-session backbone: remove `ProjectPicker`/`ProjectCreateForm`/`activeProjectId`/`PROJECT_SCOPED_VIEWS` and the gating cascade in `app.tsx`; remove `/api/projects*`, the project-scoped route dispatcher, and the project-centric `registry` surface from `RouteContext`; drop the `projects.json` / `sessions.json` store tier and the `requireProject` guards; and replace `projectId: ProjectId` with `workspaceKey: string` across every overlay entity. Ship a one-time, **idempotent** migration that maps existing `projects.json` rows to `workspaces.json` by `rootPath → cwd` and renames every per-project `<projectId>.jsonl` to `<workspaceKey>.jsonl`.

**Depends on (must land first):**
- **F0** (telemetry surfacing) — `parse.ts`/`types.ts` retain `model`/`usage`/`gitBranch`; archived/permissionMode surfaced. No project change. *Independent of F5 but is the live source F5 leans on.*
- **F1** (workspace grouping) — `/api/workspaces` derived from live sessions; cwd grouping in the list.
- **F2** (session cockpit shell) — the live-session-list → cockpit shell exists **alongside** the project shell. F5 removes the project shell once F2's replacement is the only path.
- **F3** (cwd/workspace features re-pointed) — **introduces `workspaceKey` encoding, the workspace resolver on `RouteContext`, `workspaces.json` as a derived cache, and the cwd-keyed overlay store paths** for index/context/rules/tools/permissions. F5 deletes the *project* path these now shadow.
- **F4** (session overlay features) — re-homes memory/notes, tasks, and proxy-fed token-saver to `(workspaceKey, liveSessionId)`; resolves the memory `scope` split (cwd vs session). F5 removes the *projectId* fields these entities still carry in parallel during F4.

F5 is the **last** phase. It must not run before F3 and F4 have shipped their `workspaceKey`-keyed read/write paths, because F5 *deletes* the `projectId` fallbacks those phases left in place for incremental safety.

---

## 2. Scope

### In scope
- **GUI shell de-projectification.** Delete `project-picker.tsx`, `project-create-form.tsx`, `activeProjectId` state + `readPersistedProjectId`/`writePersistedProjectId`, `PROJECT_SCOPED_VIEWS`, the `fetchProjects`/`applyProjects`/`loadProjects` mount effect, the `NoProjectState`/`showNoSelection` gating cascade, and the legacy project views (`overview-view`, `sessions-view`, `sessions-list`, `sessions-detail`, `memory-view`, `rules-view`, `index-view`, `context-view`, `tasks-view`, `tools-view` **as project-scoped views**). `app.tsx` renders the F2 live shell as the sole shell.
- **`view-id.ts`.** Drop `PROJECT_SCOPED_VIEWS` and the now-dead project-scoped view ids; keep only the live ids the cockpit/shell still mount (`claude-sessions`, `agent-setup`, plus any F2/F3 cockpit/workspace ids).
- **`api-client.ts`.** Delete every project endpoint: `fetchProjects`, `createProject`, `fetchSessions`, `createSession`, `endSession`, `updateSession` (store CRUD), `fetchAudit`, `fetchRules`, `fetchIndexStatus`/`searchIndex`, `fetchContext`, `fetchTasks`, `fetchToolsRoute`, and the `projectId`-pathed memory calls. Keep the live + workspace + session-scoped clients F1–F4 added.
- **`agent-setup-doctor.tsx` + `installMcp`/`repairMcp`.** Drop the `activeProjectId` prop and the `project` body field; install/repair target becomes the resolved cwd (per architecture §4 "Agent setup" row). *Re-homing the install target to cwd is an F3/F4 concern; F5 only removes the project prop.*
- **Bridge routes.** Delete `routes/projects.ts`, `routes/project-scoped.ts`, `routes/_project.ts` (`resolveProject`), `routes/audit.ts`, `routes/rules.ts`, `routes/context.ts`, `routes/index-routes.ts`, `routes/tasks.ts`, `routes/tools.ts`, `routes/sessions.ts` (store-session CRUD), and the matching dispatch branches in `handler.ts`. Re-home of these endpoints to `/api/workspaces/:key/*` is **F3's** work — by F5 only the *project-pathed* variants remain to delete.
- **`RouteContext` / `handler.ts`.** Remove `registry: CoreRegistry` from `RouteContext` and the `createBridgeHandler` `registry` option. Keep `claudeProjectsDir` / `claudeSessionsMetaDir` and the F3 workspace resolver.
- **Core / store.** Remove `createProject`/`getProject`/`listProjects`/`createSession`/`getSession`/`listSessions`/`endSession`/`updateSession` from `CoreRegistry`; remove `requireProject` (both impls); drop `project.ts` + `projectSchema`; drop `readProjects`/`writeProjects`/`readSessions`/`writeSessions` + the `projectsPath`/`sessionsPath` store paths; replace `projectId: projectIdSchema` with `workspaceKey: z.string()` on `MemoryEntry`, `ProjectRule`, `FailedAttempt`, `TaskPlan`, `ToolDefinition`; replace the `*ForProject(paths, projectId, …)` store fns + their dirs (`memory/`, `project-rules/`, `failed-attempts/`, `task-plans/`, `tool-definitions/`) with `*ForWorkspace(paths, workspaceKey, …)` under the F3.4 dir names (`memory/`, `rules/`, `failed-attempts/`, `tasks/`, `tools/`); remove `projectIdSchema`/`ProjectId` from `@megasaver/shared`.
- **`initStore`.** Stop seeding `projects.json` / `sessions.json`. Seed nothing project-related (workspaces.json is a derived cache written by the resolver, not seeded empty).
- **One-time migration.** A new idempotent `migrateProjectsToWorkspaces(storeRoot)` (run once on bridge boot, guarded by a `.migrations/0001-remove-projects.done` marker): reads legacy `projects.json`, derives `workspaceKey` per row from `rootPath`, writes/merges `workspaces.json`, and renames each `<projectId>.jsonl` (across all five per-project dirs, plus `stats/<projectId>/` and `content/<projectId>/`) to `<workspaceKey>.jsonl` / `<workspaceKey>/`, rewriting the in-file `projectId` field to `workspaceKey`. Idempotent: re-running is a no-op once the marker exists; partial runs resume.
- **Dead-code sweep + `pnpm verify`.** Remove now-orphaned imports/types/tests; full lint+typecheck+test green.

### Out of scope (deferred)
- **CLI (`apps/cli`).** `apps/cli/src/commands/project.ts` and the `projectId` coupling across `commands/{memory,tools,context,session,…}` are a **separate follow-up** (`F5b — CLI live-first re-home`). F5 keeps `@megasaver/core`'s workspace surface stable enough that the CLI still compiles, OR the CLI is moved behind a temporary `workspaceKey`-shim; **decision below (R4)**. The GUI is the live-first product; the CLI is not on the live backbone yet.
- **mcp-bridge tools (`packages/mcp-bridge/src/tools/*`).** These still take `projectId` in their MCP input schemas. Re-keying them to `workspaceKey` is **F4/F5b** (the MCP server is a separate consumer). F5 does not touch `packages/mcp-bridge` beyond what a `@megasaver/core` type change forces; if the type change ripples, F5 applies the *mechanical* `projectId → workspaceKey` rename in those tools but adds no new behaviour.
- **Re-homing endpoints to `/api/workspaces/*`.** That is F3. F5 only deletes the project-pathed originals.
- **Migrating the `cwd → workspaceKey` encoding itself.** Owned by F3 (`workspaceKey = short sha256(cwd) + human label`). F5 *consumes* the F3 encoder; it does not define it.
- **Telemetry / transcript schema.** F0.
- **Token-saver proxy wiring.** F4 (proxy-fed overlay). F5 only renames its store dir keys in migration.

---

## 3. File-level changes

Paths absolute-from-repo-root. "Re-key" = mechanical `projectId: ProjectId → workspaceKey: string` plus identifier rename, no behaviour change.

| Action | Path | Responsibility |
|---|---|---|
| **delete** | `apps/gui/src/components/project-picker.tsx` | Picker + persisted-project-id helpers gone. |
| **delete** | `apps/gui/src/components/project-create-form.tsx` | Create form gone. |
| **delete** | `apps/gui/src/views/overview-view.tsx` | Project overview (replaced by cockpit telemetry, F2). |
| **delete** | `apps/gui/src/views/sessions-view.tsx`, `sessions-list.tsx`, `sessions-detail.tsx` | Store-session views (live sessions replace them). |
| **delete** | `apps/gui/src/views/memory-view.tsx`, `rules-view.tsx`, `index-view.tsx`, `context-view.tsx`, `tasks-view.tsx`, `tools-view.tsx` | Project-scoped views; cockpit/workspace panels (F2/F3) replace them. *Delete only if F2/F3 already provide the replacement panel — otherwise the panel files were renamed/moved in F3 and F5 just removes the project wrapper.* |
| **modify** | `apps/gui/src/app.tsx` | Strip `activeProjectId`, `projects` state, mount effect, `ProjectPicker`/`ProjectCreateForm` header, `PROJECT_SCOPED_VIEWS` gate, `NoProjectState`, `ActiveView(projectId=…)`. Render the F2 live shell as the only shell. |
| **modify** | `apps/gui/src/view-id.ts` | Remove `PROJECT_SCOPED_VIEWS` + dead view ids + their labels. |
| **modify** | `apps/gui/src/lib/api-client.ts` | Delete all project/store-session/project-scoped client fns + their request/response types; keep live + workspace + session-scoped clients. |
| **modify** | `apps/gui/src/views/agent-setup-doctor.tsx` + `apps/gui/src/components/agent-setup-row.tsx` | Drop `activeProjectId` prop + the install/repair project guard. |
| **modify** | `apps/gui/src/components/states.tsx` | Remove `NoProjectState` (and its `BridgeError`-only siblings if now unused). |
| **delete** | `apps/gui/bridge/routes/projects.ts` | `GET/POST /api/projects`. |
| **delete** | `apps/gui/bridge/routes/project-scoped.ts` | `/api/projects/:id/*` dispatcher. |
| **delete** | `apps/gui/bridge/routes/_project.ts` | `resolveProject` guard. |
| **delete** | `apps/gui/bridge/routes/audit.ts`, `rules.ts`, `context.ts`, `index-routes.ts`, `tasks.ts`, `tools.ts` | Project-pathed read routes (re-homed to `/api/workspaces/*` in F3). |
| **delete** | `apps/gui/bridge/routes/sessions.ts` | Store-session CRUD (`GET/POST /api/sessions`, `PATCH/end`). |
| **modify** | `apps/gui/bridge/handler.ts` | Remove the `/api/projects`, `/api/projects/…`, `/api/sessions`, `/api/sessions/:id` dispatch branches + their imports; remove `registry` from `BridgeHandlerOptions` + the `RouteContext` it builds. Keep claude-sessions, mcp, token-saver/retention (token-saver path moves to live key in F4), memory (re-keyed). |
| **modify** | `apps/gui/bridge/route-context.ts` | Remove `registry: CoreRegistry`. Keep `claudeProjectsDir`/`claudeSessionsMetaDir` + F3 workspace resolver. |
| **modify** | `apps/gui/bridge/routes/memory.ts` | Re-point from `registry.listMemoryEntries(projectId)` to the F4 workspace/session-keyed overlay read; drop `projectId` query param. *Mostly F4; F5 removes any remaining projectId branch.* |
| **modify** | `apps/gui/bridge/zod-schemas.ts` | Delete `CREATE_PROJECT_BODY`, `CREATE_SESSION_BODY`, and `projectId` fields in remaining bodies; drop the `projectIdSchema` import. |
| **modify** | `apps/gui/bridge/server.ts` | Stop constructing/passing `registry`; stop calling `initStore` for projects; call `migrateProjectsToWorkspaces(storeRoot)` once on boot. |
| **create** | `packages/core/src/migrate-projects-to-workspaces.ts` | Idempotent one-time migration (see §4.4). |
| **delete** | `packages/core/src/project.ts` | `projectSchema` / `Project`. |
| **modify** | `packages/core/src/registry.ts` | Remove project/session-CRUD methods from `CoreRegistry`; remove `requireProject` (in-memory impl); re-key list/create signatures `projectId → workspaceKey`; `buildTaskPlanFromInput`/`buildToolDefinitionFromInput` take `workspaceKey`. |
| **modify** | `packages/core/src/json-directory-registry.ts` | Remove `requireProject` + project/session CRUD; re-point `*ForProject → *ForWorkspace`. |
| **modify** | `packages/core/src/json-directory-store.ts` | Drop `projectsPath`/`sessionsPath` + `readProjects`/`writeProjects`/`readSessions`/`writeSessions`; rename `*ForProject(paths, projectId, …)` → `*ForWorkspace(paths, workspaceKey, …)`; rename dirs per F3.4 (`project-rules`→`rules`, `task-plans`→`tasks`, `tool-definitions`→`tools`). |
| **modify** | `packages/core/src/init-store.ts` | `initStore` no longer seeds `projects.json`/`sessions.json`. |
| **modify** | `packages/core/src/session.ts` | **Delete** (store-session entity gone — sessions come live). If any overlay still references a session id, it uses the live `cliSessionId` string, not this schema. |
| **modify** | `packages/core/src/memory-entry.ts`, `project-rule.ts`, `failed-attempt.ts`, `task-plan.ts`, `tool-definition.ts` | `projectId: projectIdSchema` → `workspaceKey: z.string().min(1)`; `sessionId` becomes a plain live-id string where present (F4). |
| **modify** | `packages/core/src/index.ts` | Drop `./project.js`, `./session.js` re-exports; add `./migrate-projects-to-workspaces.js`. |
| **modify** | `packages/shared/src/ids.ts` + `packages/shared/src/index.ts` | Remove `projectIdSchema` / `ProjectId`. (Keep `sessionIdSchema` only if a non-live consumer remains; otherwise remove.) |
| **modify** | `packages/core/src/project-rule-ranking.ts`, `tool-router.ts`, `failed-attempt-search.ts`, `memory-search.ts` | Mechanical `projectId → workspaceKey` in any signature that filters by it. |
| **modify** | `packages/mcp-bridge/src/tools/*` (only if forced by the core type change) | Mechanical rename `projectId → workspaceKey` to keep compile; **no** new behaviour (full re-key is F5b). |
| **delete** | `apps/cli/src/commands/project.ts` (and project wiring in `cli.ts`) | **Deferred to F5b** — listed here so the dead-code sweep is explicit, but NOT done in F5 unless R4 picks the "delete CLI project commands now" option. |

### Tests

| Action | Path | Responsibility |
|---|---|---|
| **delete** | `apps/gui/test/bridge/contextops-routes.test.ts` (project-scoped cases), tests under `/api/projects` + `/api/sessions` in `handler*.test.ts` | Routes deleted. |
| **modify** | `apps/gui/test/bridge/test-helpers.ts` | Drop `startTestBridge` `projects`/`sessions`/`memoryEntries` registry seeding + `PROJECT_A`/`PROJECT_B`/`SESSION_*`/`MEMORY_PROJECT_ENTRY` fixtures (or re-key fixtures to `workspaceKey`). `seedStore` uses `workspaceKey` dirs. |
| **delete** | `packages/core/test/project.test.ts`, `registry.test.ts` (project/session CRUD blocks), `session.test.ts`, `session-schema.property.test.ts`, `in-memory-registry-end-session.test.ts`, `json-directory-registry-end-session.test.ts` | Entities/methods removed. |
| **modify** | `packages/core/test/json-directory-store.test.ts`, `json-directory-registry*.test.ts`, `memory-*.test.ts`, `store-rules-failures.test.ts`, `store-tools.test.ts`, `task-store.test.ts`, `registry-*.test.ts` | Re-key fixtures `projectId → workspaceKey`; assert `*ForWorkspace` paths. |
| **create** | `packages/core/test/migrate-projects-to-workspaces.test.ts` | The migration's own TDD suite (§5 Task M). |
| **modify** | `packages/shared/test/ids.test.ts`, `ids-phase4.test.ts` | Remove `projectIdSchema` cases. |
| **modify** | `apps/gui/test/view-id.test-d.ts` | Remove `PROJECT_SCOPED_VIEWS` assertions. |

---

## 4. Data model & API changes

### 4.1 Removed types
- `Project` / `projectSchema` (`packages/core/src/project.ts`) — gone.
- `Session` / `sessionSchema` / `SessionUpdatePatch` (`packages/core/src/session.ts`) — gone (live sessions only).
- `ProjectId` / `projectIdSchema` (`packages/shared/src/ids.ts`) — gone.

### 4.2 Changed entity types (re-key)
Each entity drops `projectId: ProjectId` and gains `workspaceKey: z.string().min(1)`. `workspaceKey` is the F3 cwd-encoded key (short sha256 of the absolute cwd). It is **not** a branded UUID — it is a content-derived string, so it is validated as a non-empty string only (the encoder is the trust boundary, per `code-conventions §Boundaries`).

```ts
// packages/core/src/memory-entry.ts (and parallel in project-rule/failed-attempt/task-plan/tool-definition)
export const memoryEntrySchema = z
  .object({
    id: memoryEntryIdSchema,
    workspaceKey: z.string().min(1),     // was: projectId: projectIdSchema
    sessionId: z.string().min(1).nullable(), // live cliSessionId, was: sessionIdSchema.nullable()
    scope: memoryScopeSchema,            // F4 split: "project" scope re-reads as the cwd/workspace scope
    // …unchanged…
  })
  .strict()
  .superRefine(/* unchanged session/scope invariants */);
```

`scope: "project"` keeps its enum value for on-disk compatibility but **means "workspace/cwd-scoped"** post-F4 (the architecture §6.4 split: cwd-scoped re-keys to `workspaceKey`, session-scoped to the live `sessionId`). F5 does not rename the enum value (would break stored rows); it only re-keys the partition column.

### 4.3 Store paths / schemas

**Removed:** `~/.local/share/megasaver/projects.json`, `sessions.json`.

`resolveStorePaths(rootDir)` returns (F5 shape, after F3.4 dir renames):
```
rootDir
memoryDir            = <root>/memory
rulesDir             = <root>/rules            (was project-rules)
failedAttemptsDir    = <root>/failed-attempts
tasksDir             = <root>/tasks            (was task-plans)
toolsDir             = <root>/tools            (was tool-definitions)
workspacesPath       = <root>/workspaces.json  (derived cache, written by F3 resolver)
migrationsDir        = <root>/.migrations      (idempotency markers)
```
Per-entity files: `<entityDir>/<workspaceKey>.jsonl` (was `<projectId>.jsonl`). Stats/content (token-saver, fetchChunk): `stats/<workspaceKey>/<sessionId>.{events,audit}.jsonl`, `content/<workspaceKey>/<sessionId>/<chunkSetId>.json` (F4 keys; F5 migration renames the `<projectId>` segment).

### 4.4 Migration contract — `migrateProjectsToWorkspaces(storeRoot)`

Idempotent, resumable, marker-guarded. Signature:
```ts
// packages/core/src/migrate-projects-to-workspaces.ts
export type MigrationResult = {
  alreadyDone: boolean;
  workspaces: number;            // rows written to workspaces.json
  renamed: number;               // per-project files/dirs renamed
  skippedNoProject: number;      // <id>.jsonl with no projects.json row (orphan, left in place + logged)
};
export function migrateProjectsToWorkspaces(
  storeRoot: string,
  encodeWorkspaceKey: (cwd: string) => string, // F3 encoder, injected (no cross-import of the bridge resolver)
  clock: { now: () => string },
): MigrationResult;
```

Algorithm:
1. If `<root>/.migrations/0001-remove-projects.done` exists → return `{ alreadyDone: true, … }` (no-op).
2. Read legacy `projects.json` (absent ⇒ empty list ⇒ nothing to map). Build `projectId → { workspaceKey, cwd: rootPath, label }` using `encodeWorkspaceKey(rootPath)`. Two projects with the same `rootPath` collapse to one `workspaceKey` (merge, see R2).
3. **Upsert** `workspaces.json` (don't clobber an F3-written cache): for each derived workspace, add/merge `{ workspaceKey, label: cwd, firstSeen, lastSeen }` keyed by `workspaceKey`.
4. For each per-project dir (`memory`, `rules` ← legacy `project-rules`, `failed-attempts`, `tasks` ← `task-plans`, `tools` ← `tool-definitions`) and for `stats/<projectId>/` + `content/<projectId>/`: for every `<projectId>.jsonl` / `<projectId>/` whose `projectId` is in the map, rewrite each line's `projectId` field → `workspaceKey`, then write to `<workspaceKey>.jsonl` / `<workspaceKey>/`. **Merge** when the target already exists (two projects → one workspace): append-dedupe by `id`. Remove the source only after the target write fsyncs (atomic-write + fsync per `json-directory-store.atomicWriteFile`).
5. `<id>.jsonl` with no matching `projects.json` row ⇒ orphan: leave in place, increment `skippedNoProject`, log once. (Don't guess a cwd.)
6. Write the `.done` marker last (so a crash mid-step re-runs cleanly; step 4 is itself idempotent because already-renamed sources are gone and re-derived keys are stable).

Legacy dir name handling: the migration reads BOTH the legacy dir name (`project-rules`) and the new one (`rules`); if F3 already created the new dir, step 4 merges into it.

### 4.5 API shape after F5
- **Removed:** `GET/POST /api/projects`; `GET/POST /api/sessions`; `PATCH /api/sessions/:id`; `POST /api/sessions/:id/end`; `GET /api/projects/:id/{audit,rules,context,tasks,tools,index,index/search}`.
- **Kept (live backbone):** `GET /api/claude-sessions`, `GET /api/claude-sessions/:dir/:id`, `GET /api/claude-sessions/:dir/:id/stream` (+ F0 telemetry, F4 memory/tasks/token-saver session-scoped sub-routes).
- **Kept (workspace, from F1/F3):** `GET /api/workspaces`, `GET /api/workspaces/:key/{index,context,rules,tools,permissions}`.
- **`/api/mcp/install` & `/api/mcp/repair`** request bodies: drop `project`, gain the resolved cwd (F3 concern; F5 removes the `project` field from `zod-schemas.ts` + `api-client.ts`).
- **`/api/health`** unchanged (`{ ok: true, store }`).

---

## 5. Implementation tasks (TDD)

Order is dependency-driven: re-key the leaf entity schemas first (compiles ripple up), then store, then registry, then migration, then bridge, then GUI, then the sweep. Every task: write failing test → run & confirm red → minimal impl → run & confirm green → commit. Commands (repo root):
- `pnpm --filter @megasaver/core test` / `pnpm --filter @megasaver/gui test`
- `pnpm --filter @megasaver/<pkg> typecheck`
- `npx biome check <changed paths>`
- final gate: `pnpm verify`

Each task is in its own commit; the whole phase is in one worktree (`feat/live-first-f5-remove-projects`) per §10.

---

### Task A — Re-key the five overlay entity schemas
**Files:** modify `packages/core/src/{memory-entry,project-rule,failed-attempt,task-plan,tool-definition}.ts`; test `packages/core/test/{memory-entry,project-rule,failed-attempt,task-plan-schema,tool-definition-schema}.test.ts`.
1. Add a failing test: a row with `workspaceKey: "ws-abc"` (no `projectId`) parses; a row with `projectId` is **rejected** by `.strict()`.
2. `pnpm --filter @megasaver/core test` → expect fail (field still `projectId`).
3. Replace `projectId: projectIdSchema` with `workspaceKey: z.string().min(1)` in each schema; drop the `projectIdSchema` import.
4. Re-run → green. Fix the cascading compile in `registry.ts` minimally (rename only).
5. `biome check` the five files. Commit: `refactor(core): re-key overlay entities projectId->workspaceKey`.

> Note: keep `sessionId` as `z.string().min(1).nullable()` (live cliSessionId). The `scope`/`sessionId` superRefine invariants are unchanged.

### Task B — Re-key the JSON store fns + dir renames
**Files:** modify `packages/core/src/json-directory-store.ts`; test `packages/core/test/json-directory-store.test.ts`.
1. Failing test: `resolveStorePaths(root)` exposes `rulesDir`/`tasksDir`/`toolsDir` (not `projectRulesDir`/`taskPlansDir`/`toolDefinitionsDir`) and NO `projectsPath`/`sessionsPath`; `writeMemoryEntriesForWorkspace(paths, "ws-abc", […])` writes `memory/ws-abc.jsonl`.
2. Run → red.
3. Rename `StorePaths` fields + the dir `join`s; rename every `*ForProject(paths, projectId, …)` → `*ForWorkspace(paths, workspaceKey, …)` (param type `string`); delete `readProjects/writeProjects/readSessions/writeSessions` + `projectsPath/sessionsPath`. Add `workspacesPath` + `migrationsDir`.
4. Run → green.
5. Commit: `refactor(core): store keyed by workspaceKey, drop project/session tiers`.

### Task C — Drop project/session CRUD + `requireProject` from both registries
**Files:** modify `packages/core/src/{registry,json-directory-registry}.ts`; test `packages/core/test/{registry,json-directory-registry}.test.ts`.
1. Failing test: `CoreRegistry` has no `createProject`/`createSession`/`listProjects`/`endSession`; `createMemoryEntry` for a never-before-seen `workspaceKey` **succeeds** (no `requireProject` gate — workspaces are auto-derived, not pre-created).
2. Run → red (methods still present; `requireProject` still throws).
3. Remove the project/session methods from the `CoreRegistry` interface + both impls; delete `requireProject`; re-key `list*`/`create*`/`search*`/`route*` signatures `projectId → workspaceKey`. The cross-entity session-existence checks (`createMemoryEntry`/`createFailedAttempt`/`createTaskPlan` session-mismatch guards) **drop** — there is no store-session registry to check against; session id is an opaque live string.
4. Run → green.
5. Commit: `refactor(core): drop project model + requireProject from registry`.

### Task D — Delete `project.ts` / `session.ts` / `projectIdSchema`; fix re-exports
**Files:** delete `packages/core/src/{project,session}.ts`; modify `packages/core/src/index.ts`, `packages/shared/src/{ids,index}.ts`; test `packages/shared/test/ids.test.ts`.
1. Failing test (`shared`): `import { projectIdSchema } from "@megasaver/shared"` no longer type-checks (move the existing case to a `// @ts-expect-error` or delete it).
2. Delete the files + the `projectIdSchema`/`ProjectId` exports + the `./project.js`/`./session.js` re-exports in core's `index.ts`.
3. `pnpm --filter @megasaver/shared typecheck && pnpm --filter @megasaver/core typecheck` → green.
4. Commit: `refactor(shared,core): remove Project/Session/ProjectId types`.

### Task M — One-time migration `migrateProjectsToWorkspaces`
**Files:** create `packages/core/src/migrate-projects-to-workspaces.ts`; export in `index.ts`; test `packages/core/test/migrate-projects-to-workspaces.test.ts`.
1. Failing tests (write all, run red):
   - **idempotent:** marker present ⇒ `{ alreadyDone: true }`, no file changes.
   - **maps rows:** seed legacy `projects.json` (two projects, distinct `rootPath`) + `memory/<id>.jsonl`; after migrate, `workspaces.json` has two rows, `memory/<workspaceKey>.jsonl` exists with `workspaceKey` rewritten, source `<id>.jsonl` gone, marker written.
   - **merge collision:** two projects, **same `rootPath`** ⇒ one `workspaceKey`; their `memory/<id>.jsonl` rows merge into one `memory/<workspaceKey>.jsonl` deduped by `id`.
   - **dir rename:** legacy `project-rules/<id>.jsonl` → `rules/<workspaceKey>.jsonl`; `task-plans` → `tasks`; `tool-definitions` → `tools`.
   - **stats/content:** `stats/<id>/x.events.jsonl` → `stats/<workspaceKey>/…`; `content/<id>/<sess>/c.json` → `content/<workspaceKey>/<sess>/…`.
   - **orphan:** `memory/<unknown-id>.jsonl` with no `projects.json` row ⇒ left in place, `skippedNoProject === 1`.
   - **resumable:** delete the marker after a partial run (simulate by pre-creating one renamed target) ⇒ re-run completes without error or duplication.
2. Run → red (no module).
3. Implement per §4.4 using `atomicWriteFile` semantics (fsync before unlink-source). Inject `encodeWorkspaceKey` (a stub in tests; the F3 encoder in prod) — **no import of the bridge resolver** (keeps core agent-agnostic per §1 mission). Use a stub encoder `(cwd) => "ws-" + simpleHash(cwd)` in tests.
4. Run → green.
5. `biome check`. Commit: `feat(core): idempotent projects->workspaces migration`.

### Task E — Bridge: drop project routes + registry from context/handler
**Files:** delete `apps/gui/bridge/routes/{projects,project-scoped,_project,audit,rules,context,index-routes,tasks,tools,sessions}.ts`; modify `apps/gui/bridge/{handler,route-context,zod-schemas,server}.ts`; modify `apps/gui/test/bridge/{handler*,contextops-routes}.test.ts`, `test-helpers.ts`.
1. Failing test: `GET /api/projects` → `404 route_not_found`; `GET /api/projects/<id>/audit` → 404; `RouteContext` type has no `registry`; `startTestBridge` no longer accepts `projects`/`sessions`.
2. Run → red.
3. Delete the route files + their `import` + dispatch branches in `handler.ts`; remove `registry` from `BridgeHandlerOptions` + `RouteContext`; delete `CREATE_PROJECT_BODY`/`CREATE_SESSION_BODY` + `projectId` fields in `zod-schemas.ts`; `server.ts` stops building/passing `registry` and calls `migrateProjectsToWorkspaces` once on boot; update `test-helpers.ts` (drop registry seeding + project fixtures or re-key to `workspaceKey`).
4. Run → green (`pnpm --filter @megasaver/gui test`).
5. Commit: `refactor(gui-bridge): remove /api/projects* and registry surface`.

### Task F — `api-client.ts`: delete project clients
**Files:** modify `apps/gui/src/lib/api-client.ts`; (type-only — verified via `pnpm --filter @megasaver/gui typecheck` + the views that import them in Task G).
1. Failing check: a temporary `// @ts-expect-error` on `fetchProjects(` import in a scratch test, OR rely on Task G's view deletions to surface unused exports. Prefer: delete the client fns and let Task G's compile be the red→green.
2. Delete `fetchProjects`, `createProject`, `fetchSessions`, `createSession`, `endSession`, `updateSession`, `fetchAudit`, `fetchRules`, `fetchIndexStatus`, `searchIndex`, `fetchContext`, `fetchTasks`, `fetchToolsRoute` + their request/response types + the `project` arg on `installMcp`/`repairMcp`.
3. `pnpm --filter @megasaver/gui typecheck` → green once Task G lands.
4. Commit with Task G (they are one compile unit).

### Task G — GUI shell: delete picker/create/gating + project views
**Files:** delete `apps/gui/src/components/{project-picker,project-create-form}.tsx`, `apps/gui/src/views/{overview-view,sessions-view,sessions-list,sessions-detail,memory-view,rules-view,index-view,context-view,tasks-view,tools-view}.tsx` (those not already moved to cockpit panels by F2/F3); modify `apps/gui/src/app.tsx`, `view-id.ts`, `components/states.tsx`, `views/agent-setup-doctor.tsx`, `components/agent-setup-row.tsx`; test `apps/gui/test/view-id.test-d.ts`.
1. Failing test: `view-id.test-d.ts` asserts `PROJECT_SCOPED_VIEWS` is removed and `VIEW_IDS` no longer contains the project-scoped ids; `app.tsx` renders the live shell with no `activeProjectId` (a render smoke in `apps/gui/test/smoke/boot.test.ts` that the shell mounts without a project).
2. Run → red.
3. Delete the components/views; rewrite `app.tsx` to mount the F2 live shell only; strip `PROJECT_SCOPED_VIEWS` + dead ids/labels from `view-id.ts`; remove `NoProjectState`; drop `activeProjectId` from `agent-setup-doctor.tsx`.
4. Run → green.
5. `biome check`. Commit: `refactor(gui): live shell only, remove project picker/gating/views`.

### Task H — Dead-code sweep + full verify
**Files:** any orphaned imports/types across `packages/core`, `apps/gui`, `packages/mcp-bridge` (mechanical rename only), `packages/shared`.
1. `pnpm verify` → collect every lint/type/test failure (root-cause, first failure, exit code only — no raw log dump per §13).
2. Remove orphaned imports/vars that **F5's** changes made unused (per `CLAUDE.md §3`: only your own orphans). For `packages/mcp-bridge/src/tools/*`, apply the mechanical `projectId → workspaceKey` rename if and only if the core type change broke the build.
3. Re-run `pnpm verify` → green.
4. Commit: `chore(repo): remove project-model orphans; verify green`.

---

## 6. Risks & decisions

- **R1 — Sequencing (HIGHEST).** F5 *deletes* the `projectId` fallbacks F3/F4 leave in place. Running F5 before F4 ships `(workspaceKey, sessionId)` read/write would orphan memory/tasks/token-saver data. **Decision:** F5 is gated on F3 **and** F4 being merged to `main` and verified; the spec's "Depends on" is a hard gate, not advisory.
- **R2 — Two projects, one cwd.** Distinct `projectId`s with the same `rootPath` collapse to one `workspaceKey`. **Decision:** migration **merges** their per-entity files (append-dedupe by entity `id`); no data loss, last-write-wins on `workspaces.json` `lastSeen`. Tested in Task M "merge collision".
- **R3 — Migration is destructive at scale (CRITICAL).** It renames/removes files under `~/.local/share/megasaver`. **Decision:** atomic-write + fsync the target **before** unlinking the source; marker-guarded + resumable so a crash never double-applies; orphan files are never deleted (only logged). Per §12 CRITICAL: `security-reviewer` + verifier-with-reproduction (run against a copied real store) + explicit user-confirmation note in this spec. **No autopilot/ralph on this task.**
- **R4 — CLI still imports `@megasaver/core` project API.** Removing `createProject`/`Session`/`ProjectId` breaks `apps/cli`. **Decision (recommended):** defer the CLI to **F5b** and, for F5, exclude `apps/cli` from the F5 worktree's `pnpm verify` scope is NOT allowed (verify is repo-wide). Therefore F5 must either (a) also land the mechanical CLI rename so the monorepo compiles, or (b) F5b lands *in the same PR* as a second commit. **Pick (a) minimal mechanical compile-fix in F5**; full CLI live-first re-home stays F5b. Flag for `architect` review.
- **R5 — `workspaceKey` is not a UUID.** Entities now carry a content-derived string key. **Decision:** validate as `z.string().min(1)` only; the F3 encoder is the trust boundary (`code-conventions §Boundaries`). Filesystem safety of the key (path segment) is the encoder's contract, asserted in F3, re-checked by the migration's path-join.
- **R6 — `scope: "project"` enum value retained.** Renaming it to `"workspace"` would invalidate every stored row. **Decision:** keep the on-disk value; it semantically means cwd/workspace-scoped post-F4. Documented in §4.2.
- **R7 — Hidden untitled/CLI sessions.** Unchanged (locked decision §7.4): list stays metadata-gated. F5 does not surface them.
- **R8 — mcp-bridge tools.** They still take `projectId` in MCP input schemas. **Decision:** F5 applies only the mechanical compile-keeping rename; the semantic re-key (so MCP clients pass a `workspaceKey`/cwd) is F4/F5b.

---

## 7. Definition of done

Per `CLAUDE.md §9`, all must hold:
1. This spec in `docs/superpowers/specs/`; plan in `docs/superpowers/plans/` (writing-plans output).
2. TDD: every task wrote its failing test first (red→green evidenced in the worktree history).
3. **`pnpm verify` green** repo-wide: `biome check` + `tsc -b --noEmit` (project refs) + `vitest run` all pass. No `projectId`/`requireProject`/`projects.json` references remain (`grep -rn "projectId\|requireProject\|projects.json\|PROJECT_SCOPED_VIEWS" packages apps --include=*.ts --include=*.tsx` returns only intentional `// legacy` reads inside the migration).
4. **Feature smoke evidence:**
   - **Migration against real data:** copy the developer's real `~/.local/share/megasaver` to a temp dir, run `migrateProjectsToWorkspaces(tmp, realEncoder, clock)`, capture: `workspaces.json` row count, renamed file list, `skippedNoProject` count, marker present; re-run shows `{ alreadyDone: true }`. Capture as a verifier transcript.
   - **Live smoke:** boot the GUI against the real `~/.claude/projects`, confirm the live session list + cockpit render with **no** project picker, agent-setup install/repair work without a project, and a re-keyed memory/rules/tasks panel reads its `<workspaceKey>.jsonl`.
5. External reviewer pass: `code-reviewer` AND `critic` (HIGH/CRITICAL — separate contexts, neither the author).
6. `security-reviewer` pass on the migration (path-traversal on `workspaceKey` segments, no source-delete-before-target-durable).
7. Verifier (`omc:verify`) evidence-based pass with the migration reproduction above.
8. Zero pending TodoWrite items for F5.
9. Changeset added (core + shared + gui public API changed).
10. No conventions-doc drift (`pnpm conventions:check`).
