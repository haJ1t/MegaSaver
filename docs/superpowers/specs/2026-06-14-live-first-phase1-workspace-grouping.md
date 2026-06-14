# Live-First Phase 1: Workspace grouping by cwd

**Date:** 2026-06-14
**Status:** Spec — pending implementation
**Risk level:** MEDIUM (read-only over Claude data; new bridge route + GUI grouping; no store writes, no project removal). The one HIGH-risk concern — reading user folders — is *not* touched here: this phase only groups metadata already surfaced by `listSessions`.
**Parent architecture:** [2026-06-14-live-first-architecture.md](./2026-06-14-live-first-architecture.md) (§3.1 two identity axes, §3.3 GUI shell, §5 Phase 1)

---

## 1. Goal & Depends on

**Goal.** Introduce the **workspace = cwd** concept derived from live Claude Code sessions: a `workspaceKey` encoding helper (short `sha256(cwd)` + the human cwd label), a new read-only `GET /api/workspaces` that groups `listSessions` output by cwd, and a GUI sidebar that groups the live session list into collapsible per-folder groups (recent-first within each) — all **alongside** the existing project UI, which is untouched.

**Depends on.**
- **Phase 0 (telemetry surfacing)** — conceptually first in the roadmap (§5), but **not a hard code dependency** for this phase. Phase 0 enriches per-session/per-turn fields (`model`, `usage`, `gitBranch`, `isArchived`, `permissionMode`); Phase 1 groups on `cwd` (`ClaudeSessionMeta.projectLabel`), which already exists today. If Phase 0 has landed, Phase 1 simply carries the extra fields through unchanged. **This spec is implementable directly on the current `claude-sessions` backbone** (`reader.ts` / `claude-sessions.ts` / `claude-sessions-client.ts` / `claude-sessions-view.tsx` as they stand today).
- The live backbone itself (`apps/gui/bridge/claude-sessions/*`, route wiring in `handler.ts`, `RouteContext.claudeProjectsDir` + `claudeSessionsMetaDir`) — already shipped.

---

## 2. Scope

### In scope
- **`workspaceKey` encoding helper** — a pure, dependency-free function `encodeWorkspaceKey(cwd: string): string` returning a short, filesystem-safe, stable key = first 16 hex chars of `sha256(cwd)`. The human cwd string is retained separately as the `label`; the key is *never* shown to the user, only used as a stable id (foreshadows the Phase 3+ overlay store paths `index/<workspaceKey>/…`).
- **Workspace derivation (pure)** — `groupSessionsByWorkspace(sessions: ClaudeSessionMeta[]): Workspace[]`: groups by `projectLabel` (the cwd), one `Workspace` per distinct non-empty cwd, carrying `{ key, label, sessionCount, lastActivityMs }`; `lastActivityMs = max(mtimeMs)` over the group; sorted most-recent-first.
- **New bridge route** — `GET /api/workspaces` → `Workspace[]`, derived by calling the existing `listSessions(claudeProjectsDir, claudeSessionsMetaDir, …)` then `groupSessionsByWorkspace`. Read-only; same error mapping as the other claude-sessions routes (`sendReadError`). Supports the same `limit`/`offset` semantics applied to the *underlying session scan* (so grouping is over the same page the list view sees — see §6 risk 3).
- **Client** — `fetchWorkspaces()` in `claude-sessions-client.ts` + the `Workspace` type mirrored client-side.
- **GUI grouping** — `claude-sessions-view.tsx` sidebar groups its sessions by workspace: a collapsible group header per folder (label = basename of cwd + full cwd on hover/title, session count, live dot if any child is live), sessions recent-first **within** each group, groups themselves ordered most-recent-first. Default all expanded; collapse state held in component state.
- **Tests** — unit (key encoding + grouping), bridge route, and view/component tests, all TDD-first.

