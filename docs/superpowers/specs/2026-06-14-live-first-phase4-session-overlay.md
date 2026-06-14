# Live-First Phase 4: Session-scoped overlay features

**Date:** 2026-06-14
**Status:** Spec — pending implementation
**Risk:** HIGH (session storage format change + reads/writes user files at scale; proxy re-key is a connector-core path). Per CLAUDE.md §12: full superpowers chain + `architect` design + `critic` adversarial review + worktree, no `main` edits.

Parent: [`docs/superpowers/specs/2026-06-14-live-first-architecture.md`](./2026-06-14-live-first-architecture.md) — §5 Phase 4, §6.1/§6.4 (locked decisions), §7.

---

## 1. Goal & Depends on

**Goal.** Re-home the three session-scoped features — memory/notes, task plans, and the proxy-fed token-saver stats — off `(projectId, sessionId)` onto the live-first key `(workspaceKey, liveSessionId)`, served by new session-scoped bridge routes under `/api/claude-sessions/:dir/:id/{memory,tasks,token-saver}` and rendered as write-capable cockpit panels that NEVER touch Claude's transcripts.

**Depends on:**
- **F0** (telemetry surfacing) — no hard code dependency, but ships first per roadmap.
- **F3** (cwd/workspace features re-pointed) — **hard dependency.** F3 must already have landed:
  1. `workspaceKey` encoding (`sha256(cwd)` short hash + human label) and the `WorkspaceResolver` that maps a live session `(dir, id)` → `{ workspaceKey, cwd, label }` by reading the transcript's first/most-common `cwd` (architecture §6.5);
  2. the cwd-keyed overlay-store base path layout (`~/.local/share/megasaver/{memory,rules,...}/<workspaceKey>...`) and the `OverlayStore` accessor that F3 introduced for index/rules/tools;
  3. `safeWorkspacePath` (the F3 extension of `safeSessionPath` to cwd/overlay file access);
  4. `RouteContext` carrying the resolver + overlay roots.
  This spec assumes those exist and **extends** them to session-scoped artefacts. Where F4 needs a resolver/overlay surface F3 did not build, the task notes call it out explicitly (and it is built here, not assumed).
- **F2** (cockpit shell) — the cockpit panel host that F4 panels mount into. If F2 has not landed, the panels mount into the existing `ClaudeSessionsView` detail pane as a fallback (noted per GUI task).

Not a dependency: **F5** (project-model removal). F4 leaves the old `/api/projects/:id/{memory,tasks}` and `/api/sessions/:id/token-saver` routes in place and adds the new live routes alongside them; F5 deletes the old tier and runs the one-time migration.

---

## 2. Scope

### In scope
- **Overlay-store re-key** for the three session features:
  - **memory** → split `scope`: `project` rows re-home to `workspaceKey` (cross-session, cwd-level); `session` rows re-home to `liveSessionId`. Store moves from `memory/<projectId>.jsonl` to `memory/<workspaceKey>.jsonl` with `liveSessionId: string | null` on the row.
  - **tasks** → `TaskPlan` re-keyed `(projectId,sessionId)` → `(workspaceKey, liveSessionId)`; store moves to `tasks/<workspaceKey>/<liveSessionId>.jsonl`.
  - **token-saver stats + content** → stats `(projectId,sessionId)` → `(workspaceKey, liveSessionId)`; store moves to `stats/<workspaceKey>/<liveSessionId>.{json,events.jsonl}` and content to `content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json`. Token-saver stays **LIVE** per locked decision §6.1 — fed by Proxy Mode/output-filter when active; read-only render when the proxy is off.
- **Proxy (context-gate) re-key** — the heaviest item. `runOutputPipeline`/`runOutputExecCommand` stop resolving `(projectId, sessionId)` from the `CoreRegistry` session row and instead take `(workspaceKey, liveSessionId, cwd)` resolved from the live session, writing events/chunks under the new keys.
- **Session-scoped bridge routes** — `GET/POST/PATCH/DELETE /api/claude-sessions/:dir/:id/memory`, `GET /api/claude-sessions/:dir/:id/tasks`, and the `GET .../token-saver/{status,stats,events,events/:eventId/{raw,sent}}` family. Path safety extends `safeSessionPath`/`safeWorkspacePath` to every overlay-file access derived from `(dir, id)`.
- **Cockpit panels (write-capable overlay)** — Memory (create/edit/delete), Tasks (read-only list with ready-steps), Token-saver (read-only stats + events + blob view). All scoped to the selected live session + its workspace. NEVER writes Claude transcripts or metadata.
- **TDD coverage** at the layer boundaries: overlay-store unit tests, registry/resolver port tests, bridge route tests via `startTestBridge`, and parse/key-derivation tests.

