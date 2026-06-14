# Live-First Phase 2: Session cockpit shell

**Date:** 2026-06-14
**Status:** Spec — pending implementation
**Risk:** MEDIUM (GUI shell restructure + read-only bridge wiring; no Claude-data writes, no destructive ops). The legacy project shell is preserved, not deleted — F5 owns deletion.
**Parent:** [`2026-06-14-live-first-architecture.md`](./2026-06-14-live-first-architecture.md) (§3.3, §5 Phase 2, §7.3).

---

## 1. Goal & depends on

**Goal.** Replace the project-gated GUI shell with a **live-first shell** whose home is the live Claude Code session list (grouped by workspace/cwd, from F1), and whose primary surface is a **session cockpit** — a multi-panel/tab view scoped to one live session and its cwd, opening with the Transcript (exists) and Telemetry (F0) panels. Keep the old project views reachable behind a clearly-marked **Legacy** entry. Define a **cockpit panel registry/contract** so F3 (cwd features) and F4 (session overlay) panels slot in without touching the shell.

**Depends on:**
- **F0 — Surface live telemetry.** Phase 2's Telemetry panel renders the F0 telemetry payload. F0 must land first: it extends `parse.ts`/`reader.ts`/types to retain `model`/`usage`/`gitBranch`, adds the transcript aggregator, exposes `GET /api/claude-sessions/:dir/:id/telemetry`, and adds the `SessionTelemetry` type + `fetchClaudeSessionTelemetry` client. **If F0 has not landed when Phase 2 starts, Phase 2 implements the Telemetry panel against a stubbed client and the panel ships in a "telemetry unavailable" empty state until F0 wires the route** (see Task 8 note). Default assumption: **F0 is done.**
- **F1 — Workspace grouping.** Phase 2's home list is grouped by workspace. F1 adds the cwd→workspace grouping (`GET /api/claude-sessions?groupByCwd=1` or `GET /api/workspaces`) and the `ClaudeWorkspaceGroup` shape. **If F1 has not landed, Phase 2 derives the grouping client-side** from the flat `ClaudeSessionMeta[]` (`projectLabel` = cwd) as a fallback (see Task 3) — so Phase 2 is not hard-blocked, but the canonical grouping moves server-side in F1.
- The existing **live module** (`apps/gui/bridge/claude-sessions/**`, `routes/claude-sessions.ts`, `lib/claude-sessions-client.ts`, `views/claude-sessions-view.tsx`) — Phase 2 reuses the transcript snapshot + SSE tail verbatim; it is **refactored into a panel**, not rewritten.

F0 depends on nothing. F1 depends on F0's reader changes only loosely (grouping needs `lastActivityAt`/`cwd`, already in metadata). The hard ordering for the live-first track is **F0 → F1 → F2**.

---

## 2. Scope

### In scope
- **New live-first shell path** in `app.tsx`: a top-level mode switch between **Live** (default) and **Legacy**. The Live mode renders the new home + cockpit; **no `ProjectPicker` / `activeProjectId` gating governs the Live path.**
- **Workspace-grouped home** (`WorkspaceSessionList`): sessions grouped by cwd, recent-first within each group, live dots (reuse existing `LIVE_WINDOW_MS`), collapsible groups. Consumes F1's grouping (or the client-side fallback).
- **Session cockpit** (`SessionCockpit`): a header (title, cwd label, live badge) + a **panel tab strip** + the active panel body. Scoped to one `{dir, id, cwd}`.
- **Cockpit panel registry/contract** (`cockpit/panel-registry.ts` + `cockpit/panel.ts`): a typed `CockpitPanel` descriptor (`id`, `label`, `scope`, `component`) and an ordered `COCKPIT_PANELS` array. F3/F4 panels are added by appending one descriptor each.
- **Two initial panels**, both read-only:
  - **TranscriptPanel** — extracted from `claude-sessions-view.tsx`'s transcript section (snapshot + SSE tail, auto-scroll).
  - **TelemetryPanel** — renders F0's `SessionTelemetry` (tokens in/out, cache, model mix, turn/tool counts, duration, gitBranch). Read-only.