### Out of scope (deferred to later phases)
- **No session cockpit** — selecting a session still opens the existing single transcript pane (Phase 2).
- **No project removal** — `ProjectPicker`, `ProjectCreateForm`, `activeProjectId`, `PROJECT_SCOPED_VIEWS`, `/api/projects*`, `requireProject` all stay exactly as-is (Phase 5).
- **No overlay store** — no `workspaces.json` cache file is written; workspaces are derived live on every request. No `index/<workspaceKey>/…`, no re-keying of memory/rules/tasks/stats (Phases 3–4). `encodeWorkspaceKey` is introduced *now* purely so the encoding is locked before any store path depends on it, but **nothing in this phase persists a `workspaceKey`.**
- **No cwd file access** — index build, permissions read, etc. are not touched; this phase reads only session *metadata*, never the user's folder contents. (`safeSessionPath` is not extended here.)
- **No promotion of `claude-sessions` into the shell** — it remains the "Claude Code" nav view (Phase 2 promotes it).
- **No new telemetry fields** — `model`/`usage`/`gitBranch`/`permissionMode`/`isArchived` surfacing is Phase 0, not here. If absent, grouping still works on `cwd` alone.
- **No "show untitled/CLI" mode** — metadata-gated hiding in `listSessions` is preserved verbatim (locked decision §7.4).

---

## 3. File-level changes

| Action | Path | Responsibility |
|---|---|---|
| **create** | `apps/gui/bridge/claude-sessions/workspace.ts` | Pure module: `encodeWorkspaceKey(cwd)` (short sha256), `Workspace` type, `groupSessionsByWorkspace(sessions)`. No I/O. |
| **modify** | `apps/gui/bridge/claude-sessions/types.ts` | Add `export type Workspace = { key: string; label: string; sessionCount: number; lastActivityMs: number }`. (Keep `ClaudeSessionMeta` unchanged.) |
| **create** | `apps/gui/bridge/routes/workspaces.ts` | `handleListWorkspaces(ctx)`: parse `limit`/`offset`, call `listSessions`, `groupSessionsByWorkspace`, `sendJson`; `sendReadError` on errno (mirror `claude-sessions.ts`). |
| **modify** | `apps/gui/bridge/handler.ts` | Route `GET /api/workspaces` → `handleListWorkspaces`; non-GET → `methodNotAllowed`. Placed next to the existing `/api/claude-sessions` block. |
| **modify** | `apps/gui/src/lib/claude-sessions-client.ts` | Add `Workspace` type (client mirror) + `fetchWorkspaces(limit?, offset?): Promise<Workspace[]>`. |
| **modify** | `apps/gui/src/views/claude-sessions-view.tsx` | Group the rendered session list by workspace: collapsible group headers, recent-first within group, groups recent-first. Uses existing `fetchClaudeSessions` poll for the session data and either derives groups client-side from the list **or** consumes `fetchWorkspaces` for headers (decision in §4.4). Selection behaviour unchanged. |
| **create** | `apps/gui/test/bridge/claude-sessions-workspace.test.ts` | Unit tests for `encodeWorkspaceKey` + `groupSessionsByWorkspace` (pure). |
| **create** | `apps/gui/test/bridge/workspaces-route.test.ts` | Bridge route test for `GET /api/workspaces` via `startTestBridge({ claudeProjectsDir, claudeSessionsMetaDir })`. |
| **create** | `apps/gui/test/views/claude-sessions-view.test.tsx` | View test: renders grouped sidebar, collapse toggles, recent-first ordering, selection still works. (No such test exists today.) |

No `core` / `packages/*` changes — workspace derivation lives entirely in the bridge (live source), consistent with the architecture's "live backbone services (bridge)" (§3.2). No changeset needed: `@megasaver/core`'s public API is untouched; the bridge/gui are application code, not a published package surface (confirm against §9 item 9 — only add a changeset if `apps/gui` is treated as versioned, which it is not).

---

## 4. Data model & API changes

### 4.1 New type: `Workspace`
Added to `apps/gui/bridge/claude-sessions/types.ts` and mirrored in `apps/gui/src/lib/claude-sessions-client.ts` (the client already hand-mirrors `ClaudeSessionMeta`, `Block`, `NormalizedMessage` — match that convention, no shared import across the bridge/src boundary):

```ts
export type Workspace = {
  key: string;          // encodeWorkspaceKey(cwd) — short sha256, stable, fs-safe
  label: string;        // the raw cwd (human path); UI derives basename for the header
  sessionCount: number; // distinct sessions whose projectLabel === this cwd
  lastActivityMs: number; // max mtimeMs across the group (drives recent-first + live dot)
};
```

