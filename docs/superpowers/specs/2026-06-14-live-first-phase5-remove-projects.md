# Live-First Phase 5: Remove projects from the GUI + bridge (narrowed scope)

**Date:** 2026-06-14
**Status:** Spec — pending implementation (re-scoped after blocker)
**Risk:** MEDIUM — deletion-only within `apps/gui`. Core/CLI/mcp-bridge untouched.

## Scope correction (IMPORTANT — read first)

The original F5 tried to remove the project model from **`@megasaver/core`**, but the
`mega` CLI (~30 files) and `packages/mcp-bridge` (~5 files) still depend on Core's
project/session methods. Per the maintainer's decision, **Core is OUT OF SCOPE**: the
project entity, store tiers, `requireProject`, `projectId`, and `projects.json`/
`sessions.json` **stay exactly as they are** for the CLI + mcp-bridge.

The earlier core re-key attempts (commits `c5289ae`, `bf7ca71`) were **reverted**
(`bc6720f`, `c7aae2c`) — Core is already back to its F4 state and typechecks green.
**Do NOT touch `packages/core`, `packages/shared` ids, the CLI, or mcp-bridge.** Ignore
those four commits when reasoning about progress; this is a fresh GUI+bridge-only task.

## Goal

Make the **GUI app** (`apps/gui`) fully project-free: the live session cockpit (F2) is
the only shell; delete the project picker/create UI, the legacy project-scoped views, the
project endpoints in the api client, and the legacy project/session/memory bridge routes.
Keep everything live (F0–F4) and keep `agent-setup`. Core is untouched.

## Keep vs delete

### Bridge routes — KEEP (live)
`health.ts`, `mcp-setup.ts`, `claude-sessions.ts`, `_claude-session.ts`,
`claude-session-memory.ts`, `claude-session-tasks.ts`, `claude-session-token-saver.ts`,
`workspaces.ts`, `workspace-scoped.ts`, `workspace-{context,index,permissions,rules,tools}.ts`,
`_workspace.ts`, `_body.ts`, `_query.ts`.

### Bridge routes — DELETE (legacy project)
`projects.ts`, `project-scoped.ts`, `_project.ts`, `audit.ts`, `rules.ts`, `context.ts`,
`index-routes.ts`, `tasks.ts`, `tools.ts`, `sessions.ts`, `memory.ts`, `retention.ts`,
`token-saver.ts` (the legacy `/api/sessions/:id/token-saver`; the live
`/api/claude-sessions/:dir/:id/token-saver` stays).

### handler.ts dispatch — REMOVE blocks
`/api/projects`, `/api/projects/`, `/api/sessions`, `/api/sessions/:id(/end)`,
`/api/sessions/.../token-saver` (legacy), `/api/sessions/.../retention`, `/api/memory`,
`/api/memory/:id`. KEEP: `/api/health`, `/api/mcp/`, `/api/claude-sessions*`,
`/api/workspaces*`, `/api/claude-sessions/.../token-saver` (live).

### RouteContext / server.ts — drop unused `registry`
After deleting the legacy routes, the bridge's `registry: CoreRegistry` is unused (kept
routes use `claudeProjectsDir`/`claudeSessionsMetaDir`/overlay store/`mcpOps`). Remove
`registry` from `RouteContext`, `BridgeHandlerOptions`, `createBridgeHandler`, and
`apps/gui/bridge/server.ts` (stop constructing the Core registry/store for the bridge).
Keep `mcpOps`, `storeRoot` (the overlay store root used by F3/F4). **Verify by compiler**:
if anything kept still needs `registry`, leave it; otherwise remove. Do NOT change Core.

### GUI views — DELETE (legacy project)
`overview-view.tsx`, `sessions-view.tsx`, `sessions-detail.tsx`, `sessions-list.tsx`,
`memory-view.tsx`, `rules-view.tsx`, `index-view.tsx`, `context-view.tsx`,
`tasks-view.tsx`, `tools-view.tsx`.

### GUI views/components — KEEP (live)
`agent-setup-doctor.tsx`, `claude-sessions-view.tsx`, `workspace-session-list.tsx`,
all of `views/cockpit/*` and `cockpit/*`.