- **Legacy entry**: the existing project shell (picker + create form + `NAV_GROUPS` Workspace/Tools views) moved behind a `Legacy` mode, reachable from a clearly-labelled toggle. Unchanged internally.
- **Tests**: bridge route tests for any new/changed endpoint Phase 2 calls; component tests for the registry, the home list grouping, the cockpit shell, and both panels; an integration test for the Live↔Legacy switch and select-session→cockpit flow.

### Out of scope (deferred)
- **F0**: telemetry parse/aggregation/route/types. Phase 2 only *consumes* them.
- **F1**: the server-side `/api/workspaces` derivation. Phase 2 consumes it (or falls back client-side).
- **F3**: re-homing index / context / rules / tools / permissions to cwd + overlay store. Phase 2 only reserves their panel *slots* (descriptors are added in F3, not now).
- **F4**: memory/notes, tasks, token-saver session-overlay panels. Slots reserved, added in F4.
- **F5**: deleting `ProjectPicker`/`ProjectCreateForm`/`activeProjectId`/`PROJECT_SCOPED_VIEWS`/`/api/projects*`/the project store tier. Phase 2 keeps them alive under Legacy.
- **`workspaceKey` encoding + overlay store re-key** (F3). Phase 2 keys the home list and cockpit purely on `{dir, id}` + the human cwd label; no overlay paths are written.
- Any **write** to Claude transcripts/metadata or to MegaSaver's overlay store (Phase 2 is read-only).

---

## 3. File-level changes