Rationale for fields: `key` is the future overlay-store id (locked encoding); `label` is the cwd the UI shows; `sessionCount` and `lastActivityMs` let the sidebar render a header without re-walking sessions. We deliberately **omit** `sessionIds` from the payload — the view already has the full `ClaudeSessionMeta[]` from `fetchClaudeSessions`, so the route stays a thin rollup and avoids duplicating per-session data.

### 4.2 `encodeWorkspaceKey`
```ts
import { createHash } from "node:crypto";

const WORKSPACE_KEY_HEX_LEN = 16; // 64 bits — ample for the handful of cwds one machine sees

export function encodeWorkspaceKey(cwd: string): string {
  return createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, WORKSPACE_KEY_HEX_LEN);
}
```
- Deterministic, collision-safe at this scale, filesystem-safe (lowercase hex), bounded length (solves spaces/unicode/long-path concerns from §6 risk 2 of the architecture doc).
- Empty/whitespace cwd is **not** a valid workspace — `groupSessionsByWorkspace` drops sessions with an empty `projectLabel` before keying (they are the metadata-less / cwd-less edge; matches the hidden-session philosophy).

### 4.3 `groupSessionsByWorkspace`
```ts
export function groupSessionsByWorkspace(sessions: ClaudeSessionMeta[]): Workspace[] {
  const byCwd = new Map<string, { label: string; count: number; lastActivityMs: number }>();
  for (const s of sessions) {
    const cwd = s.projectLabel;
    if (cwd.length === 0) continue; // cwd-less sessions are not a workspace
    const key = encodeWorkspaceKey(cwd);
    const existing = byCwd.get(key);
    if (existing) {
      existing.count += 1;
      if (s.mtimeMs > existing.lastActivityMs) existing.lastActivityMs = s.mtimeMs;
    } else {
      byCwd.set(key, { label: cwd, count: 1, lastActivityMs: s.mtimeMs });
    }
  }
  return [...byCwd]
    .map(([key, v]) => ({
      key,
      label: v.label,
      sessionCount: v.count,
      lastActivityMs: v.lastActivityMs,
    }))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
}
```
Note: grouping keys on `encodeWorkspaceKey(cwd)`, not the raw string, so the produced `key` and the grouping are guaranteed consistent (one source of truth for "same workspace").

### 4.4 New endpoint
- **Method + path:** `GET /api/workspaces`
- **Query:** `?limit=<1..200, default 50>&offset=<0.., default 0>` — applied to the **underlying `listSessions` scan** (same `intParam` bounds as `handleListClaudeSessions`). The response is the grouping of that page (see §6 risk 3 for why we do not paginate workspaces themselves in Phase 1).
- **Response 200:** `Workspace[]`, most-recent-first.
- **Errors:** filesystem errno → `500 internal_error` (via `sendReadError`); non-GET → `405 method_not_allowed` (via `handler.ts`). No 400/404 paths (no path params).
- **Headers/CORS:** inherited from the shared `sendJson` (CSP, `vary: origin`, `access-control-allow-origin`) — no special handling.

**Client-vs-server grouping decision (locked for this phase):** the **route** computes the authoritative grouping (single source of truth, testable in isolation, ready to back the Phase 2 cockpit / Phase 3 overlay paths). The **view** consumes `fetchWorkspaces()` for the group **headers** (key/label/count/lastActivity) and continues to use `fetchClaudeSessions()` for the per-session rows, joining the two by `encodeWorkspaceKey` is unnecessary on the client — instead the view groups its own `ClaudeSessionMeta[]` rows by `projectLabel` for membership and uses the `Workspace[]` only to order/label headers. This keeps the two fetches independent (they already poll on the same `LIST_POLL_MS` timer) and avoids a client-side sha256 dependency. If the two ever disagree mid-poll, the row grouping (client) wins for membership and any header lacking rows is simply not rendered.

### 4.5 Store paths / schemas
**None.** No file is written or read beyond what `listSessions` already touches. `workspaces.json` (architecture §3.4) is explicitly *deferred* — Phase 1 derives live every request.

---

## 5. Implementation tasks (TDD)

Conventions for every task: ESM with `.js` import extensions; Biome; Vitest `describe/it`; `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` on (array access via `?.`/`as` per existing tests). Commands run from repo root:
- Test (all gui): `pnpm --filter @megasaver/gui test`
- Test (single file): `pnpm --filter @megasaver/gui test <path>` (Vitest path filter)
- Typecheck: `pnpm --filter @megasaver/gui typecheck`
- Lint/format: `npx biome check apps/gui` (or `npx biome check --write apps/gui` to autofix)
- Full gate: `pnpm verify`

