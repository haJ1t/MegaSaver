# MegaSaver Live-First Architecture — Pivot from Projects to Live Claude Code Sessions

**Date:** 2026-06-14
**Status:** Architecture proposal (pre-spec). Produces per-phase specs/plans downstream.
**Author intent (verbatim):** remove the "project" concept; build the whole app directly on **live Claude Code sessions**; the app is always live and works only on live sessions; group by **cwd** (the session's working folder); **all features must remain usable on live sessions.**

---

## 1. Goal & principles

1. **Live-first.** Live Claude Code sessions (`~/.claude/projects/**/*.jsonl` + the desktop metadata store) are the single backbone. The app is always streaming live data.
2. **No manual "project".** Delete project create/pick/gating. The **cwd** (a session's working directory) becomes the auto-derived grouping unit ("workspace"). Workspaces are discovered from live sessions, never hand-created.
3. **All features survive, re-homed.** Every current feature (overview/stats, memory, rules, index, context, tasks, tools, token-saver) stays usable — re-pointed to either a **live session** (by Claude session id) or its **cwd/workspace**.
4. **Read-only on Claude's data.** MegaSaver never writes Claude's transcripts. Its own artefacts (memory, rules, stats, indexes, chunks) live in a separate **overlay store**, re-keyed from `projectId` → `cwd` (and session-scoped data → live session id).
5. **Incremental.** Each phase ships a working app; the project model is removed last, only after every feature is re-homed.

---

## 2. Current architecture (grounded findings)

### 2.1 GUI is gated entirely on one project id
- `app.tsx:37` — the whole shell hinges on `activeProjectId`. `PROJECT_SCOPED_VIEWS` (`view-id.ts:33-42`) gates 8 of 10 views behind a selected project; only `agent-setup` and `claude-sessions` render globally (`app.tsx:157-160`).
- Every gated view receives `projectId` and calls a project-pathed endpoint (e.g. `overview` → `/api/projects/:id/audit`, `memory` → `/api/memory?projectId=`, `index`/`context`/`rules`/`tasks`/`tools` → `/api/projects/:id/...`).
- `claude-sessions` is the **only fully project-free view** — its own client (`claude-sessions-client.ts`), live source, no `projectId`. **It is the seed of the new architecture.**

### 2.2 Core is partitioned by `projectId`, but the key is already a cwd
- Entities (`Project, Session, MemoryEntry, ProjectRule, FailedAttempt, TaskPlan, ToolDefinition`) are all keyed by `projectId`; `requireProject` guards every `create*` in both registry impls (`registry.ts:231-235`, `json-directory-registry.ts:136-143`).
- **`Project.rootPath` already records the cwd** (`project.ts:4-18`). The Project row is effectively a `cwd → id` index.
- **`SessionId` is just a lowercase UUID** (`shared/src/ids.ts:17`) — it could *be* the Claude transcript uuid today; the only obstacle is the `projectId` FK.
- Storage (`~/.local/share/megasaver`): `projects.json` + `sessions.json` are flat global arrays; `memory/`, `project-rules/`, `failed-attempts/`, `task-plans/`, `tool-definitions/` are **per-project JSONL files named `<projectId>.jsonl`** (`json-directory-store.ts:56-88`).

### 2.3 The live transcript already carries telemetry we discard
Per-turn the transcript has `cwd, gitBranch, message.model, message.usage.{input_tokens,output_tokens,cache_*}, isSidechain, parentUuid` — but `parse.ts` keeps only `{role, ts, blocks}` and drops the rest. Desktop metadata adds `title, cwd, lastActivityAt, isArchived, model, permissionMode, planPath` — of which only `title`/`cwd` are used.

### 2.4 Features split into three re-home classes
| Class | Features | Re-home target |
|---|---|---|
| **cwd-only (easy)** | indexer (build/search — needs only `rootDir`), policy (`evaluateCommand`/`evaluatePathRead` read `<cwd>/.megasaver/permissions.yaml`), `redact`, retrieval `rankBm25`, `output-filter/filterOutput` (pure text) | the session's **cwd** + a cwd-keyed overlay store path |
| **overlay-store (needs re-key)** | `stats` (token-saver events/audit/adoption — proxy byte savings, **not in transcript**), `RankedRule` (FORGE artefacts), `TaskPlan`, `context-gate` pipelines, `fetchChunk` | re-keyed overlay store under `cwd` and/or live `sessionId` |
| **transcript-derivable (new)** | LLM token usage totals, model mix, turn/tool-call counts, duration, git branch | computed **directly from the live transcript** — no store needed |

**Critical nuance:** the transcript's `message.usage` = **LLM context token cost**; the existing token-saver stats = **output-filter byte savings from the proxy**. These are *different metrics* and don't substitute. So:
- A **new "session telemetry"** panel (LLM tokens/model/turns) is free from the transcript.
- The **existing token-saver savings** still require MegaSaver's proxy/output-filter to actually run (the project's "Proxy Mode") and a re-keyed stats store.

---

## 3. Target architecture

### 3.1 Two identity axes replace "project"
- **Workspace = cwd.** Identity = the absolute cwd path, encoded to a filesystem-safe key (`workspaceKey = sha256(cwd)` short hash, with the human cwd kept as a label). Auto-discovered from live sessions. Replaces `Project`. No create/delete UI.
- **Session = live Claude Code session.** Identity = the transcript uuid (`cliSessionId`). Source of truth = `~/.claude/projects` + desktop metadata. MegaSaver stops minting sessions.

A workspace is "a folder you've run Claude in"; a session is "one live conversation in that folder". Folder-scoped features hang off the workspace; conversation-scoped features hang off the session.

### 3.2 Live backbone services (bridge)
1. **Discovery** — `listSessions` (exists, metadata-driven titles) + **group by cwd → workspaces**; surface `isArchived`, `model`, `permissionMode`, `lastActivityAt`.
2. **Session detail + live tail** — snapshot + SSE (exists). Extend `parse.ts`/types to retain `model`, `usage`, `gitBranch` per turn (behind the normalized shape).
3. **Session telemetry (new, transcript-derived)** — token totals, model mix, turn/tool counts, duration, branch. Pure read over the transcript.
4. **Workspace (cwd) services** — index build/search, context-pack preview, rules ranking, permissions/policy, tools router. Re-pointed to `workspace.cwd` for source files and a cwd-keyed overlay store.
5. **Session overlay** — memory/notes, task plans, proxy token-saver stats keyed by `(workspaceKey, sessionId)`.

### 3.3 GUI shell redesign
- **Delete**: `ProjectPicker`, `ProjectCreateForm`, `activeProjectId`, `PROJECT_SCOPED_VIEWS`, the gating cascade in `app.tsx`.
- **New home**: the **live session list grouped by workspace (cwd)** — recent-first within each folder, "live" dots, archived filter. (This is `claude-sessions-view` promoted to the shell + cwd grouping.)
- **Session cockpit**: selecting a session opens a multi-panel view, all live, all scoped to that session + its cwd:
  - Transcript (+ live tail) — exists.
  - Telemetry (tokens/model/turns) — transcript-derived.
  - Memory / notes — session+cwd overlay.
  - Context / Index / Rules / Tools / Permissions — cwd (workspace) features.
  - Tasks — session overlay.
  - Token-saver — proxy overlay (when proxy active).
- **Workspace view**: a cwd-level rollup (all its sessions + the folder-scoped features and overlays).

### 3.4 Storage (overlay store re-key)
```
~/.local/share/megasaver/
  workspaces.json                     # cwd → {workspaceKey,label,firstSeen,lastSeen}  (derived cache)
  index/<workspaceKey>/blocks.jsonl   # was projects/<id>/index
  memory/<workspaceKey>.jsonl         # was memory/<projectId>.jsonl
  rules/<workspaceKey>.jsonl
  failed-attempts/<workspaceKey>.jsonl
  tasks/<workspaceKey>/<sessionId>.jsonl
  tools/<workspaceKey>.jsonl
  stats/<workspaceKey>/<sessionId>.{events,audit}.jsonl
  content/<workspaceKey>/<sessionId>/<chunkSetId>.json
```
- Drop `projects.json`/`sessions.json` (sessions now come live).
- Drop `requireProject`; replace `projectId: ProjectId` with `workspaceKey: string` across entities; session-scoped artefacts also carry the live `sessionId`.

### 3.5 Bridge API shape (after)
- **Remove**: `/api/projects*`, `/api/sessions` (store CRUD), all `/api/projects/:id/*`.
- **Keep/extend**: `/api/claude-sessions*` (now the backbone; add `?groupByCwd`, telemetry, archived).
- **Add (workspace-scoped)**: `/api/workspaces`, `/api/workspaces/:key/{index,context,rules,tools,permissions}`.
- **Add (session-scoped)**: `/api/claude-sessions/:dir/:id/{telemetry,memory,tasks,token-saver}`.
- **RouteContext**: drop the project-centric `registry` surface; add a `workspace resolver` (cwd → workspaceKey + overlay paths) and keep `claudeProjectsDir` / `claudeSessionsMetaDir`.

---

## 4. Per-feature re-home plan

| Feature | New key | Data source | Effort | How |
|---|---|---|---|---|
| **Session list / home** | live session id, grouped by cwd | live metadata + transcripts | easy | promote `claude-sessions` + cwd grouping |
| **Transcript + live tail** | session id | transcript (SSE) | done | exists |
| **Telemetry (tokens/model/turns)** | session id | **transcript** (`message.usage/model`) | easy | new transcript aggregator; stop discarding in `parse.ts` |
| **Index** | cwd | `<cwd>` files → `index/<workspaceKey>` | easy | `buildIndex({rootDir: cwd, storeDir})` |
| **Context preview** | cwd + task | cwd index blocks | needs-work | load blocks by workspaceKey, then pure `buildContextPack` |
| **Rules** | cwd | overlay `rules/<workspaceKey>.jsonl` | needs-work | re-key store; pure `rankApplicableRules` |
| **Permissions/policy** | cwd | `<cwd>/.megasaver/permissions.yaml` | easy | `evaluateCommand`/`evaluatePathRead` already cwd-native |
| **Tools router** | cwd | overlay `tools/<workspaceKey>.jsonl` | needs-work | re-key store; pure router |
| **Memory / notes** | session id + cwd | overlay `memory/<workspaceKey>.jsonl` (scope project→cwd, session→live id) | needs-work | split `scope` cleanly: cwd-scoped vs session-scoped |
| **Tasks** | session id | overlay `tasks/<workspaceKey>/<sessionId>.jsonl` | needs-work | `TaskPlan.sessionId` → live id; `projectId` → cwd |
| **Token-saver stats** | session id | proxy events overlay (needs proxy running) | needs-work | re-key `(projectId,sessionId)`→`(workspaceKey, liveSessionId)`; fed by Proxy Mode |
| **Agent setup (MCP)** | cwd (for install target) | mcpOps (mostly global) | easy | install/repair target = the session's cwd instead of a project |

**Inherently cwd-scoped (not session-scoped):** index, context, rules, tools, permissions, project memory → these live on the **workspace**, shown in the cockpit under the session's folder context.

---

## 5. Phased roadmap (each phase shippable)

**Phase 0 — Surface live telemetry (no model change).**
Stop discarding `model`/`usage`/`gitBranch`/`isArchived`/`permissionMode`; add a read-only telemetry panel + archived filter + cwd label to the existing `claude-sessions` view. Pure additive; zero project changes. *Quick, high-value, de-risks the live source.*

**Phase 1 — Workspace grouping.**
Add cwd grouping to the live list (`/api/workspaces` derived from sessions). Sidebar groups sessions by folder. Still alongside the old project UI.

**Phase 2 — Session cockpit shell.**
Replace the project-gated shell with: live session list (grouped) → session cockpit. First cockpit panels = transcript + telemetry (both read-only, transcript-derived). Old project views still reachable in a "legacy" tab during migration.

**Phase 3 — cwd/workspace features re-pointed.**
Re-home index, context, permissions, tools, rules to operate on the session's cwd + a cwd-keyed overlay store. Implement `workspaceKey` encoding + overlay store re-key for these.

**Phase 4 — session overlay features.**
Re-home memory/notes, tasks, and (proxy-fed) token-saver to keys `(workspaceKey, liveSessionId)`. Resolve the memory `scope` split (cwd vs session).

**Phase 5 — Remove the project model.**
Delete `ProjectPicker`/`ProjectCreateForm`/`activeProjectId`/`PROJECT_SCOPED_VIEWS`, `/api/projects*`, the project store tier (`projects.json`/`sessions.json`), and `requireProject`. One-time migration: existing `projects.json` rows → `workspaces.json` by `rootPath`→cwd; per-project JSONL files → `<workspaceKey>.jsonl`. Delete dead code.

---

## 6. Risks & decisions

1. **Token-saver ≠ transcript tokens.** Output-filter byte savings need the proxy to run; only LLM-token telemetry is free from the transcript. **Decision needed:** keep token-saver as a proxy-fed overlay (ties to Proxy Mode roadmap) vs drop it for v1 and ship only transcript telemetry.
2. **`workspaceKey` encoding.** cwd → stable filesystem-safe key (recommend short sha256 hash + human label). Handles spaces/unicode/path length.
3. **Sessions without desktop metadata.** Current `listSessions` hides any transcript lacking a `local_*.json` (deliberate noise filter). CLI-only/headless sessions stay invisible. **Decision:** accept (matches "what Claude shows") vs add an opt-in "show untitled" mode.
4. **Memory `scope` split.** Project-scoped memory is cross-session — it must re-key to **cwd**, not a session id. Session-scoped memory → live session id. The current single type carries both; needs a clean split.
5. **Multiple sessions per cwd / one session moving cwd.** cwd grouping must handle many sessions per folder and (rare) cwd changes mid-session (transcript `cwd` is per-line — use the first/most-common).
6. **Security.** Read-only Claude data; extend the existing `safeSessionPath` path-safety to any new workspace/cwd file access (index/permissions read real folders — sandbox to the resolved cwd). HIGH risk (reads user files at scale).
7. **Archived sessions.** Surface `isArchived` as a filter/badge; default hide archived in the main list.

---

## 7. Open questions for the author

1. **Token-saver / Proxy Mode:** keep it (proxy-fed overlay) in the live app, or defer and ship transcript-only telemetry first? (Affects Phase 4 scope.)
2. **Scope of overlay write features:** confirm MegaSaver may keep its own overlay store (memory/rules/index/stats) keyed by cwd/session — never touching Claude's files. (Your "use all features on live sessions" implies yes.)
3. **Cockpit vs per-view:** one rich **session cockpit** (panels/tabs) vs keep separate nav views re-scoped to the selected session? (Recommend cockpit.)
4. **Untitled/CLI sessions:** show them (no Claude title) or keep hiding (current behavior)?

---

## 8. Next step

On approval of the direction + the four open questions, split this into per-phase specs starting with **Phase 0 (telemetry surfacing)** and **Phase 2 (cockpit shell)** via `superpowers:brainstorming` → `writing-plans`, then implement phase-by-phase (each behind the existing TDD + review gates).