### GUI components — DELETE
`components/project-picker.tsx`, `components/project-create-form.tsx`, and any
`components/*-forms.tsx` (memory/session) used ONLY by the deleted views (verify by grep).
Remove `NoProjectState`/`NoSelectionState` from `components/states.tsx` if unused after.

### view-id.ts
Reduce `VIEW_IDS` to the surviving global views (`agent-setup`, `claude-sessions`), drop
`PROJECT_SCOPED_VIEWS` entirely, update `VIEW_LABELS`. Update the `view-id.test-d.ts` type-pin.

### api-client.ts
Delete all project/legacy endpoints (`fetchProjects`, `createProject`, `fetchSessions`,
`createSession`, `endSession`, `updateSession`, `fetchMemory`, `createMemoryEntry`,
`updateMemoryEntry`, `deleteMemoryEntry`, `fetchAudit`, `fetchRules`, `fetchIndexStatus`,
`searchIndex`, `fetchContext`, `fetchTasks`, `fetchToolsRoute`, legacy token-saver, retention).
KEEP `fetchHealth` and the MCP endpoints (`fetchMcpStatus`/`installMcp`/`repairMcp`/
`uninstallMcp`) used by `agent-setup`. The live/workspace/overlay clients live in their own
modules (`claude-sessions-client.ts`, workspace/overlay clients) — leave them.

### app.tsx
Remove `activeProjectId`, `ProjectPicker`, `ProjectCreateForm`, the Live/Legacy mode toggle
and the entire Legacy branch, `PROJECT_SCOPED_VIEWS` gating, `NoProjectState`. The shell
becomes: the live home (`WorkspaceSessionList` grouped by cwd) → `SessionCockpit`, plus the
`agent-setup` global view reachable from nav. No project state anywhere.

## Implementation tasks (TDD / mechanical-deletion; commit per task)

1. **Bridge: delete legacy routes + dispatch.** Remove the DELETE-list route files; strip
   their imports + dispatch blocks from `handler.ts`. Add/keep tests asserting the removed
   paths now 404 (`route_not_found`) and the live paths still work. `pnpm --filter
   @megasaver/gui test -- bridge` + `typecheck` green.
2. **Bridge: drop unused `registry`** from RouteContext/handler/server.ts (compiler-guided).
   Update `test-helpers.ts startTestBridge` to stop seeding projects/sessions/memory into a
   registry the bridge no longer has (keep `claudeProjectsDir`/`claudeSessionsMetaDir`/store).
3. **GUI: delete legacy views + components**; remove their imports.
4. **GUI: view-id** reduce + `PROJECT_SCOPED_VIEWS` removal + type-pin update.
5. **GUI: api-client** delete legacy endpoints (+ their tests).
6. **GUI: app.tsx** rewrite to the live-only shell (no project state, no Legacy mode).
   Update/remove `app-flow`/`picker-cascade`/`roundtrip` tests that drove the project shell.
7. **Full gate:** `pnpm verify` green (this is the real check — it also runs the vite
   **build**, so confirm no dangling imports), plus a grep guard: no `projectId`/`ProjectPicker`/
   `activeProjectId`/`PROJECT_SCOPED_VIEWS`/`/api/projects` left in `apps/gui/src` or
   `apps/gui/bridge` (Core/CLI/mcp-bridge matches are expected and fine). Add a changeset.

## Risks & decisions
- **Core/CLI/mcp-bridge untouched** — the only safe boundary. The `pnpm verify` must stay
  green for ALL packages; if a deletion in `apps/gui` references Core types that are fine to
  keep importing (e.g. a shared type), keep the import — only project *runtime* usage goes.
- **Don't break the live app** — every kept route/view/panel (F0–F4) must still pass. Run the
  full GUI suite + the vite build after each task.
- Read-only on `~/.claude/**` is unchanged (no route touched there mutates).

## Definition of done
`pnpm verify` green (lint + typecheck + all tests + conventions + the gui vite build);
grep guard clean in `apps/gui`; live smoke: bridge boots, `GET /api/claude-sessions` +
`/api/workspaces` still return real data, `GET /api/projects` now 404; external reviewer pass.