Commit after each green task with a Conventional Commit (`caveman-commit` style, subject ≤ 50 chars). Work in a worktree per §10 / `superpowers:using-git-worktrees`.

---

### Task 1 — `encodeWorkspaceKey` (pure)
**Files:**
- create `apps/gui/bridge/claude-sessions/workspace.ts`
- create `apps/gui/test/bridge/claude-sessions-workspace.test.ts`

**Steps:**
1. Write failing test: `encodeWorkspaceKey("/Users/me/proj")` returns a 16-char lowercase-hex string; is **deterministic** (same input → same output); is **distinct** for distinct cwds (`"/a"` ≠ `"/b"`); handles spaces/unicode (`"/Users/me/proj with space/π"`) without throwing and still returns 16 hex chars.
   ```ts
   import { describe, expect, it } from "vitest";
   import { encodeWorkspaceKey } from "../../bridge/claude-sessions/workspace.js";

   describe("encodeWorkspaceKey", () => {
     it("is a 16-char lowercase hex, deterministic", () => {
       const k = encodeWorkspaceKey("/Users/me/proj");
       expect(k).toMatch(/^[0-9a-f]{16}$/);
       expect(encodeWorkspaceKey("/Users/me/proj")).toBe(k);
     });
     it("differs for different cwds and survives unicode/spaces", () => {
       expect(encodeWorkspaceKey("/a")).not.toBe(encodeWorkspaceKey("/b"));
       expect(encodeWorkspaceKey("/Users/me/proj with space/π")).toMatch(/^[0-9a-f]{16}$/);
     });
   });
   ```
2. Run → expect fail (module/export missing): `pnpm --filter @megasaver/gui test claude-sessions-workspace`
3. Minimal impl: the `encodeWorkspaceKey` body from §4.2 in `workspace.ts`.
4. Run → expect pass.
5. `npx biome check apps/gui/bridge/claude-sessions/workspace.ts apps/gui/test/bridge/claude-sessions-workspace.test.ts` then `pnpm --filter @megasaver/gui typecheck`.
6. Commit: `feat(gui): add workspaceKey cwd encoding`.

### Task 2 — `Workspace` type + `groupSessionsByWorkspace` (pure)
**Files:**
- modify `apps/gui/bridge/claude-sessions/types.ts` (add `Workspace`)
- modify `apps/gui/bridge/claude-sessions/workspace.ts` (add grouping)
- modify `apps/gui/test/bridge/claude-sessions-workspace.test.ts` (extend)

**Steps:**
1. Write failing test cases for `groupSessionsByWorkspace`, building fixtures shaped like `ClaudeSessionMeta` (`{dir,id,mtimeMs,size,title,projectLabel}`):
   - two sessions sharing `projectLabel: "/Users/me/proj"` collapse into one workspace with `sessionCount: 2`, `key === encodeWorkspaceKey("/Users/me/proj")`, `label === "/Users/me/proj"`, `lastActivityMs === max(mtimeMs)`.
   - distinct cwds → distinct workspaces, **sorted by `lastActivityMs` desc** (the workspace whose newest session is newest comes first).
   - a session with `projectLabel: ""` is dropped (no workspace produced for it).
   ```ts
   import { groupSessionsByWorkspace, encodeWorkspaceKey } from "../../bridge/claude-sessions/workspace.js";
   import type { ClaudeSessionMeta } from "../../bridge/claude-sessions/types.js";

   const meta = (over: Partial<ClaudeSessionMeta>): ClaudeSessionMeta => ({
     dir: "-d", id: "i", mtimeMs: 0, size: 0, title: "t", projectLabel: "/x", ...over,
   });

   it("groups sessions by cwd, recent-first, counts members", () => {
     const ws = groupSessionsByWorkspace([
       meta({ id: "a", projectLabel: "/p", mtimeMs: 100 }),
       meta({ id: "b", projectLabel: "/p", mtimeMs: 300 }),
       meta({ id: "c", projectLabel: "/q", mtimeMs: 200 }),
       meta({ id: "d", projectLabel: "", mtimeMs: 999 }),
     ]);
     expect(ws.map((w) => w.label)).toEqual(["/p", "/q"]); // /p newest (300) first
     const p = ws.find((w) => w.label === "/p");
     expect(p?.sessionCount).toBe(2);
     expect(p?.lastActivityMs).toBe(300);
     expect(p?.key).toBe(encodeWorkspaceKey("/p"));
   });
   ```
