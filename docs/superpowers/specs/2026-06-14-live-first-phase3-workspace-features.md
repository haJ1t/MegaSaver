# Live-First Phase 3: Re-point cwd/workspace features

**Date:** 2026-06-14
**Status:** Spec — pending implementation
**Risk level:** HIGH (reads real user folders at scale; new path-safety surface). Per §12, mandatory full chain + `architect` design + `critic` adversarial review + worktree.
**Parent:** [2026-06-14-live-first-architecture.md](./2026-06-14-live-first-architecture.md) (§3.4, §3.5, §4, Phase 3)

---

## 1. Goal & Depends on

**Goal.** Re-home the five cwd-scoped features (index, context preview, permissions/policy, tools router, rules ranking) so they operate on a **live session's cwd** plus a **cwd-keyed overlay store** (`workspaceKey`), exposed through new `/api/workspaces/:key/{index,context,rules,tools,permissions}` bridge routes and rendered as cockpit panels — never touching the project model.

**Depends on:**
- **Phase 0** (telemetry surfacing) — landed; established the live read-only conventions (`sendReadError`, `safeSessionPath`, test-helper injection of `claudeProjectsDir`/`claudeSessionsMetaDir`).
- **Phase 1** (workspace grouping) — **required**: Phase 3 consumes the `cwd → workspaceKey` derivation. If Phase 1's `workspaceKey` encoder does not yet exist when Phase 3 starts, Task 1 below creates it (it is specced here defensively so Phase 3 is self-contained).
- **Phase 2** (cockpit shell) — **required for the GUI panels only** (Tasks 12–14). The bridge + overlay-store work (Tasks 1–11) does **not** depend on Phase 2 and can land first.

The project model (F5) is **not** a dependency and must remain untouched: Phase 3 adds a parallel workspace-keyed surface; the existing `/api/projects/:id/*` routes keep working through migration.

---

## 2. Scope

### In scope
- A **`workspaceKey` encoder** (`sha256(cwd)` short hash + human label) and a shared schema for it.
- A **workspace resolver** on `RouteContext`: `cwd → { workspaceKey, label, cwd }` + overlay-store path helpers, plus a **cwd resolver** that maps a live session (`dir`/`id`) to its transcript `cwd` (reusing `firstCwd`/metadata).
- **Overlay store re-key** for the five features:
  - `index/<workspaceKey>/{blocks.jsonl,manifest.json}` (was `projects/<projectId>/index/…`)
  - `rules/<workspaceKey>.jsonl` (was registry `project-rules/<projectId>.jsonl`)
  - `tools/<workspaceKey>.jsonl` (was registry `tool-definitions/<projectId>.jsonl`)
  - new path resolvers + workspace-keyed JSONL readers; **pure** ranking/routing functions reused unchanged.