### Out of scope (deferred)
- **Removing** `/api/projects/:id/{memory,tasks}`, `/api/sessions/:id/token-saver`, `projects.json`/`sessions.json`, and `requireProject` — that is **F5**.
- The **one-time on-disk migration** (`<projectId>.jsonl` → `<workspaceKey>.jsonl`, `rootPath`→cwd) — **F5**. F4 reads/writes the new layout only; pre-existing project-keyed files are untouched until F5 migrates them.
- Index/context/rules/tools/permissions re-home — **F3** (already landed per Depends on).
- Transcript-derived LLM telemetry panel (tokens/model/turns) — **F0**, a separate complementary panel.
- Enabling/disabling the proxy from the cockpit (the `enable`/`disable` POST flow currently on `/api/sessions/:id/token-saver`) — the proxy on/off toggle stays on the legacy session route through F4; the live route is **read-only** on stats. Wiring a live enable/disable is deferred until F5 removes the session model (the toggle's natural home is the workspace, tracked there).
- Failed-attempts / FORGE rules overlay — those are cwd-scoped (F3), not session-scoped.

---

## 3. File-level changes

| Action | Path | Responsibility |
|---|---|---|
| **create** | `packages/core/src/overlay-key.ts` | `WorkspaceKey`/`LiveSessionId` branded-string schemas (permissive filesystem-safe segment, NOT lowercase-UUID); `isSafeKeySegment` guard reused by store + routes. |
| **modify** | `packages/core/src/memory-entry.ts` | Add `liveSessionId: z.string().nullable()` and `workspaceKey: z.string()` to a new `overlayMemoryEntrySchema` (F4 shape); keep `memoryEntrySchema` untouched for F5. Re-express the `scope` superRefine against the new key fields. |
| **modify** | `packages/core/src/task-plan.ts` | Add `overlayTaskPlanSchema` with `workspaceKey: string` + `liveSessionId: string | null` (replacing `projectId`/`sessionId` for the overlay variant); leave `taskPlanSchema` for F5. |
| **create** | `packages/core/src/overlay-store.ts` | Overlay re-key store: `read/writeOverlayMemory(root, workspaceKey)`, `read/writeOverlayTaskPlans(root, workspaceKey, liveSessionId)`. Mirrors `json-directory-store.ts` atomic-write + empty-set-deletes semantics, but keyed by `workspaceKey`/`liveSessionId` path segments. |
| **modify** | `packages/core/src/index.ts` | Export the new overlay schemas/types/store fns + key types. |
| **modify** | `packages/stats/src/store.ts` | Parameterize `summaryPath`/`eventsPath` to accept `(workspaceKey: string, liveSessionId: string)` instead of branded `ProjectId`/`SessionId`; add `readOverlaySummary`/`appendOverlayEvent`/`readOverlayEvents`/`resetOverlayOnDisable`. Keep existing fns for F5. |
| **modify** | `packages/stats/src/event.ts` | Add `overlayTokenSaverEventSchema` keyed `workspaceKey`/`liveSessionId` (permissive strings) alongside the branded `tokenSaverEventSchema`. |
| **modify** | `packages/stats/src/summary.ts` | Add `overlaySessionTokenSaverStatsSchema` keyed by `liveSessionId: string`. |
| **modify** | `packages/stats/src/index.ts` | Export overlay variants. |
| **modify** | `packages/content-store/src/*` (the `loadChunkSet`/`persistChunkSet` path builders) | Accept `(workspaceKey, liveSessionId)` segments for the `content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json` layout; keep project-keyed signature for F5. |
| **modify** | `packages/context-gate/src/run.ts` | `RunOutputInput` takes `{ workspaceKey, liveSessionId, cwd }` (replacing the registry-resolved `projectId`); resolve effective settings from cwd permissions + the live key instead of a `CoreRegistry` session row; emit events/chunks under overlay keys. |
| **modify** | `packages/context-gate/src/run-command.ts` | Same re-key for the exec pipeline. |
| **modify** | `packages/context-gate/src/read.ts` (`resolveEffectiveSettings`, `runTwoGates`, `persistChunkSet`) | Drop the registry session lookup; take cwd + permissions + overlay key directly. (Token-saver mode/budget now come from a workspace/session overlay-settings source, not `Session.tokenSaver` — see §4.) |
| **modify** | `apps/gui/bridge/route-context.ts` | Add `resolveWorkspace(dir, id): Promise<{ workspaceKey, cwd, label } \| null>` (F3 resolver; extend if absent) and overlay store roots already on ctx. |
| **modify** | `apps/gui/bridge/handler.ts` | Route the three new `/api/claude-sessions/:dir/:id/{memory,tasks,token-saver…}` paths to the new dispatchers; inject resolver. |
| **create** | `apps/gui/bridge/routes/claude-session-memory.ts` | `GET/POST/PATCH/DELETE` overlay memory for `(dir,id)` → resolved `(workspaceKey, liveSessionId)`. |
| **create** | `apps/gui/bridge/routes/claude-session-tasks.ts` | `GET` overlay task plans for the resolved key, with `readySteps`. |
| **create** | `apps/gui/bridge/routes/claude-session-token-saver.ts` | `GET` overlay stats/events/blobs for the resolved key (read-only). |
| **modify** | `apps/gui/bridge/zod-schemas.ts` | Add request-body schemas for the live memory create/patch (no `projectId`; key resolved server-side from `(dir,id)`). |
| **modify** | `apps/gui/src/lib/claude-sessions-client.ts` | Add `fetchSessionMemory/createSessionMemory/patchSessionMemory/deleteSessionMemory`, `fetchSessionTasks`, `fetchSessionTokenSaver*` client fns + their types. |
| **create** | `apps/gui/src/views/cockpit/memory-panel.tsx` | Write-capable memory panel (list + create/edit/delete) bound to the selected session. |
| **create** | `apps/gui/src/views/cockpit/tasks-panel.tsx` | Read-only task-plan panel. |
| **create** | `apps/gui/src/views/cockpit/token-saver-panel.tsx` | Read-only stats/events/blob panel. |
| **modify** | `apps/gui/src/views/claude-sessions-view.tsx` | Mount the three panels in the session detail pane (or the F2 cockpit host if present), gated on `selected`. |
| **create** | `packages/core/test/overlay-store.test.ts` | Overlay store round-trip, empty-set-deletes, workspaceKey/liveSessionId path isolation, scope-split memory. |
| **create** | `packages/core/test/overlay-key.test.ts` | Key-segment safety (rejects `/`, `..`, `\0`, empty). |
| **modify** | `packages/stats/test/*` | Overlay summary/event round-trip + path isolation. |
| **modify** | `packages/context-gate/test/*` | Pipeline re-key: events/chunks land under `(workspaceKey, liveSessionId)`; settings resolved from cwd not registry. |
| **create** | `apps/gui/test/bridge/claude-session-memory-route.test.ts` | Live memory CRUD over real transcript fixtures. |
| **create** | `apps/gui/test/bridge/claude-session-tasks-route.test.ts` | Live tasks read. |
| **create** | `apps/gui/test/bridge/claude-session-token-saver-route.test.ts` | Live stats/events read, path-traversal 400, not-found 404. |
| **modify** | `apps/gui/test/bridge/test-helpers.ts` | Extend `StoreSeed` with `overlayMemory`/`overlayTasks`/overlay-keyed stats; add a transcript-fixture helper that writes a `~/.claude/projects/<dir>/<id>.jsonl` + matching `local_*.json` so the resolver yields a known `(workspaceKey, cwd)`. |

---

## 4. Data model & API changes

### 4.1 Keys
```ts
// packages/core/src/overlay-key.ts
// NOT lowercase-UUID: workspaceKey is sha256-hash(cwd) (F3); liveSessionId is the
// Claude transcript uuid (already lowercase but we do not re-brand it as SessionId,
// to avoid the projectId FK coupling). Both become path segments → must be safe.
export const workspaceKeySchema = z.string().min(1).refine(isSafeKeySegment).brand<"WorkspaceKey">();
export const liveSessionIdSchema = z.string().min(1).refine(isSafeKeySegment).brand<"LiveSessionId">();
export function isSafeKeySegment(v: string): boolean {
  return v.length > 0 && !v.includes("/") && !v.includes("\\") && !v.includes("\0") && v !== "." && v !== "..";
}
```

### 4.2 Memory (scope split)
New overlay shape — `projectId` removed, two new keys; the `scope` invariant now binds the keys:
```ts
// overlayMemoryEntrySchema (memory-entry.ts) — F4 variant
{
  id: memoryEntryIdSchema,            // unchanged (lowercase uuid)
  workspaceKey: z.string().min(1),    // cwd-derived; ALWAYS present
  liveSessionId: z.string().nullable(),
  scope: memoryScopeSchema,           // "project" | "session"
  // …all other fields unchanged (type/title/content/keywords/confidence/source/approval/…)
}
// superRefine:
//   scope === "session"  ⇒ liveSessionId !== null   (conversation-scoped)
//   scope === "project"  ⇒ liveSessionId === null    (cwd/workspace-scoped, cross-session)
```
**Note:** the `MemoryScope` enum value `"project"` is retained as the wire/storage label for backward type-compat; semantically it now means *workspace/cwd-scoped*. Renaming the enum to `workspace` is deferred to F5 (storage-format churn).

Store: `memory/<workspaceKey>.jsonl` (one file per workspace; both project- and session-scoped rows live in it, distinguished by `liveSessionId`/`scope`).

### 4.3 Tasks
```ts
// overlayTaskPlanSchema (task-plan.ts) — F4 variant
{ id, workspaceKey: string, liveSessionId: string | null, task, status, steps, createdAt, updatedAt }
```
Store: `tasks/<workspaceKey>/<liveSessionId>.jsonl` (matches architecture §3.4). A plan with `liveSessionId === null` is a workspace-level plan → file `tasks/<workspaceKey>/_workspace.jsonl` (reserved segment, key-safe).

### 4.4 Token-saver stats / events / content (proxy overlay)
```ts
// overlayTokenSaverEventSchema (event.ts): same fields, but
//   sessionId → liveSessionId: z.string().min(1)
//   projectId → workspaceKey:  z.string().min(1)
// overlaySessionTokenSaverStatsSchema (summary.ts): sessionId → liveSessionId: z.string().min(1)
```
Store paths (stats/store.ts, re-keyed):
```
stats/<workspaceKey>/<liveSessionId>.json            # summary
stats/<workspaceKey>/<liveSessionId>.events.jsonl    # append-only audit
content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json
```
**Token-saver settings source.** Today `mode`/`budget`/`storeRawOutput` live on `Session.tokenSaver`. With the session model gone in F5, the overlay needs its own settings home. F4 introduces `stats/<workspaceKey>/<liveSessionId>.settings.json` (or reuses an F3 workspace-settings file if one exists) holding `TokenSaverSettings`. The live route is **read-only**; the proxy reads these settings, and the legacy `/api/sessions/:id/token-saver/{enable,disable}` continues to write `Session.tokenSaver` through F4 (deferred wiring per §2 out-of-scope).

### 4.5 Endpoints (method + path → response)

| Method | Path | Response (200/201) | Errors |
|---|---|---|---|
| `GET` | `/api/claude-sessions/:dir/:id/memory?scope=&query=&limit=&offset=` | `OverlayMemoryEntry[]` (sorted `createdAt` desc; `scope` filter = `session` returns rows for this `liveSessionId`, `project` returns this workspace's cwd-scoped rows, omitted = both) | 400 invalid path, 404 session-not-found |
| `POST` | `/api/claude-sessions/:dir/:id/memory` | `201 OverlayMemoryEntry` | 400 validation, 404 session-not-found |
| `PATCH` | `/api/claude-sessions/:dir/:id/memory/:entryId` | `200 OverlayMemoryEntry` | 400 validation, 404 not-found |
| `DELETE` | `/api/claude-sessions/:dir/:id/memory/:entryId` | `200 { id }` | 404 not-found |
| `GET` | `/api/claude-sessions/:dir/:id/tasks` | `{ plan: OverlayTaskPlan; ready: TaskStepId[] }[]` | 400 invalid path, 404 |
| `GET` | `/api/claude-sessions/:dir/:id/token-saver/status` | `{ enabled: boolean; settings: TokenSaverSettings \| null }` | 400, 404 |
| `GET` | `/api/claude-sessions/:dir/:id/token-saver/stats` | `OverlaySessionTokenSaverStats \| null` | 400, 404 |
| `GET` | `/api/claude-sessions/:dir/:id/token-saver/events` | `OverlayTokenSaverEvent[]` (desc) | 400, 404 |
| `GET` | `/api/claude-sessions/:dir/:id/token-saver/events/:eventId/{raw,sent}` | `text/plain` chunk-set blob | 400, 404 event-not-found |

**Resolution contract.** Every handler: (1) `safeSessionPath(claudeProjectsDir, dir, id)` → 400 on traversal; (2) `resolveWorkspace(dir, id)` reads the transcript's cwd → `{ workspaceKey, liveSessionId: id, cwd }`, returns `null` → 404 `claude_session_not_found`; (3) all overlay file access goes through `safeWorkspacePath(overlayRoot, workspaceKey, liveSessionId, file)`. The `(dir, id)` from the URL are the ONLY untrusted inputs; `workspaceKey`/`liveSessionId` are derived server-side, never sent by the client.

**RouteContext additions:** `resolveWorkspace`, plus the overlay roots (memory/tasks/stats/content) already present from F3; F4 only reads them.

---

## 5. Implementation tasks (TDD)

Conventions for every task: ESM `.js` import specifiers; Biome; Vitest red→green; `exactOptionalPropertyTypes` (spread optionals in, never `undefined`); `noUncheckedIndexedAccess` (guard array/`match[n]` access). Commands:
- core/stats/context-gate: `pnpm --filter @megasaver/<pkg> test` / `… typecheck`
- gui: `pnpm --filter @megasaver/gui test` / `… typecheck`
- lint: `npx biome check <paths>`
- full gate: `pnpm verify`

Commit after each task (`feat(...)`/`test(...)`, ≤50-char imperative subject, Co-Authored-By trailer).

---

### Task 1 — overlay key types + segment safety
**Files:** create `packages/core/src/overlay-key.ts`, test `packages/core/test/overlay-key.test.ts`; modify `packages/core/src/index.ts`.
1. Write failing test: `isSafeKeySegment` returns false for `""`, `"a/b"`, `"a\\b"`, `".."`, `"."`, `"x\0y"`; true for a sha256-hex hash and a lowercase uuid. `workspaceKeySchema.parse("../etc")` throws.
2. `pnpm --filter @megasaver/core test` → expect fail (module missing).
3. Implement `overlay-key.ts` per §4.1; export from `index.ts`.
4. `pnpm --filter @megasaver/core test` → expect pass; `pnpm --filter @megasaver/core typecheck`.
5. Commit.

### Task 2 — overlay memory schema (scope split)
**Files:** modify `packages/core/src/memory-entry.ts`, `index.ts`; test `packages/core/test/overlay-store.test.ts` (schema section).
1. Failing test: `overlayMemoryEntrySchema` accepts a `scope:"session"` row with non-null `liveSessionId` and `workspaceKey`; rejects `scope:"session"` + `liveSessionId:null`; rejects `scope:"project"` + non-null `liveSessionId`; rejects any row carrying `projectId`/`sessionId` (`.strict()`).
2. Run → fail.
3. Add `overlayMemoryEntrySchema` (+ `overlayMemoryEntryUpdatePatchSchema` mirroring the mutable-fields patch) and the re-expressed superRefine; leave `memoryEntrySchema` untouched.
4. Run → pass; typecheck.
5. Commit.

### Task 3 — overlay task-plan schema
**Files:** modify `packages/core/src/task-plan.ts`, `index.ts`; same test file.
1. Failing test: `overlayTaskPlanSchema` accepts `{workspaceKey, liveSessionId, …, steps:[…]}`, keeps the duplicate-step-id and dependsOn-resolution superRefines, rejects `projectId`.
2. Run → fail. 3. Implement. 4. Run → pass; typecheck. 5. Commit.

### Task 4 — overlay store (memory + tasks)
**Files:** create `packages/core/src/overlay-store.ts`; modify `index.ts`; extend `packages/core/test/overlay-store.test.ts`.
1. Failing tests (use a `mkdtemp` root):
   - `writeOverlayMemory(root, wk, [proj, sess])` then `readOverlayMemory(root, wk)` round-trips both; file is `memory/<wk>.jsonl`.
   - Empty set deletes the file (mirror `writeMemoryEntriesForProject`'s rm-on-empty; `readJsonLines` treats zero-byte as corrupt).
   - Two different `workspaceKey`s never read each other's rows.
   - `writeOverlayTaskPlans(root, wk, lsid, [plan])` → file `tasks/<wk>/<lsid>.jsonl`; `liveSessionId:null` plan → `tasks/<wk>/_workspace.jsonl`.
2. Run → fail.
3. Implement reusing the atomic-write + `removeIfExists` + `parseEntity` patterns from `json-directory-store.ts` (do NOT re-export those private fns — duplicate the minimal helpers or lift them to a shared module if the diff stays small; prefer duplication of <10 lines over premature abstraction per §8).
4. Run → pass; typecheck; `npx biome check packages/core/src/overlay-store.ts`.
5. Commit.

### Task 5 — stats overlay re-key
**Files:** modify `packages/stats/src/{event,summary,store,index}.ts`; test `packages/stats/test/overlay-store.test.ts`.
1. Failing tests:
   - `appendOverlayEvent({store, event})` with `overlayTokenSaverEventSchema` (keys `workspaceKey`/`liveSessionId`) writes `stats/<wk>/<lsid>.events.jsonl` and updates `stats/<wk>/<lsid>.json`.
   - `readOverlaySummary(store, wk, lsid)` returns the rolled-up totals; `readOverlayEvents` returns appended events; missing → `null`/`[]`.
   - `resetOverlayOnDisable` zeroes the summary.
2. Run → fail. 3. Implement: parameterize `summaryPath`/`eventsPath` to take plain string segments; add the four overlay fns; keep branded fns for F5. 4. Run → pass; typecheck. 5. Commit.

### Task 6 — content-store overlay path
**Files:** modify `packages/content-store/src/*` (path builder + `persistChunkSet`/`loadChunkSet`); test alongside.
1. Failing test: `persistChunkSet({storeRoot, workspaceKey, liveSessionId, chunkSetId, …})` writes `content/<wk>/<lsid>/<chunkSetId>.json`; `loadChunkSet` reads it back; missing → `ContentStoreError("not_found")`.
2. Run → fail. 3. Add an overlay-keyed overload/param; keep the project-keyed one. 4. Run → pass; typecheck. 5. Commit.

### Task 7 — context-gate pipeline re-key (HEAVIEST)
**Files:** modify `packages/context-gate/src/{run,run-command,read}.ts`; tests `packages/context-gate/test/run*.test.ts`.
1. Failing tests:
   - `runOutputPipeline({ workspaceKey, liveSessionId, cwd, path, intent, storeRoot, permissions })` filters a fixture file, persists a chunk-set under `content/<wk>/<lsid>/…`, and appends an overlay event under `stats/<wk>/<lsid>.events.jsonl`. Assert the on-disk paths.
   - Effective settings come from cwd permissions + an injected token-saver settings object — NO `CoreRegistry` involved. (Drop the `OrchestratorRegistry` session lookup from `resolveEffectiveSettings`.)
   - Fail-closed: malformed permissions → `policy_load_failed` before IO (preserve current behavior).
   - `runOutputExecCommand` re-keyed equivalently.
2. Run → `pnpm --filter @megasaver/context-gate test` → fail.
3. Implement. Concretely, the event construction in `run.ts` changes from:
   ```ts
   // before: keyed off the registry-resolved session
   const event: TokenSaverEvent = { sessionId: input.sessionId, projectId: settings.projectId, … };
   appendEvent({ store: { root: input.storeRoot }, event, … });
   ```
   to:
   ```ts
   const event: OverlayTokenSaverEvent = {
     id: newId(),
     workspaceKey: input.workspaceKey,
     liveSessionId: input.liveSessionId,
     createdAt: now(),
     sourceKind: "file",
     label: input.path,
     rawBytes: filtered.result.rawBytes,
     returnedBytes: filtered.result.returnedBytes,
     bytesSaved: filtered.result.bytesSaved,
     savingRatio: filtered.result.savingRatio,
     ...(result.chunkSetId !== undefined ? { chunkSetId: result.chunkSetId } : {}),
     summary: filtered.result.summary,
     mode: settings.mode,
   };
   appendOverlayEvent({ store: { root: input.storeRoot }, event, secretsRedacted, chunksStored });
   ```
   and `persistChunkSet(...)` takes `{ workspaceKey: input.workspaceKey, liveSessionId: input.liveSessionId }` instead of `projectId`/`sessionId`. `resolveEffectiveSettings` takes `{ cwd, permissions, mode, maxReturnedBytes, storeRawOutput }` directly (caller-resolved) rather than reading them from a registry session.
4. Run → pass; typecheck; biome. 5. Commit. (HIGH risk: request `critic` pass before merge per §12.)

### Task 8 — bridge: live memory routes
**Files:** create `apps/gui/bridge/routes/claude-session-memory.ts`; modify `handler.ts`, `route-context.ts`, `zod-schemas.ts`; test `apps/gui/test/bridge/claude-session-memory-route.test.ts`; modify `test-helpers.ts`.
1. In `test-helpers.ts`: add a helper that writes a transcript fixture (`<projectsDir>/<dir>/<id>.jsonl` with a `cwd` line) + a matching `local_*.json` so `resolveWorkspace` yields a known `(workspaceKey, cwd)`; extend `StoreSeed` with `overlayMemory`.
2. Failing tests (via `startTestBridge({ claudeProjectsDir, claudeSessionsMetaDir, store })`):
   - `POST /api/claude-sessions/<dir>/<id>/memory` with `{scope:"session", content, type}` → 201; the row persisted under `memory/<resolvedWk>.jsonl` with `liveSessionId === id`.
   - `POST` `{scope:"project"}` → 201, `liveSessionId === null`.
   - `GET …/memory?scope=session` returns only this session's rows; `?scope=project` returns the workspace cwd-scoped rows.
   - `PATCH …/memory/:entryId` updates content; `DELETE` removes it (file deleted when last row gone).
   - `GET` with a traversal `dir` (`..%2F..`) → 400 `validation_failed`; unknown `(dir,id)` → 404 `claude_session_not_found`.
3. Run → `pnpm --filter @megasaver/gui test` → fail.
4. Implement the handler + dispatcher; mount in `handler.ts` under the existing `/api/claude-sessions/:dir/:id/...` matcher (extend the regex to capture a trailing `/memory(/:entryId)?` segment). Resolve key per §4.5 resolution contract. Map errors with the existing `sendReadError`/`handleCaughtError` split.
5. Run → pass; typecheck; biome. 6. Commit.

### Task 9 — bridge: live tasks route
**Files:** create `apps/gui/bridge/routes/claude-session-tasks.ts`; modify `handler.ts`; test `apps/gui/test/bridge/claude-session-tasks-route.test.ts`.
1. Failing tests: seed `overlayTasks` for a known `(wk,lsid)`; `GET …/tasks` → `{plan, ready}[]` sorted desc, `ready` = `readySteps(plan.steps)`; traversal → 400; unknown session → 404.
2. Run → fail. 3. Implement (mirror `handleGetTasks`, swap `resolveProject` for `resolveWorkspace`). 4. Run → pass; typecheck; biome. 5. Commit.

### Task 10 — bridge: live token-saver routes (read-only)
**Files:** create `apps/gui/bridge/routes/claude-session-token-saver.ts`; modify `handler.ts`; test `apps/gui/test/bridge/claude-session-token-saver-route.test.ts`.
1. Failing tests: seed overlay stats summary + events + a chunk-set under `(wk,lsid)`; assert `GET …/token-saver/status` `{enabled,settings}`, `/stats` summary, `/events` desc list, `/events/:id/raw` blob text; `/events/:unknown/raw` → 404 `event_not_found`; traversal → 400.
2. Run → fail. 3. Implement the read-only dispatcher (subset of the existing `dispatchTokenSaver`, re-keyed; NO enable/disable). 4. Run → pass; typecheck; biome. 5. Commit.

### Task 11 — GUI client fns + types
**Files:** modify `apps/gui/src/lib/claude-sessions-client.ts`.
1. (Client fns are exercised through the panel component tests in Task 12; add direct unit tests only if a non-trivial query-string builder warrants it.) Add `OverlayMemoryEntry`/`OverlayTaskPlan`/overlay-stats types + `fetchSessionMemory/createSessionMemory/patchSessionMemory/deleteSessionMemory/fetchSessionTasks/fetchSessionTokenSaver{Status,Stats,Events}` using the existing `getJson` helper and `encodeURIComponent(dir)/encodeURIComponent(id)` (mirror `openClaudeSessionStream`).
2. `pnpm --filter @megasaver/gui typecheck`; biome.
3. Commit.

### Task 12 — cockpit panels
**Files:** create `apps/gui/src/views/cockpit/{memory-panel,tasks-panel,token-saver-panel}.tsx`; modify `claude-sessions-view.tsx`; component tests under `apps/gui/test/` (match existing GUI test convention).
1. Failing tests (React Testing Library, per existing GUI view tests): Memory panel renders the list, a create form POSTs and prepends the new row, edit PATCHes, delete removes; Tasks panel renders plans + ready badges; Token-saver panel renders stats + events and is read-only (no write controls). Use a mocked fetch returning the live-route shapes.
2. Run → fail. 3. Implement; mount the three panels in the `selected`-gated detail pane of `ClaudeSessionsView` (or F2 cockpit host if present — feature-detect via a prop). Reuse `LoadingState`/`ErrorState`. 4. Run → pass; typecheck; biome. 5. Commit.

### Task 13 — full gate + live smoke
**Files:** none (verification).
1. `pnpm verify` (lint + typecheck + all tests) green.
2. Live smoke (see §7).
3. Commit any fixups; open PR.

---

## 6. Risks & decisions (this phase)

1. **Proxy re-key is connector-core (HIGH).** `runOutputPipeline` is on the live read path; mis-keying writes savings to the wrong workspace/session. Mitigation: pure-function re-key with on-disk-path assertions in tests; `critic` adversarial pass (§12 HIGH).
2. **Two schemas in flight (F4 overlay vs legacy).** F4 adds `overlay*` schemas beside the project-keyed originals rather than mutating them, so F5 can delete the legacy tier cleanly. Risk: drift between the two. Decision: F4 keeps them side-by-side; F5 deletes legacy + migrates. No backward-compat shim is added (CLAUDE.md §13) — the legacy routes simply remain until F5.
3. **`scope:"project"` label is now misnamed** (means cwd/workspace). Decision: keep the wire value for type-compat; rename enum → `workspace` in F5 to avoid storage churn now.
4. **Token-saver settings home.** With `Session.tokenSaver` dying in F5, F4 introduces `stats/<wk>/<lsid>.settings.json` as the overlay settings source but keeps the **read-only** live route; enable/disable stays on the legacy session route through F4. Decision per §2 out-of-scope.
5. **Path safety at scale (HIGH).** Every overlay file path derives from a resolved `(workspaceKey, liveSessionId)`, but `(dir,id)` are URL-controlled. Mitigation: `safeSessionPath` gate first (400 on traversal), then `safeWorkspacePath` on every overlay access; `workspaceKey`/`liveSessionId` are server-derived, never client-supplied. Explicit traversal tests in Tasks 8–10.
6. **Resolver cost.** `resolveWorkspace` reads the transcript head per request to get cwd. Acceptable for these low-frequency overlay routes; if it shows up hot, cache `(dir,id)→workspaceKey` (deferred — not premature here).
7. **Sessions without metadata stay hidden** (locked §6.4): the resolver only succeeds for `(dir,id)` that `listSessions` surfaces; an untitled/CLI session 404s on these routes by construction. No change.
8. **Empty-set-deletes invariant** must be preserved in the overlay store (zero-byte JSONL is treated as corrupt by `readJsonLines`). Tested in Task 4.

---

## 7. Definition of done

Per CLAUDE.md §9, all of:
1. This spec in `docs/superpowers/specs/`; a plan in `docs/superpowers/plans/` (writing-plans before code).
2. Tests written first (Tasks 1–12 each red→green).
3. `pnpm verify` green: `biome check` + `tsc -b --noEmit` + `vitest run` (all packages).
4. **Feature smoke evidence (live, against real data):**
   - Start the bridge against the real `~/.claude/projects` + desktop metadata dir.
   - Pick a real live session in the cockpit; create a session-scoped memory note, edit it, delete it — confirm it persists under `~/.local/share/megasaver/memory/<workspaceKey>.jsonl` with the correct `liveSessionId`, and that no file under `~/.claude/**` was modified (capture `find ~/.claude -newer <marker>` empty).
   - Create a project/workspace-scoped note from one session, confirm it appears for a *second* session in the same cwd (cross-session re-home works).
   - With Proxy Mode running, trigger one filtered read; confirm a token-saver event lands under `stats/<workspaceKey>/<liveSessionId>.events.jsonl` and renders in the panel; confirm the `/events/:id/raw` blob serves the stored chunk-set.
   - Traversal probe: `GET /api/claude-sessions/..%2F..%2Fetc/x/memory` → 400.
5. External reviewer pass — `code-reviewer` AND `critic` (separate fresh contexts; HIGH risk requires both per §12). Author ≠ reviewer.
6. Verifier agent (`omc:verify`) evidence-based pass.
7. Zero pending TodoWrite items; changeset added for the `@megasaver/core`/`@megasaver/stats`/`@megasaver/context-gate`/`@megasaver/content-store` public-API additions.
8. No edits to `~/.claude/**` Claude data anywhere in the diff or at runtime (read-only invariant verified).