2. Run → expect fail.
3. Minimal impl: add `Workspace` to `types.ts` (§4.1) and `groupSessionsByWorkspace` (§4.3) to `workspace.ts`.
4. Run → expect pass. `npx biome check …` + `typecheck`.
5. Commit: `feat(gui): group live sessions into workspaces`.

### Task 3 — `GET /api/workspaces` route
**Files:**
- create `apps/gui/bridge/routes/workspaces.ts`
- modify `apps/gui/bridge/handler.ts` (route wiring)
- create `apps/gui/test/bridge/workspaces-route.test.ts`

**Steps:**
1. Write failing route test, mirroring `claude-sessions-route.test.ts` setup (`mkdtemp` ccRoot + metaRoot, `writeMeta`, two transcripts under one dir but **two distinct cwds** to prove grouping, then `startTestBridge({ claudeProjectsDir, claudeSessionsMetaDir })`):
   - `GET /api/workspaces` → 200, body is `Workspace[]`; two cwds in fixtures → 2 workspaces, recent-first; the shared-cwd case → `sessionCount: 2`.
   - `POST /api/workspaces` → 405 `method_not_allowed`.
   - empty metadata store → `[]` (reuse the "no titles" path: point `claudeSessionsMetaDir` at a missing dir).
   ```ts
   it("GET /api/workspaces groups sessions by cwd", async () => {
     const res = await fetch(`${server.baseUrl}/api/workspaces`);
     expect(res.status).toBe(200);
     const body = (await res.json()) as { label: string; sessionCount: number }[];
     expect(body.map((w) => w.label)).toContain("/Users/me/proj");
   });
   it("POST /api/workspaces → 405", async () => {
     const res = await fetch(`${server.baseUrl}/api/workspaces`, { method: "POST" });
     expect(res.status).toBe(405);
   });
   ```
2. Run → expect fail (route 404).
3. Minimal impl `routes/workspaces.ts` (mirror `handleListClaudeSessions` exactly, swap the body for grouping):
   ```ts
   import { listSessions } from "../claude-sessions/reader.js";
   import { groupSessionsByWorkspace } from "../claude-sessions/workspace.js";
   import type { RouteContext } from "../route-context.js";
   import { intParam } from "./_query.js";
   // sendReadError: copy/import the same helper shape used in claude-sessions.ts
   export async function handleListWorkspaces(ctx: RouteContext): Promise<void> {
     try {
       const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
       const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
       const sessions = await listSessions(ctx.claudeProjectsDir, ctx.claudeSessionsMetaDir, {
         limit,
         offset,
       });
       ctx.sendJson(ctx.res, 200, groupSessionsByWorkspace(sessions), ctx.origin);
     } catch (err) {
       sendReadError(ctx, err);
     }
   }
   ```
   - `sendReadError` is currently a private fn in `claude-sessions.ts`. **Decision:** export it from `claude-sessions.ts` (`export function sendReadError`) and import it here, rather than duplicate — it is the shared "read-only route errno → 500" mapping. (One-line surgical change to the existing file.)
   - In `handler.ts`, add next to the `/api/claude-sessions` block:
     ```ts
     if (path === "/api/workspaces") {
       if (method !== "GET") return methodNotAllowed(res, method, origin);
       await handleListWorkspaces(ctx);
       return;
     }
     ```
     plus the import.
4. Run → expect pass. `npx biome check apps/gui/bridge` + `pnpm --filter @megasaver/gui typecheck`.
5. Commit: `feat(gui): add GET /api/workspaces route`.

### Task 4 — client `fetchWorkspaces`
**Files:**
- modify `apps/gui/src/lib/claude-sessions-client.ts`
- (covered by Task 5's view test + Task 3's route test; no separate client unit test — matches the repo, which has no standalone test for `fetchClaudeSessions`).