- **Permissions/policy** re-pointed to `<cwd>/.megasaver/permissions.yaml` via the existing `loadProjectPermissions(cwd)` + `evaluateCommand`/`evaluatePathRead`.
- **Context preview** over the cwd index blocks (`buildContextPack` + `auditPack`), with task-relevant memory deferred (see out-of-scope).
- **New bridge routes** `/api/workspaces/:key/{index,index/search,context,rules,tools,permissions}` (all GET, read-only) + a `dispatchWorkspaceScoped` dispatcher mirroring `dispatchProjectScoped`.
- **Path-safety extension**: a `safeWorkspacePath`/`safeCwdAccess` guard sandboxing every new file read to the resolved cwd or the resolved `<storeRoot>/<feature>/<workspaceKey>` overlay dir.
- **Cockpit panels** (under the selected session's folder context): Index, Context, Rules, Tools, Permissions — read-only previews fed by a new `workspaces-client.ts`.
- Tests at every layer (overlay-store unit, bridge route, view smoke) and a live smoke against real `~/.claude/projects` data.

### Out of scope (deferred)
- **Index build/write triggered from the GUI.** Phase 3 ships index **read** (status + search) and **context preview**. A "build index" mutation route + job model is deferred (the architecture doc keeps index build compute-bounded and out of the live read path). Tests may pre-seed an index on disk to exercise the read routes; the build path stays CLI-only for now.
- **Rules/tools/permissions mutation** (create/edit/delete). Phase 3 is read-only previews, matching the current `/api/projects/:id/{rules,tools}` GET-only surface.
- **Memory-fed context.** The current `/api/projects/:id/context` mixes in `registry.searchMemoryEntries(projectId, …)`. Memory re-home is **Phase 4** (session+cwd overlay). Phase 3's context route builds the pack from index blocks + `changedFile`/`failingTest` query params only; `memoryFiles`/`staleFiles` are passed empty until Phase 4 wires the cwd-scoped memory overlay.
- **Migration** of existing `projects/<projectId>/index` and registry rule/tool JSONL into `<workspaceKey>` layout — that is Phase 5's one-time migration. Phase 3 writes/reads the new layout for **new** workspaces only.
- **Removing** `/api/projects/*`, `resolveProject`, `requireProject`, or the registry — all Phase 5.
- **Entity-schema swap** `projectId → workspaceKey` across `codeBlockSchema`/`projectRuleSchema`/`toolDefinitionSchema` — Phase 5. Phase 3 keeps entity **bodies** project-shaped and carries `workspaceKey` only in the **path** (see §6 R1).

---

## 3. File-level changes

| Action | Path | Responsibility |
|---|---|---|
| **create** | `packages/shared/src/workspace-key.ts` | `workspaceKeySchema` (fs-safe string), `encodeWorkspaceKey(cwd): string` (`sha256(cwd)` → first 16 hex chars), `workspaceLabel(cwd): string` (human cwd basename/path). Exported via `shared` index. |
| **modify** | `packages/shared/src/index.ts` | Re-export `workspace-key.js` public surface. |
| **create** | `packages/indexer/src/workspace-store.ts` | `resolveWorkspaceIndexPaths(storeDir, workspaceKey): IndexStorePaths` → `<storeDir>/index/<workspaceKey>/{blocks.jsonl,manifest.json}`. Thin sibling of `resolveIndexPaths`; reuses `readBlocks`/`readManifest`/`writeIndex`. |
| **modify** | `packages/indexer/src/index.ts` | Export `workspace-store.js`. |
| **modify** | `packages/indexer/src/build.ts` | Add `buildWorkspaceIndex({ rootDir, storeDir, workspaceKey, … })` overload that resolves via `resolveWorkspaceIndexPaths` (CLI/seed only; not wired to a route in P3). Blocks keep a synthetic stable `projectId` derived from the workspaceKey UUIDv5 (see §6 R1). |
| **create** | `packages/core/src/workspace-overlay-store.ts` | Workspace-keyed JSONL readers: `readWorkspaceRules(storeRoot, workspaceKey): ProjectRule[]` ← `<storeRoot>/rules/<workspaceKey>.jsonl`; `readWorkspaceTools(storeRoot, workspaceKey): ToolDefinition[]` ← `<storeRoot>/tools/<workspaceKey>.jsonl`. Reuses the existing JSONL parse + zod schemas. No registry, no `requireProject`. |
| **modify** | `packages/core/src/index.ts` | Export `workspace-overlay-store.js`. |
| **create** | `apps/gui/bridge/workspace-resolver.ts` | `resolveWorkspace(cwd): { workspaceKey, label, cwd }`; `safeWorkspaceOverlayDir(storeRoot, feature, workspaceKey)` + `assertCwdInside(cwd, target)` path-safety guards (defence-in-depth, mirrors `safeSessionPath`). |
| **modify** | `apps/gui/bridge/route-context.ts` | Add `resolveWorkspace` (the resolver above) + keep `storeRoot`, `claudeProjectsDir`, `claudeSessionsMetaDir`. No registry change (registry stays for project routes). |
| **modify** | `apps/gui/bridge/handler.ts` | Inject `resolveWorkspace`; route `/api/workspaces/:key/…` to `dispatchWorkspaceScoped`. |
| **create** | `apps/gui/bridge/routes/_workspace.ts` | `resolveWorkspaceKey(ctx, keyRaw)`: validates `keyRaw` against `workspaceKeySchema`, sends `400 validation_failed` on bad shape; returns the validated key (no existence check — a missing overlay reads as empty, mirroring `index status indexed:false`). |
| **create** | `apps/gui/bridge/routes/workspace-scoped.ts` | `dispatchWorkspaceScoped(ctx, method, path, onMethodNotAllowed)`: regex `^/api/workspaces/([^/]+)/(index|context|rules|tools|permissions)(?:/(search))?$`; GET-only; delegates to the handlers below. Mirrors `dispatchProjectScoped`. |
| **create** | `apps/gui/bridge/routes/workspace-index.ts` | `handleGetWorkspaceIndexStatus` + `handleGetWorkspaceIndexSearch` (port of `index-routes.ts`, paths via `resolveWorkspaceIndexPaths`). |
| **create** | `apps/gui/bridge/routes/workspace-context.ts` | `handleGetWorkspaceContext` (port of `context.ts`; `memoryFiles`/`staleFiles` empty — Phase 4). |
| **create** | `apps/gui/bridge/routes/workspace-rules.ts` | `handleGetWorkspaceRules`: `readWorkspaceRules` → pure `rankApplicableRules`. |
| **create** | `apps/gui/bridge/routes/workspace-tools.ts` | `handleGetWorkspaceTools`: `readWorkspaceTools` → pure `routeToolsForTask` + tool list. |
| **create** | `apps/gui/bridge/routes/workspace-permissions.ts` | `handleGetWorkspacePermissions`: resolve cwd, `loadProjectPermissions(cwd)`, optional `command`/`path` query → `evaluateCommand`/`evaluatePathRead` preview. |
| **create** | `apps/gui/src/lib/workspaces-client.ts` | Client for the five GET routes (mirrors `claude-sessions-client.ts` `getJson`). |
| **create** | `apps/gui/src/views/cockpit/workspace-index-panel.tsx` | Index status + search panel. |
| **create** | `apps/gui/src/views/cockpit/workspace-context-panel.tsx` | Context-pack preview + audit panel. |
| **create** | `apps/gui/src/views/cockpit/workspace-rules-panel.tsx` | Ranked rules panel. |
| **create** | `apps/gui/src/views/cockpit/workspace-tools-panel.tsx` | Tool-router preview panel. |
| **create** | `apps/gui/src/views/cockpit/workspace-permissions-panel.tsx` | Permissions evaluation panel. |
| **modify** | `apps/gui/src/views/claude-sessions-view.tsx` (or the Phase 2 cockpit shell) | Mount the five panels under the selected session's folder context, passing its resolved `workspaceKey`. |
| **create** | `packages/shared/test/workspace-key.test.ts` | Encoder/schema unit tests. |
| **create** | `packages/indexer/test/workspace-store.test.ts` | `resolveWorkspaceIndexPaths` + read round-trip. |
| **create** | `packages/core/test/workspace-overlay-store.test.ts` | Workspace-keyed rule/tool JSONL read tests. |
| **create** | `apps/gui/test/bridge/workspace-routes.test.ts` | Bridge route tests for all five segments (port of `contextops-routes.test.ts`). |
| **create** | `apps/gui/test/bridge/workspace-resolver.test.ts` | Path-safety unit tests (traversal, cwd escape, overlay-dir containment). |
| **modify** | `apps/gui/test/bridge/test-helpers.ts` | Extend `StoreSeed` with `workspaceRules`/`workspaceTools`/`workspaceIndex` seeders writing the `<workspaceKey>` layout; add a `seedWorkspaceCwd` helper that writes a fake transcript + metadata so a `dir/id` resolves to a chosen cwd. |
| **create** | `apps/gui/test/views/workspace-panels.test.tsx` | View smoke for the five panels (loading/ready/error). |

---

## 4. Data model & API changes

### 4.1 New shared types

```ts
// packages/shared/src/workspace-key.ts
import { createHash } from "node:crypto";
import { z } from "zod";

// fs-safe, lowercase hex, fixed length — NOT a UUID. Distinct from projectIdSchema
// (lowercase-UUID brand) so the two key spaces never alias. 16 hex chars = 64 bits
// of sha256, collision-safe for a per-user workspace count.
export const workspaceKeySchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, "workspaceKey must be 16 lowercase hex chars")
  .brand<"WorkspaceKey">();
export type WorkspaceKey = z.infer<typeof workspaceKeySchema>;

export function encodeWorkspaceKey(cwd: string): WorkspaceKey {
  const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
  return workspaceKeySchema.parse(hash);
}

export function workspaceLabel(cwd: string): string {
  return cwd; // human label kept verbatim; UI may basename it
}
```

### 4.2 Workspace resolver (bridge)

```ts
// apps/gui/bridge/workspace-resolver.ts
export type ResolvedWorkspace = { workspaceKey: WorkspaceKey; label: string; cwd: string };
export function resolveWorkspace(cwd: string): ResolvedWorkspace;

// Path-safety: the overlay dir for <feature> must stay inside <storeRoot>/<feature>.
export function safeWorkspaceOverlayDir(
  storeRoot: string,
  feature: "index" | "rules" | "tools",
  key: WorkspaceKey,
): string | null;

// Defence-in-depth for any read under the real cwd (permissions.yaml): the
// resolved target must remain inside the realpath of cwd. Mirrors safeSessionPath.
export function assertCwdContains(cwd: string, target: string): Promise<boolean>;
```

`RouteContext` gains `resolveWorkspace: typeof resolveWorkspace` (pure fn injected once in `handler.ts`, overridable in tests).

### 4.3 New endpoints (all `GET`, read-only)

| Method + Path | Query | Response (200) |
|---|---|---|
| `GET /api/workspaces/:key/index` | — | `IndexStatusResponse` = `{ indexed: boolean; total: number; indexedFiles: number; byType: Record<string,number> }` (existing type, reused). Missing index → `indexed:false`; corrupt → `500 index_unavailable`. |
| `GET /api/workspaces/:key/index/search` | `q`/`query` (req), `type`, `limit`, `offset` | `BlockSearchHit[]` (existing). Missing `q` → `400 validation_failed`. |
| `GET /api/workspaces/:key/context` | `task` (req), `limit`, `maxTokens`, `changedFile[]`, `failingTest[]` | `{ indexed: boolean; pack: ContextPack; audit: PackAudit }`. Missing `task` → `400`; corrupt index → `500 index_unavailable`. |
| `GET /api/workspaces/:key/rules` | `task`, `files[]` | `RankedRule[]` (existing). Empty overlay → `[]`. |
| `GET /api/workspaces/:key/tools` | `task` | `{ route: ToolRouteResult; tools: ToolDefinition[] }` (existing). Empty overlay → `{ route, tools: [] }`. |
| `GET /api/workspaces/:key/permissions` | `command`, `path` (both optional) | `{ loaded: boolean; evaluation?: { command?: EvaluateCommandResult; pathRead?: EvaluatePathReadResult } }`. The `:key` route resolves the cwd from the workspace registry/derived cache; absent `.megasaver/permissions.yaml` → `loaded:false`; malformed file → `500 policy_load_failed`. |

Bad `:key` shape (not 16 hex) → `400 validation_failed`. Non-GET on any segment → `405 method_not_allowed`. Unmatched → existing `404 route_not_found`.

> **cwd resolution for the `:key` routes.** `index`/`context`/`rules`/`tools` need only the **overlay store** (keyed directly by `:key`). `permissions` additionally needs the **real cwd** (to read `<cwd>/.megasaver/permissions.yaml`). Phase 1's `/api/workspaces` derives and caches `workspaceKey → cwd` (the `workspaces.json` cache, architecture §3.4). Phase 3's permissions handler reads that cache; if Phase 1's cache is not yet available, the handler accepts an explicit `?cwd=` only in tests and returns `loaded:false` otherwise. **Decision (locked in §6 R4):** resolve cwd from the derived `workspaces.json` cache, never from the URL in production.

### 4.4 Overlay store paths/schemas

```
~/.local/share/megasaver/
  index/<workspaceKey>/blocks.jsonl     # CodeBlock[] (existing codeBlockSchema; projectId = UUIDv5(workspaceKey))
  index/<workspaceKey>/manifest.json    # Manifest (existing)
  rules/<workspaceKey>.jsonl            # ProjectRule[] (existing projectRuleSchema)
  tools/<workspaceKey>.jsonl            # ToolDefinition[] (existing toolDefinitionSchema)
```

- Entity **bodies** are unchanged (still carry a `projectId`). The `workspaceKey` is the **path** key only — no schema migration in Phase 3 (see §6 R1).
- The existing `resolveStorePaths`/registry layout (`projects/`, `project-rules/`, `tool-definitions/`) is **untouched**; the new `index/`, `rules/`, `tools/` top-level dirs live alongside it. (Note: the existing indexer writes under `projects/<id>/index`; the new workspace index uses top-level `index/<key>` — no collision.)

---

## 5. Implementation tasks (TDD)

Conventions for every task: write the failing test first, run the **narrowest** command, watch it fail for the **stated** reason, write the minimal impl, re-run green, then `npx biome check <touched files>` and commit. Commands:
- Package unit: `pnpm --filter @megasaver/<pkg> test -- <file>`
- GUI (bridge + views): `pnpm --filter @megasaver/gui test -- <file>`
- Typecheck (DoD gate, run before each commit on touched packages): `pnpm --filter @megasaver/<pkg> typecheck`
- Lint/format: `npx biome check <paths>` (or `pnpm lint`).
- Full gate before "done": `pnpm verify`.

---

### Task 1 — `workspaceKey` encoder + schema
**Files:** create `packages/shared/src/workspace-key.ts`, `packages/shared/test/workspace-key.test.ts`; modify `packages/shared/src/index.ts`.
1. Write `workspace-key.test.ts`: (a) `encodeWorkspaceKey("/Users/x/proj")` returns a 16-char lowercase-hex string; (b) same cwd → same key (stable); (c) different cwd → different key; (d) `workspaceKeySchema.safeParse("ABC")` fails, `safeParse(<valid key>)` succeeds; (e) a cwd with spaces/unicode (`/Users/x/é dir`) still produces a valid key.
2. Run `pnpm --filter @megasaver/shared test -- workspace-key` → expect fail (module missing).
3. Implement `workspace-key.ts` per §4.1; re-export from `index.ts`.
4. Re-run → green. `npx biome check packages/shared/src/workspace-key.ts packages/shared/test/workspace-key.test.ts`. `pnpm --filter @megasaver/shared typecheck`.
5. Commit `feat(shared): add workspaceKey encoder for live-first phase 3`.

### Task 2 — workspace index path resolver
**Files:** create `packages/indexer/src/workspace-store.ts`, `packages/indexer/test/workspace-store.test.ts`; modify `packages/indexer/src/index.ts`.
1. Test: `resolveWorkspaceIndexPaths("/store", key)` returns `{ indexDir: "/store/index/<key>", blocksPath: ".../blocks.jsonl", manifestPath: ".../manifest.json" }`; a `writeIndex` then `readBlocks` round-trips through those paths.
2. Run → fail (fn missing).
3. Implement: thin wrapper reusing `IndexStorePaths`/`readBlocks`/`writeIndex`:
   ```ts
   export function resolveWorkspaceIndexPaths(storeDir: string, key: WorkspaceKey): IndexStorePaths {
     const indexDir = join(storeDir, "index", key);
     return { indexDir, blocksPath: join(indexDir, "blocks.jsonl"), manifestPath: join(indexDir, "manifest.json") };
   }
   ```
4. Green; biome; typecheck. Commit `feat(indexer): workspace-keyed index path resolver`.

### Task 3 — `buildWorkspaceIndex` (seed/CLI path; non-routed)
**Files:** modify `packages/indexer/src/build.ts`; extend `packages/indexer/test/workspace-store.test.ts`.
1. Test: `buildWorkspaceIndex({ rootDir: <tmp repo>, storeDir, workspaceKey: key })` writes `index/<key>/blocks.jsonl`, and `readBlocks(resolveWorkspaceIndexPaths(storeDir,key))` returns the extracted blocks. Each block's `projectId` equals `workspaceProjectId(key)` (the UUIDv5 derived from the key — §6 R1) so `codeBlockSchema.parse` passes.
2. Run → fail.
3. Implement `buildWorkspaceIndex` by delegating to the existing build core with `paths = resolveWorkspaceIndexPaths(...)` and `projectId = workspaceProjectId(key)`. Add `workspaceProjectId(key): ProjectId` (UUIDv5 over the key, lowercased) in `shared` (or `workspace-store.ts`). Keep `buildIndex` unchanged.
4. Green; biome; typecheck. Commit `feat(indexer): build workspace-keyed index`.

### Task 4 — workspace overlay-store readers (rules + tools)
**Files:** create `packages/core/src/workspace-overlay-store.ts`, `packages/core/test/workspace-overlay-store.test.ts`; modify `packages/core/src/index.ts`.
1. Test: write `rules/<key>.jsonl` (one `projectRuleSchema`-valid line) + `tools/<key>.jsonl` (one `toolDefinitionSchema`-valid line) under a tmp store; assert `readWorkspaceRules(store,key)` / `readWorkspaceTools(store,key)` return the parsed entities; assert a **missing** file returns `[]` (ENOENT → empty, mirroring `readJsonLines`); assert a **malformed** line throws `CorePersistenceError`.
2. Run → fail.
3. Implement using the same JSONL read + zod parse as `json-directory-store.ts` (extract or reuse the `readJsonLines`/`parseEntity` helpers — do **not** duplicate the atomic-write machinery; these are read-only).
   ```ts
   export function readWorkspaceRules(storeRoot: string, key: WorkspaceKey): ProjectRule[] {
     return readJsonLines(join(storeRoot, "rules", `${key}.jsonl`))
       .map((e) => projectRuleSchema.parse(e));
   }
   ```
4. Green; biome; typecheck. Commit `feat(core): workspace-keyed overlay readers for rules/tools`.

### Task 5 — workspace resolver + path-safety guards
**Files:** create `apps/gui/bridge/workspace-resolver.ts`, `apps/gui/test/bridge/workspace-resolver.test.ts`.
1. Test (pure, no server): `resolveWorkspace("/Users/x/p")` → `{ workspaceKey: encodeWorkspaceKey(cwd), label, cwd }`. `safeWorkspaceOverlayDir(store,"rules",key)` returns a path inside `store/rules`; an injected bad key (`"../etc"`) → `null` (covered also by schema, defence-in-depth). `assertCwdContains(cwd, "<cwd>/.megasaver/permissions.yaml")` → true; `assertCwdContains(cwd, "/etc/passwd")` → false; a `../` traversal target → false.
2. Run → fail.
3. Implement, mirroring `safeSessionPath`'s lexical-then-realpath check.
4. Green; biome; `pnpm --filter @megasaver/gui typecheck`. Commit `feat(gui): workspace resolver + cwd path-safety guards`.

### Task 6 — `RouteContext` + handler wiring + dispatcher skeleton
**Files:** modify `apps/gui/bridge/route-context.ts`, `apps/gui/bridge/handler.ts`; create `apps/gui/bridge/routes/_workspace.ts`, `apps/gui/bridge/routes/workspace-scoped.ts`; create `apps/gui/test/bridge/workspace-routes.test.ts` (first cases only).
1. Test (first slice): `GET /api/workspaces/<badkey>/rules` → `400 validation_failed`; `POST /api/workspaces/<validkey>/rules` → `405`; `GET /api/workspaces/<validkey>/rules` with an empty store → `200 []`.
2. Run → fail (`404 route_not_found`, dispatcher missing).
3. Implement: add `resolveWorkspace` to `RouteContext` + inject in `handler.ts`; add the `path.startsWith("/api/workspaces/")` branch calling `dispatchWorkspaceScoped`; implement `_workspace.ts` (`resolveWorkspaceKey`) + `workspace-scoped.ts` (regex dispatch, GET-only) wiring the rules handler from Task 8 last — for this task, stub the other segments to `404` so the slice passes; fill them in Tasks 7–10.
4. Green; biome; typecheck. Commit `feat(gui): workspace-scoped route dispatcher + validation`.

### Task 7 — index status + search routes
**Files:** create `apps/gui/bridge/routes/workspace-index.ts`; extend `workspace-routes.test.ts`; extend `test-helpers.ts` (`workspaceIndex` seeder).
1. Test: with **no** index seeded, `GET /api/workspaces/<key>/index` → `200 { indexed:false }`. With a seeded `index/<key>/blocks.jsonl` (2 blocks, types `function`,`docs`), `GET …/index` → `byType:{function:1,docs:1}`, `indexed:true`. `GET …/index/search?q=foo` over the seeded blocks → array; `…/index/search` with no `q` → `400`.
2. Run → fail.
3. Implement by porting `index-routes.ts`, swapping `resolveIndexPaths(storeRoot, project.id)` → `resolveWorkspaceIndexPaths(storeRoot, key)`. Wire into `workspace-scoped.ts`.
4. Green; biome; typecheck. Commit `feat(gui): workspace index status + search routes`.

### Task 8 — rules route
**Files:** create `apps/gui/bridge/routes/workspace-rules.ts`; extend `workspace-routes.test.ts`, `test-helpers.ts` (`workspaceRules` seeder).
1. Test: seed `rules/<key>.jsonl` with a rule titled "no any" (rule text "avoid any type"); `GET …/rules?task=avoid%20any%20type` → `body[0].rule.title === "no any"`. Empty store → `[]`.
2. Run → fail.
3. Implement: `readWorkspaceRules(storeRoot, key)` → `rankApplicableRules(rules, { task?, files })` (pure, from `@megasaver/core`). Wire into dispatcher (replace the Task 6 stub).
4. Green; biome; typecheck. Commit `feat(gui): workspace rules ranking route`.

### Task 9 — tools route
**Files:** create `apps/gui/bridge/routes/workspace-tools.ts`; extend `workspace-routes.test.ts`, `test-helpers.ts` (`workspaceTools` seeder).
1. Test: seed `tools/<key>.jsonl` with a `git status` tool (category `git`, risk `safe`); `GET …/tools` → `tools.length===1`, `typeof route.reason === "string"`; a `dangerous` tool ends up in `route.blockedTools`.
2. Run → fail.
3. Implement: `readWorkspaceTools(storeRoot, key)` → `routeToolsForTask(tools, task)` + return `{ route, tools }`. Wire into dispatcher.
4. Green; biome; typecheck. Commit `feat(gui): workspace tools router route`.

### Task 10 — context preview route
**Files:** create `apps/gui/bridge/routes/workspace-context.ts`; extend `workspace-routes.test.ts`.
1. Test: with no index, `GET …/context?task=anything` → `200 { indexed:false }`; no `task` → `400`. With a seeded index, the response `pack`/`audit` are present and `indexed:true`.
2. Run → fail.
3. Implement by porting `context.ts`: `readBlocks(resolveWorkspaceIndexPaths(storeRoot,key))`, then `buildContextPack({ task, blocks, changedFiles, failingTests, memoryFiles:[], staleFiles:[], … })` + `auditPack`. **No** `registry.searchMemoryEntries` call (Phase 4). Wire into dispatcher.
4. Green; biome; typecheck. Commit `feat(gui): workspace context-pack preview route`.

### Task 11 — permissions route
**Files:** create `apps/gui/bridge/routes/workspace-permissions.ts`; extend `workspace-routes.test.ts`, `test-helpers.ts` (`seedWorkspaceCwd` writing `<cwd>/.megasaver/permissions.yaml` + the `workspaces.json` cache entry).
1. Test: (a) cwd with **no** `.megasaver/permissions.yaml` → `200 { loaded:false }`; (b) cwd with a valid `deny: { commands: ["curl"] }` file + `?command=curl` → `evaluation.command.allowed === false`; (c) `?path=.env` → `pathRead.allowed === false`; (d) a malformed YAML file → `500 policy_load_failed`.
2. Run → fail.
3. Implement: resolve cwd from the derived `workspaces.json` cache via `ctx.resolveWorkspace`/cache lookup (§4.3 note); guard with `assertCwdContains`; `loadProjectPermissions(cwd)`; if `command`/`path` present, run `evaluateCommand`/`evaluatePathRead` with the loaded permissions; map `PolicyLoadError` → `500 policy_load_failed`. Wire into dispatcher.
4. Green; biome; typecheck. Commit `feat(gui): workspace permissions evaluation route`.

### Task 12 — workspaces client
**Files:** create `apps/gui/src/lib/workspaces-client.ts`; (client tested indirectly by panel tests in Task 13).
1. Implement `fetchWorkspaceIndex/Search/Context/Rules/Tools/Permissions(key, …)` reusing the `getJson` pattern from `claude-sessions-client.ts` (typed responses from §4.3).
2. `npx biome check`; `pnpm --filter @megasaver/gui typecheck`. Commit `feat(gui): workspaces api client`.

### Task 13 — cockpit panels
**Files:** create the five `apps/gui/src/views/cockpit/workspace-*-panel.tsx`; create `apps/gui/test/views/workspace-panels.test.tsx`.
1. Test (per panel, mocking the client): loading → `LoadingState`; success → renders key fields (e.g. index `byType`, rules `rule.title`, tools `route.reason`, permissions `loaded`); error → `ErrorState`. Mirror the existing view tests' structure.
2. Run → fail.
3. Implement panels following `claude-sessions-view.tsx` conventions (`LoadingState`/`ErrorState`/`useEffect` fetch). Each takes a `workspaceKey: string` prop.
4. Green; biome; typecheck. Commit `feat(gui): workspace cockpit panels (index/context/rules/tools/permissions)`.

### Task 14 — mount panels in the cockpit
**Files:** modify the Phase 2 cockpit shell (or `claude-sessions-view.tsx` if cockpit not yet present) + its test.
1. Test: selecting a session resolves a `workspaceKey` (via `encodeWorkspaceKey` on the session's `projectLabel`/cwd) and renders the five panels under a "Workspace" tab/section.
2. Run → fail.
3. Implement: compute `workspaceKey` from the selected session's cwd; pass to the panels. **Do not** touch `activeProjectId`, `PROJECT_SCOPED_VIEWS`, or the legacy project views.
4. Green; biome; typecheck. Commit `feat(gui): mount workspace panels in session cockpit`.

### Task 15 — full gate + live smoke
**Files:** none (verification).
1. `pnpm verify` (lint + typecheck + all tests) → green.
2. Live smoke (HIGH-risk evidence): start the bridge against real `~/.claude/projects`, pick a session, hit `GET /api/workspaces/<key>/{index,rules,tools,permissions,context?task=…}` for that session's cwd, capture the JSON responses + confirm no write occurred under any cwd and no read escaped the resolved cwd/overlay dir. Capture the terminal session.
3. `code-reviewer` **and** `critic` passes (HIGH risk). Commit nothing new; record evidence in the PR.

---

## 6. Risks & decisions

- **R1 — `workspaceKey` vs `projectId` schema clash (the central decision).** `codeBlockSchema`/`projectRuleSchema`/`toolDefinitionSchema` all require a branded **lowercase-UUID** `projectId`; a sha256 `workspaceKey` would fail that parse, and `buildIndex` parses every block at write time. **Decision (locked):** Phase 3 keeps `workspaceKey` in the **path** only and keeps entity bodies project-shaped, deriving a **stable synthetic `projectId = UUIDv5(namespace, workspaceKey)`** for index blocks so `codeBlockSchema.parse` passes without a schema change. The full `projectId → workspaceKey` field swap is deferred to Phase 5's migration. This avoids touching three schemas + the registry mid-pivot. **Reviewer must confirm** the UUIDv5 derivation is deterministic and never collides with a real `projectId` (UUIDv5 vs UUIDv4 version nibble guarantees disjoint spaces).
- **R2 — Path-safety on real folders (HIGH).** Permissions reads `<cwd>/.megasaver/permissions.yaml` from a real, user-controlled cwd; index/context read overlay files keyed by URL `:key`. **Mitigation:** `:key` is schema-validated to 16 hex chars (no traversal possible); `safeWorkspaceOverlayDir` re-checks containment; `assertCwdContains` (lexical + realpath, mirroring `safeSessionPath`) gates every cwd read. No write paths in Phase 3 → blast radius is read-only.
- **R3 — Read-only on Claude data preserved.** Phase 3 reads Claude transcripts/metadata only to resolve cwd; all writes (none in P3) target MegaSaver's overlay store. The live smoke (Task 15) asserts zero writes under any cwd.
- **R4 — cwd resolution source for `permissions`.** Resolving cwd from the URL would let a caller point permissions reads at an arbitrary folder. **Decision (locked):** production resolves cwd only from the derived `workspaces.json` cache (Phase 1); `?cwd=` is honored **only in tests**. If Phase 1's cache is unavailable at integration time, the permissions handler returns `loaded:false` rather than reading an unverified path.
- **R5 — Memory-fed context dropped in P3.** The current context route mixes memory; Phase 3 ships index-only context (memory is Phase 4). Risk: the preview is weaker until P4. Accepted — the architecture sequences memory re-home after the cwd features.
- **R6 — Two index layouts coexist.** The registry indexer writes `projects/<id>/index`; the workspace indexer writes `index/<key>`. No path overlap, but two readers exist until Phase 5 deletes the project one. Accepted (incremental-by-design, architecture §5).
- **R7 — Build path stays CLI/seed-only.** No GUI-triggered index build in P3; route tests pre-seed. Risk: a workspace with no index shows an empty/CTA state with no in-app way to build. Accepted; build route is a follow-up.

---

## 7. Definition of done

Per `docs/conventions/definition-of-done.md`, **all** must hold:
1. This spec + a `docs/superpowers/plans/2026-06-14-live-first-phase3-workspace-features-plan.md` exist.
2. TDD followed (failing test first) for every task.
3. `pnpm verify` green: `biome check` (lint+format), `tsc --noEmit` (project refs), `vitest run` (all tests).
4. **Feature smoke evidence (HIGH risk):** captured terminal session of the live smoke (Task 15) hitting all five `/api/workspaces/:key/*` routes against **real** `~/.claude/projects` data, showing correct JSON and **zero** writes under any cwd + no read outside the resolved cwd/overlay dir.
5. **Reviewer passes:** `code-reviewer` **and** `critic` (separate fresh contexts), per HIGH-risk rule — with explicit sign-off on R1 (UUIDv5 derivation) and R2/R4 (path-safety + cwd source).
6. Verifier (`omc:verify`) evidence-based pass.
7. Zero pending TodoWrite items; changeset added for the new public surfaces in `@megasaver/shared`, `@megasaver/indexer`, `@megasaver/core`.
8. No edits to `/api/projects/*`, `resolveProject`, the registry, or `activeProjectId`/`PROJECT_SCOPED_VIEWS` (those are Phase 5); `CLAUDE.md`/conventions untouched (no convention change).