| Action | Path | Responsibility |
|---|---|---|
| **create** | `apps/gui/src/cockpit/panel.ts` | `CockpitPanel` descriptor type + `CockpitPanelProps` (the props every panel receives: `{ dir, id, cwd }`). The panel contract. |
| **create** | `apps/gui/src/cockpit/panel-registry.ts` | `COCKPIT_PANELS: readonly CockpitPanel[]` — ordered registry. Phase 2 registers `transcript` + `telemetry`. Exposes `getPanel(id)`. |
| **create** | `apps/gui/src/cockpit/session-cockpit.tsx` | `SessionCockpit` — header + tab strip (driven by `COCKPIT_PANELS`) + active panel body. Owns the active-panel-id state. |
| **create** | `apps/gui/src/cockpit/panels/transcript-panel.tsx` | `TranscriptPanel` — snapshot + SSE tail + auto-scroll, extracted from `claude-sessions-view.tsx`. |
| **create** | `apps/gui/src/cockpit/panels/telemetry-panel.tsx` | `TelemetryPanel` — renders `SessionTelemetry` (F0). Stat tiles + model mix. Read-only; empty state when telemetry unavailable. |
| **create** | `apps/gui/src/views/workspace-session-list.tsx` | `WorkspaceSessionList` — the live-first home; sessions grouped by cwd, recent-first, live dots, collapsible groups, `onSelect(session)`. |
| **create** | `apps/gui/src/lib/workspace-grouping.ts` | `groupSessionsByCwd(sessions): ClaudeWorkspaceGroup[]` — client-side fallback grouping (used until F1's server route lands; pure, unit-tested). |
| **modify** | `apps/gui/src/app.tsx` | Add top-level `shellMode: "live" \| "legacy"` state + a header toggle. Live mode renders `WorkspaceSessionList` ↔ `SessionCockpit` (no project gating). Legacy mode renders the *unchanged* existing project shell. |
| **modify** | `apps/gui/src/lib/claude-sessions-client.ts` | Add `fetchClaudeWorkspaces()` (F1 route, behind a typed shape) + re-export the `ClaudeWorkspaceGroup` type. If F0's telemetry client lives here too, re-export `fetchClaudeSessionTelemetry`/`SessionTelemetry`; otherwise import from F0's module. |
| **modify** | `apps/gui/src/views/claude-sessions-view.tsx` | Reduce to a thin wrapper that mounts `WorkspaceSessionList` + `SessionCockpit` (or delete its transcript section, now owned by `TranscriptPanel`). Keep the file as the Legacy "Claude sessions" nav entry until F5. |
| **modify** | `apps/gui/bridge/routes/claude-sessions.ts` | *(only if F1 lands inside Phase 2's window)* add `handleListClaudeWorkspaces(ctx)` consuming a `listWorkspaces` reader fn. If F1 is separate, this row is dropped and Phase 2 uses the client-side fallback. |
| **modify** | `apps/gui/bridge/handler.ts` | *(only if the F1 route is added here)* route `GET /api/workspaces` → `handleListClaudeWorkspaces`. Otherwise unchanged. |
| **create** | `apps/gui/test/components/cockpit-panel-registry.test.tsx` | Asserts the registry exposes `transcript` + `telemetry` in order, `getPanel` resolves/rejects, every descriptor has a stable `id`/`label`/`scope`/`component`. |
| **create** | `apps/gui/test/components/workspace-session-list.test.tsx` | Grouping by cwd, recent-first ordering within a group, live-dot threshold, collapse/expand, `onSelect` fires with the session. |
| **create** | `apps/gui/test/components/session-cockpit.test.tsx` | Renders the tab strip from `COCKPIT_PANELS`, switches active panel on tab click (`aria-current`), passes `{dir,id,cwd}` to the panel. |
| **create** | `apps/gui/test/components/transcript-panel.test.tsx` | Renders snapshot messages, appends a tailed message, shows the stream-interrupted notice on error (uses a stubbed `openClaudeSessionStream`). |
| **create** | `apps/gui/test/components/telemetry-panel.test.tsx` | Renders telemetry tiles + model mix from a fixture; renders the empty state when telemetry is unavailable. |
| **create** | `apps/gui/test/lib/workspace-grouping.test.ts` | Pure unit test for `groupSessionsByCwd` (grouping, ordering, empty input). |
| **create** | `apps/gui/test/integration/live-shell-flow.test.tsx` | Live mode is the default home; toggling to Legacy shows the picker; selecting a session opens the cockpit on the transcript panel; switching to the telemetry tab renders telemetry. Uses a `fetch`/SSE stub. |
| **create** *(conditional)* | `apps/gui/test/bridge/claude-workspaces-route.test.ts` | Only if `GET /api/workspaces` is added in Phase 2: grouped shape, recent-first, archived handling. |

No `packages/core` / `@megasaver/*` changes in Phase 2 — the shell is GUI-only and read-only over the live module. (Core/store re-keying is F3–F5.)

---

## 4. Data model & API changes

### 4.1 Types (GUI)

**Consumed from F0** (defined there; Phase 2 imports, does not redefine):
```ts
// F0 output — shape Phase 2's TelemetryPanel renders.
export type SessionTelemetry = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  models: { model: string; turns: number }[]; // model mix
  turnCount: number;
  toolCallCount: number;
  durationMs: number;       // last turn ts − first turn ts
  gitBranch: string | null; // first/most-common branch
};
```
If F0 has not landed, Phase 2 declares a **local placeholder** of this exact shape in `telemetry-panel.tsx` and renders the empty state; F0 later replaces it with the real import (one-line swap, no panel rewrite).

**Consumed from F1** (or produced by Phase 2's client-side fallback):
```ts
// One workspace = one cwd, with its live sessions newest-first.
export type ClaudeWorkspaceGroup = {
  cwd: string;            // absolute cwd path (the human label)
  label: string;         // display label (basename of cwd, or cwd itself)
  sessions: ClaudeSessionMeta[]; // existing type, sorted by mtimeMs desc
};
```
`ClaudeSessionMeta` is unchanged (`{ dir, id, mtimeMs, size, title, projectLabel }`; `projectLabel` already holds the cwd). **No `workspaceKey` in Phase 2** — that hashing is F3.

**New in Phase 2 (the panel contract):**
```ts
// apps/gui/src/cockpit/panel.ts
export type CockpitPanelScope = "session" | "workspace"; // who the panel is keyed on
export type CockpitPanelProps = {
  dir: string;   // claude-projects subdir (URL segment)
  id: string;    // claude session id (URL segment)
  cwd: string;   // resolved cwd / workspace label for this session
};
export type CockpitPanel = {
  id: string;                 // stable, e.g. "transcript" | "telemetry"
  label: string;              // tab label
  scope: CockpitPanelScope;   // session-scoped vs workspace(cwd)-scoped
  component: (props: CockpitPanelProps) => JSX.Element;
};
```
F3/F4 add panels by appending a `CockpitPanel` to `COCKPIT_PANELS` — the shell needs no edit.

### 4.2 API / endpoints

Phase 2 adds **no new session-scoped route by itself**; it consumes routes F0/F1 own:

| Method + path | Owner | Response | Phase 2 use |
|---|---|---|---|
| `GET /api/claude-sessions?limit&offset` | exists | `ClaudeSessionMeta[]` | home list source (raw, then grouped) |
| `GET /api/claude-sessions/:dir/:id` | exists | `ClaudeTranscript` | transcript snapshot (panel) |
| `GET /api/claude-sessions/:dir/:id/stream` | exists | SSE (`snapshot`, `message`) | transcript live tail (panel) |
| `GET /api/claude-sessions/:dir/:id/telemetry` | **F0** | `SessionTelemetry` | telemetry panel |
| `GET /api/workspaces` *(or `?groupByCwd=1`)* | **F1** | `ClaudeWorkspaceGroup[]` | grouped home list |

**Conditional Phase 2 route** (only if F1's grouping is pulled into this phase): `GET /api/workspaces` →
```ts
// reader.ts addition (cwd grouping over listSessions output, metadata-gated as today)
export async function listWorkspaces(
  root: string, metaDir: string, opts: { limit: number; offset: number },
): Promise<ClaudeWorkspaceGroup[]>;
```
It MUST reuse `listSessions` (so the **untitled/CLI hide rule and `safeSessionPath` containment are unchanged**) and group its results by `projectLabel` (cwd). No new filesystem reach beyond `listSessions`. If `GET /api/workspaces` is added, register a new error code only if a new failure mode appears — it does not; reuse `internal_error`/`route_not_found`. **Default plan: do NOT add this route in Phase 2; consume F1's.**

### 4.3 Store paths / schemas

**None.** Phase 2 writes nothing. No `~/.local/share/megasaver` paths, no `workspaces.json` (that derived cache is F3). The home list and cockpit are pure reads of the live source.

---

## 5. Implementation tasks (TDD)

Conventions for every task: tests first (red → green), ESM `.js` import specifiers, `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`, Biome formatting. Commands run from repo root:
- run a single file: `pnpm --filter @megasaver/gui test -- <path>`
- full suite: `pnpm --filter @megasaver/gui test`
- types: `pnpm --filter @megasaver/gui typecheck`
- lint+format: `npx biome check apps/gui` (`--write` to fix)
- gate: `pnpm verify`

React component tests use `// @vitest-environment jsdom` and `@testing-library/react` (`render`/`screen`/`fireEvent`/`waitFor`), `afterEach(cleanup)` (see `test/components/states.test.tsx`).

---

### Task 1 — Panel contract types (`cockpit/panel.ts`)
**Files:** create `apps/gui/src/cockpit/panel.ts`; create `apps/gui/test/components/cockpit-panel-registry.test.tsx` (type-level assertions live here too via a tiny render).
**Steps:**
1. Write a failing test in `cockpit-panel-registry.test.tsx` that imports `CockpitPanel`/`CockpitPanelProps` and asserts a hand-built descriptor `{ id:"x", label:"X", scope:"session", component: () => <div/> }` type-checks and its `component({dir,id,cwd})` renders.
2. `pnpm --filter @megasaver/gui test -- test/components/cockpit-panel-registry.test.tsx` → expect **fail** (module missing).
3. Implement `panel.ts` exactly as §4.1 (`CockpitPanelScope`, `CockpitPanelProps`, `CockpitPanel`). No logic.
4. Re-run → **pass**. `pnpm --filter @megasaver/gui typecheck`.
5. `npx biome check apps/gui --write`. **Commit:** `feat(gui): add cockpit panel contract types`.

### Task 2 — Panel registry (`cockpit/panel-registry.ts`)
**Files:** create `apps/gui/src/cockpit/panel-registry.ts`; extend `apps/gui/test/components/cockpit-panel-registry.test.tsx`.
**Steps:**
1. Add failing assertions: `COCKPIT_PANELS.map(p => p.id)` equals `["transcript","telemetry"]` (order-locked), `getPanel("transcript")` returns a descriptor, `getPanel("nope")` returns `undefined`, and all ids are unique.
2. Run the file → **fail**.
3. Implement: import the two panel components (Tasks 7–8 stub them first as `() => <div/>` if needed to keep this task independent, then fill in), build the ordered array, `getPanel = (id) => COCKPIT_PANELS.find(p => p.id === id)`.
   *Sketch:*
   ```ts
   import { TelemetryPanel } from "./panels/telemetry-panel.js";
   import { TranscriptPanel } from "./panels/transcript-panel.js";
   import type { CockpitPanel } from "./panel.js";
   export const COCKPIT_PANELS: readonly CockpitPanel[] = [
     { id: "transcript", label: "Transcript", scope: "session", component: TranscriptPanel },
     { id: "telemetry", label: "Telemetry", scope: "session", component: TelemetryPanel },
   ];
   export function getPanel(id: string): CockpitPanel | undefined {
     return COCKPIT_PANELS.find((p) => p.id === id);
   }
   ```
4. Run → **pass**; typecheck; biome. **Commit:** `feat(gui): add cockpit panel registry`.

### Task 3 — Client-side cwd grouping (`lib/workspace-grouping.ts`)
**Files:** create `apps/gui/src/lib/workspace-grouping.ts`; create `apps/gui/test/lib/workspace-grouping.test.ts` (pure, no jsdom).
**Steps:**
1. Failing unit test: given `ClaudeSessionMeta[]` with mixed `projectLabel` (cwd) and `mtimeMs`, `groupSessionsByCwd` returns one `ClaudeWorkspaceGroup` per distinct cwd, **groups ordered by their newest session's mtime desc**, **sessions within a group sorted mtime desc**, `label` = `basename(cwd)` (fallback to cwd when empty), empty input → `[]`.
2. Run → **fail**.
3. Implement pure grouping. *Sketch:*
   ```ts
   export function groupSessionsByCwd(sessions: ClaudeSessionMeta[]): ClaudeWorkspaceGroup[] {
     const byCwd = new Map<string, ClaudeSessionMeta[]>();
     for (const s of sessions) {
       const cwd = s.projectLabel || "(unknown)";
       const list = byCwd.get(cwd) ?? [];
       list.push(s);
       byCwd.set(cwd, list);
     }
     const groups = [...byCwd.entries()].map(([cwd, list]) => {
       list.sort((a, b) => b.mtimeMs - a.mtimeMs);
       return { cwd, label: labelFor(cwd), sessions: list };
     });
     groups.sort((a, b) => (b.sessions[0]?.mtimeMs ?? 0) - (a.sessions[0]?.mtimeMs ?? 0));
     return groups;
   }
   ```
   `labelFor` takes the last non-empty path segment (`noUncheckedIndexedAccess`: guard the `split` result). `ClaudeWorkspaceGroup` lives in the client module (§4.1) and is imported here.
4. Run → **pass**; typecheck; biome. **Commit:** `feat(gui): add client-side cwd session grouping`.

### Task 4 — Workspace client fns (`lib/claude-sessions-client.ts`)
**Files:** modify `apps/gui/src/lib/claude-sessions-client.ts`; reuse `test/lib/workspace-grouping.test.ts` or add a focused client test if F1's route is in-scope.
**Steps:**
1. Add a failing test (only if `GET /api/workspaces` is wired this phase): `fetchClaudeWorkspaces()` calls `/api/workspaces` and parses `ClaudeWorkspaceGroup[]`. If F1 owns the route, **skip the network fn** and just export the `ClaudeWorkspaceGroup` type for the fallback path.
2. Run → **fail** (or N/A).
3. Implement: export `ClaudeWorkspaceGroup`; add `fetchClaudeWorkspaces()` mirroring `fetchClaudeSessions` (reuse the private `getJson`). Keep the fallback (`groupSessionsByCwd(await fetchClaudeSessions(...))`) as the default until F1 lands.
4. Run → **pass**; typecheck; biome. **Commit:** `feat(gui): add workspace grouping client surface`.

### Task 5 — Transcript panel (`cockpit/panels/transcript-panel.tsx`)
**Files:** create `apps/gui/src/cockpit/panels/transcript-panel.tsx`; create `apps/gui/test/components/transcript-panel.test.tsx`.
**Steps:**
1. Failing jsdom test: stub `openClaudeSessionStream` (via `vi.mock` of the client module) to call `onSnapshot({projectLabel, messages:[…]})`, then `onMessage(extra)`; assert both render; trigger `onError` and assert the "Live stream interrupted" notice appears. Pass props `{dir,id,cwd}`.
2. Run → **fail**.
3. Implement by **extracting** the transcript `<section>` + the two effects (open stream on `{dir,id}` change; auto-scroll on `messages`) from `claude-sessions-view.tsx`. Signature: `TranscriptPanel({ dir, id }: CockpitPanelProps)`. No list/selection logic — selection now lives in `WorkspaceSessionList`. Keep `streamError` handling and the `scrollRef` auto-scroll effect (with its existing `biome-ignore useExhaustiveDependencies`).
4. Run → **pass**; typecheck; biome. **Commit:** `refactor(gui): extract transcript into a cockpit panel`.

### Task 6 — Telemetry panel (`cockpit/panels/telemetry-panel.tsx`)
**Files:** create `apps/gui/src/cockpit/panels/telemetry-panel.tsx`; create `apps/gui/test/components/telemetry-panel.test.tsx`.
**Steps:**
1. Failing jsdom test: stub the telemetry fetch (F0's `fetchClaudeSessionTelemetry`, or the local placeholder fetch) to resolve a `SessionTelemetry` fixture; assert tiles for input/output/cache tokens, turn/tool counts, duration, and a model-mix row render; second test: fetch rejects/returns nothing → empty state ("Telemetry unavailable.") renders. **No success claim mixing transcript tokens with proxy savings** — label tiles "LLM context tokens" to honour §6.1 of the architecture doc.
2. Run → **fail**.
3. Implement: a small fetching component (mirror `ContextView`'s `idle/loading/ready/error` pattern) that renders `Stat` tiles (reuse the local `Stat` pattern from `context-view.tsx`; do not over-abstract — a 3-tile copy is fine per §8 conventions) + a model-mix list. Read-only; no inputs. Empty state via existing `EmptyState`. **If F0 not landed:** the fetch is the placeholder that always yields "unavailable" — the panel still ships.
4. Run → **pass**; typecheck; biome. **Commit:** `feat(gui): add session telemetry cockpit panel`.

### Task 7 — Session cockpit shell (`cockpit/session-cockpit.tsx`)
**Files:** create `apps/gui/src/cockpit/session-cockpit.tsx`; create `apps/gui/test/components/session-cockpit.test.tsx`.
**Steps:**
1. Failing jsdom test: render `<SessionCockpit dir id cwd onBack />`; assert one tab button per `COCKPIT_PANELS` entry (names "Transcript","Telemetry"); default active = first panel (`aria-current="page"`); clicking "Telemetry" moves `aria-current` and renders the telemetry body; a "Back" control invokes `onBack`. Stub both panels' network deps.
2. Run → **fail**.
3. Implement: `activePanelId` state (default `COCKPIT_PANELS[0]?.id`), header (cwd label + session title + live badge optional), tab strip mapped from `COCKPIT_PANELS` (mirror `app.tsx`'s nav-button class/`aria-current` pattern), body = `getPanel(activePanelId)?.component({dir,id,cwd})`. `onBack` returns to the home list.
4. Run → **pass**; typecheck; biome. **Commit:** `feat(gui): add session cockpit shell`.

### Task 8 — Workspace-grouped home (`views/workspace-session-list.tsx`)
**Files:** create `apps/gui/src/views/workspace-session-list.tsx`; create `apps/gui/test/components/workspace-session-list.test.tsx`.
**Steps:**
1. Failing jsdom test: stub `fetchClaudeSessions` (or `fetchClaudeWorkspaces`) to return sessions across two cwds; assert two group headings (basenames), sessions newest-first under each, the live dot on a session within `LIVE_WINDOW_MS`, a collapse toggle hides a group's sessions, and clicking a session calls `onSelect(session)`. Reuse the polling/`relativeTime` logic from `claude-sessions-view.tsx`.
2. Run → **fail**.
3. Implement: list state machine (`loading/ready/error` like the existing view), poll every `LIST_POLL_MS`, group via `groupSessionsByCwd` (or consume F1 groups directly), render collapsible group sections + the existing session button markup, `onSelect(s)`. Keep `LoadingState`/`ErrorState`. Lift the live-dot + `relativeTime` helpers (move `relativeTime` to a shared spot or copy — copy is acceptable per §8 "3 similar lines > premature abstraction").
4. Run → **pass**; typecheck; biome. **Commit:** `feat(gui): add workspace-grouped live session home`.

### Task 9 — Shell mode switch in `app.tsx`
**Files:** modify `apps/gui/src/app.tsx`; create `apps/gui/test/integration/live-shell-flow.test.tsx`.
**Steps:**
1. Failing integration test (jsdom, `fetch` stub returning claude-sessions + a transcript snapshot via SSE stub): on mount, Live mode is active and `WorkspaceSessionList` renders (no "Pick a project" gate); a header control toggles to **Legacy** and the project picker/`NoProjectState` appears; back in Live, selecting a session renders `SessionCockpit` on the Transcript panel; clicking the Telemetry tab renders telemetry.
2. Run → **fail**.
3. Implement: add `shellMode` state (default `"live"`), a header toggle (two buttons or a segmented control, `aria-current`). Live branch: `selectedSession ? <SessionCockpit …onBack={() => setSelectedSession(null)} /> : <WorkspaceSessionList onSelect={setSelectedSession} />` — **the existing `projects`/`activeProjectId` effects and `PROJECT_SCOPED_VIEWS` gating run only in the Legacy branch.** Legacy branch: the *current* shell body verbatim (sidebar `NAV_GROUPS`, picker, `ActiveView`). Do not delete any legacy code (§13 / F5 owns deletion).
   - Keep the existing `claude-sessions` nav entry working in Legacy (it can mount the same `WorkspaceSessionList`/cockpit or stay as-is).
4. Run → **pass**; full `pnpm --filter @megasaver/gui test`; typecheck; biome. **Commit:** `feat(gui): add live-first shell with legacy fallback`.

### Task 10 *(conditional — only if F1 route is in Phase 2)* — `GET /api/workspaces`
**Files:** modify `apps/gui/bridge/claude-sessions/reader.ts` (+ `types.ts` for `ClaudeWorkspaceGroup`), `apps/gui/bridge/routes/claude-sessions.ts`, `apps/gui/bridge/handler.ts`; create `apps/gui/test/bridge/claude-workspaces-route.test.ts`.
**Steps:**
1. Failing bridge test (mirror `claude-sessions-route.test.ts`: seed `ccRoot`/`metaRoot`, two sessions in two cwds via `writeMeta` with distinct `cwd`): `GET /api/workspaces` → `200`, grouped by cwd, groups newest-first, untitled sessions still hidden. Add a `405` test for non-GET.
2. Run → **fail**.
3. Implement `listWorkspaces` = `groupByCwd(await listSessions(...))` in `reader.ts` (reusing `listSessions` so the metadata-gate + path safety are inherited), `handleListClaudeWorkspaces` in the route module (mirror `handleListClaudeSessions`, same `sendReadError`), and the `path === "/api/workspaces"` branch in `handler.ts`.
4. Run → **pass**; `pnpm --filter @megasaver/gui test`; typecheck; biome. **Commit:** `feat(gui): serve cwd-grouped workspaces from the bridge`.
   *Default: skip Task 10; F1 owns this route and Phase 2 consumes it.*

### Task 11 — Wire claude-sessions-view as Legacy entry (cleanup)
**Files:** modify `apps/gui/src/views/claude-sessions-view.tsx`.
**Steps:**
1. After Task 5 extracted the transcript, reduce `ClaudeSessionsView` to compose `WorkspaceSessionList` + `SessionCockpit` (so the Legacy "Claude sessions" nav still works and there's no duplicated transcript code). Existing `claude-sessions-route.test.ts` and any view test stay green — run them.
2. `pnpm --filter @megasaver/gui test`; typecheck; biome. **Commit:** `refactor(gui): rebuild claude-sessions view on cockpit parts`.

---

## 6. Risks & decisions (this phase)

1. **F0/F1 ordering.** Cleanest if F0+F1 land first. **Decision:** Phase 2 ships behind graceful fallbacks — Telemetry panel renders an "unavailable" empty state without F0; the home groups client-side without F1. Neither fallback blocks the shell, and each is a one-line swap to the real source. Risk: shipping both fallbacks then re-touching them — accepted, because the architecture doc's stated order is F0→F1→F2 and the fallbacks are tiny.
2. **Don't break Legacy.** The whole project shell must keep working under the Legacy mode (F5 deletes it, not Phase 2). **Decision:** wrap, never edit, the legacy branch; the existing integration tests (`app-flow.test.tsx`, `picker-cascade.test.tsx`) must stay green and are run in Task 9. If they assert "default view = Overview", update them to assert "Legacy mode → Overview" rather than deleting coverage.
3. **Transcript double-mount / SSE leak.** `TranscriptPanel` opens an `EventSource`; switching tabs must dispose it. **Decision:** the open-stream effect's cleanup (`return dispose`) already disposes on unmount; the cockpit unmounts the inactive panel (only the active panel's component is rendered), so switching tabs disposes the stream. Test covers tab-switch.
4. **`noUncheckedIndexedAccess` on grouping/registry.** `groups[0]`, `split().pop()`, `COCKPIT_PANELS[0]` are all `T | undefined`. **Decision:** guard every index/`pop` (use `?? fallback`); the sketches already do.
5. **Telemetry vs proxy savings confusion (architecture §6.1).** **Decision:** Telemetry tiles are labelled "LLM context tokens"; the token-saver/proxy savings panel is F4 and is *not* added here, so no user can conflate them in Phase 2.
6. **Untitled/CLI hide rule (locked §7.4).** Any grouping path MUST flow through `listSessions` so the metadata gate stays. **Decision:** both the client fallback (`groupSessionsByCwd(await fetchClaudeSessions())`) and the optional `listWorkspaces` reader build on `listSessions` — the hide rule is inherited, never re-implemented.
7. **Security / path safety (architecture §6).** Phase 2 adds no new filesystem reach — it reuses the existing routes/`safeSessionPath`. The only conditional bridge addition (Task 10) wraps `listSessions` and introduces no new path input. **Decision:** no new `safeSessionPath` surface in Phase 2.

---

## 7. Definition of done

Per `CLAUDE.md` §9 (MEDIUM risk → full chain + `code-reviewer`):

1. **Spec + plan exist** (this doc; plan rows in §5 act as the executable plan, or a sibling `docs/superpowers/plans/2026-06-14-live-first-phase2-session-cockpit-plan.md` if `writing-plans` produces one).
2. **TDD honoured** — every task wrote a failing test before code (red→green evidence captured per task).
3. **`pnpm verify` green** — Biome (lint+format), `tsc -b --noEmit` (+ `tsconfig.test.json`), full Vitest run. No `claude-sessions-route.test.ts` / `app-flow.test.tsx` regressions.
4. **Feature smoke evidence (live):**
   - Run `pnpm --filter @megasaver/gui dev`, open the app: Live mode is the home, sessions appear **grouped by cwd** with live dots against **real `~/.claude/projects` data**.
   - Select a session → cockpit opens on **Transcript**, which live-tails the real transcript (append a message in a real Claude session, see it stream in).
   - Switch to **Telemetry** → tiles render from the F0 route (or the documented "unavailable" empty state if F0 not yet landed).
   - Toggle **Legacy** → the project picker + existing views still work unchanged.
   - Capture a short screen recording / screenshots as evidence (no fabricated numbers; tiles show real transcript-derived values).
5. **Read-only proof** — confirm no writes to `~/.claude/**` or `~/.local/share/megasaver/**` during the smoke (e.g. `ls -la --time-style=full` mtime check before/after, or `fs` watch). Phase 2 must touch neither.
6. **External review** — `code-reviewer` pass in a fresh context (author ≠ reviewer, §13). Focus: legacy preserved, SSE disposal correct, grouping ordering, telemetry labelling, panel-registry extension contract.
7. **Verifier pass** (`omc:verify`) on the evidence above.
8. **Zero pending TodoWrite items**; no changeset needed (no public package API changed — GUI app only); `CLAUDE.md`/conventions untouched (no convention change).