**Steps:**
1. Write the failing assertion **inside Task 5's view test** (a grouped header appears), which exercises `fetchWorkspaces` end-to-end via a mocked `fetch`. (Keeps to the repo pattern of testing the client through the view, not in isolation.)
2. Minimal impl: mirror `fetchClaudeSessions`:
   ```ts
   export type Workspace = {
     key: string;
     label: string;
     sessionCount: number;
     lastActivityMs: number;
   };
   export function fetchWorkspaces(limit = 50, offset = 0): Promise<Workspace[]> {
     return getJson<Workspace[]>(`/api/workspaces?limit=${limit}&offset=${offset}`);
   }
   ```
3. `npx biome check` + `typecheck`.
4. Commit folded into Task 5 (the client is unused until the view consumes it) **or** commit standalone: `feat(gui): add fetchWorkspaces client`.

### Task 5 — grouped, collapsible sidebar in `claude-sessions-view.tsx`
**Files:**
- modify `apps/gui/src/views/claude-sessions-view.tsx`
- create `apps/gui/test/views/claude-sessions-view.test.tsx`

**Steps:**
1. Write failing view test (Testing Library, mock `fetch` for `/api/claude-sessions` and `/api/workspaces`; follow `apps/gui/test/views/sessions-view.test.tsx` patterns for mocking + `act`/`findBy*`). Assert:
   - the sidebar renders a **group header per cwd** (e.g. text containing the folder basename), and the sessions render **under** their folder.
   - within a group, the **newest** session row precedes the older one.
   - clicking a **group header toggles** its children (collapse hides rows; `aria-expanded` flips).
   - selecting a session row still opens the transcript (existing behaviour preserved — assert the stream fetch / selected state as the current view does).
   ```ts
   it("groups sessions by folder and toggles collapse", async () => {
     // mock fetchClaudeSessions → [{dir,id:'b',projectLabel:'/Users/me/proj',mtimeMs:300,...},
     //                            {dir,id:'a',projectLabel:'/Users/me/proj',mtimeMs:100,...},
     //                            {dir,id:'c',projectLabel:'/Users/me/other',mtimeMs:200,...}]
     // mock fetchWorkspaces  → groupSessionsByWorkspace(of the above)
     render(<ClaudeSessionsView />);
     expect(await screen.findByText(/proj/)).toBeInTheDocument();
     // newest-first within group: row 'b' before row 'a'
     // click the 'proj' group header → its rows disappear
   });
   ```
2. Run → expect fail.
3. Minimal impl in the view:
   - Add `const [workspaces, setWorkspaces] = useState<Workspace[]>([])` and fold `fetchWorkspaces()` into the existing `loadList` (`Promise.all([fetchClaudeSessions(...), fetchWorkspaces(...)])`), reusing the same `LIST_POLL_MS` timer.
   - Add `const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())` keyed by workspace `key` (default: empty set = all expanded).
   - Build a `Map<key, ClaudeSessionMeta[]>` from `sessions` via `encodeWorkspaceKey`-equivalent membership — but **avoid importing node `crypto` into the browser bundle**: group rows by `projectLabel` directly (string key), and align to the `Workspace[]` headers by `label`. (The bridge already proved key↔label is 1:1; the client never needs the hash.) Order groups by `workspaces` order (already recent-first); order rows within a group by `mtimeMs` desc.
   - Render: for each workspace header → a `<button aria-expanded>` row (folder basename via `label.split("/").pop()`, full `label` as `title`, `sessionCount`, a live dot if any child `nowMs - mtimeMs < LIVE_WINDOW_MS`); when expanded, render the existing per-session `<button>` rows underneath (unchanged markup/selection).
   - Keep the empty-state copy; show it when `workspaces.length === 0`.
4. Run → expect pass. `npx biome check apps/gui/src` + `pnpm --filter @megasaver/gui typecheck`.
5. Commit: `feat(gui): group claude sessions by workspace in sidebar`.

### Task 6 — full gate + live smoke
**Files:** none (verification only).
**Steps:**
1. `pnpm verify` (biome + typecheck + vitest) → green. Capture output (root cause + exit code only per §13, not raw logs).
2. Live smoke (real data): run `pnpm --filter @megasaver/gui bridge` (or `dev`), then `curl -s localhost:<port>/api/workspaces | jq 'length, .[0]'` against the *real* `~/.claude/projects` + desktop metadata; confirm it returns the user's actual folders grouped, recent-first, counts plausible. Open the GUI and confirm the sidebar shows collapsible folder groups with sessions nested recent-first, and selecting one still streams the transcript.
3. `superpowers:requesting-code-review` (`code-reviewer`, fresh context) — author ≠ reviewer (§4 hard gate).
4. No commit (gate); record evidence in the PR / completion note.

---

## 6. Risks & decisions (this phase)

1. **Browser bundle must not import `node:crypto`.** `encodeWorkspaceKey` lives in the **bridge** only. The **view** groups rows by the raw `projectLabel` string and aligns to server-provided `Workspace.label` — never hashing client-side. *Decision: locked (no client sha256).*
2. **`limit`/`offset` semantics.** Phase 1 paginates the **session scan**, not the workspaces, then groups that page. This means a folder's `sessionCount` reflects only sessions within the fetched window. The current view fetches `fetchClaudeSessions(50, 0)`; with the same window for `fetchWorkspaces(50, 0)` the two stay consistent. *Decision: acceptable for Phase 1 (50 most-recent sessions is the existing UX); true workspace-level pagination is deferred to Phase 2's cockpit shell.*
3. **Two independent fetches can momentarily disagree** (poll race between `/api/claude-sessions` and `/api/workspaces`). *Decision: client row-grouping (by `projectLabel`) is the source of truth for membership; a workspace header with no matching rows is simply not rendered; a row whose folder has no header falls back to a header derived from its own `projectLabel`. No hard error path.* (This also makes the view resilient if `fetchWorkspaces` 500s — fall back to deriving headers entirely client-side from the session list.)
4. **Empty / missing cwd.** Sessions with `projectLabel === ""` produce no workspace (dropped in grouping). They are already near-invisible because `listSessions` hides metadata-less sessions; a metadata'd session with an empty `cwd` field is the only way to hit this, and rendering it group-less would be confusing. *Decision: drop from workspaces; if such a row exists it simply has no group (the view's fallback header uses its `projectLabel`, which is empty → it would render under a blank header; acceptable and rare — revisit only if observed).*
5. **`cwd` changes mid-session** (architecture §6 risk 5). `listSessions`/`firstCwd` already pin a session to a single cwd (`projectLabel`). Phase 1 inherits that — no per-line cwd handling. *Decision: inherit existing behaviour; out of scope.*
6. **`sendReadError` export.** Promoting the private helper in `claude-sessions.ts` to an export is a minimal, surgical change (one keyword) that avoids duplicating the errno→500 mapping. *Decision: export it; no behaviour change to existing routes.*
7. **No store, no migration, no project removal** — by scope. The old project UI and `/api/projects*` keep working unchanged; Phase 1 is purely additive. *No rollback risk beyond the new route/view.*

---

## 7. Definition of done

Per `CLAUDE.md §9`, all must hold:
1. **Spec** — this file in `docs/superpowers/specs/`.
2. **Plan** — companion plan in `docs/superpowers/plans/2026-06-14-live-first-phase1-workspace-grouping-plan.md` (via `superpowers:writing-plans` before code).
3. **TDD** — every task above wrote its failing test first (red → green).
4. **`pnpm verify` green** — `biome check` (lint+format) + `tsc --noEmit` (project refs, `tsc -b` + `tsconfig.test.json`) + `vitest run` all pass. Evidence captured (exit code + summary, not raw logs).
5. **Feature smoke evidence** (§9 item 5): 
   - Bridge/library surface → the route + grouping integration tests in `workspaces-route.test.ts` exercise the public endpoint.
   - **Live smoke** → captured `curl /api/workspaces` against the real `~/.claude/projects` showing the user's actual folders grouped recent-first, plus a GUI screenshot of the collapsible grouped sidebar with a transcript still streaming on select.
6. **External reviewer** — `code-reviewer` (or `critic` if upgraded) pass in a fresh context; author ≠ reviewer.
7. **Verifier** — `omc:verify` evidence-based pass.
8. **Zero pending TODOs** for the feature.
9. **Changeset** — not required (no `@megasaver/*` published-package API change; `apps/gui` is unversioned). Confirm at review; add only if the boundary is reclassified.
10. **Conventions drift** — none expected (`CLAUDE.md`/`AGENTS.md`/`.cursor/rules` untouched). `pnpm conventions:check` (in `pnpm verify`) must stay green.

**Hard rule:** no "done"/"passing" claim before items 4–7 produce evidence.
