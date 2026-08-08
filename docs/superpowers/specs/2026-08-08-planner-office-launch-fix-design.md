---
feature: planner-office-launch-fix
date: 2026-08-08
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "2 of 5 (2026-08-08 self-audit batch)"
---

# Planner ↔ Agent Office Launch Fix — make "Launch Task" actually launch

## Problem

The Planner Kanban board (`docs/superpowers/plans/2026-08-07-project-planner-kanban-plan.md`
Task 7) ships an "Agent Office Launch Modal" on every card
(`apps/gui/src/components/planner/agent-office-launch-modal.tsx`) that
lets the user pick a role and click "Launch Task." Tracing the full
request path from that button to a running agent process surfaces
**three independent breaks**, any one of which alone would make the
feature inert; all three are present today:

1. **Wrong workspace identifier.** The modal POSTs to
   `/api/office/${encodeURIComponent(cwd)}/agents/${roleId}/tasks`
   (`agent-office-launch-modal.tsx:19`) — `cwd` is a raw filesystem
   path (e.g. `/Users/x/project`), passed straight from
   `PlannerPage`'s `cwd` variable
   (`planner-page.tsx:13`, `card-drawer.tsx`→modal `cwd={cwd}` prop).
   But every Office route validates its path segment with
   `validateWk` → `workspaceKeySchema.safeParse(wk)`
   (`apps/gui/bridge/routes/office.ts:100-107`), which requires
   **16 lowercase hex characters** (`workspace-key.ts:7`) — the
   output of `encodeWorkspaceKey(cwd)`, never the raw path. Every
   launch request 400s with `"invalid workspace key"` before it
   reaches any agent logic. `PlannerPage` already has the correct
   value one property away: `activeWorkspace.key`
   (`workspace-context.ts:6`, populated by `deriveWorkspaceOptions`)
   — it is simply never threaded into the modal.
2. **Fabricated role/agent identifiers.** Even with a valid
   workspace key, the URL's second segment must be a real
   `OfficeAgentId` — `officeAgentIdSchema` is a **branded lowercase
   UUID** (`packages/shared/src/ids.ts:47`, same `lowercaseUuid`
   base as every other id in the schema file), i.e. the id of an
   `OfficeAgent` record already created via `POST
   /api/office/:wk/agents` and persisted under
   `office/<wk>/agents/<id>.json`. The modal's `<select>` instead
   hardcodes four **role-shaped strings**
   (`"builder"`, `"claude-code"`, `"architect"`, `"reviewer"` —
   `agent-office-launch-modal.tsx:67-70`) that are neither valid
   UUIDs nor even real `RoleId`s (`roleIdSchema` is ALSO a branded
   UUID, per `ids.ts:44` — `listRoles`/`predefined-roles.ts` seed
   roles with real generated UUIDs, none of which spell "builder").
   `officeAgentIdSchema.safeParse("builder")` always fails →
   `404 office_not_found` on every single launch attempt, workspace
   key aside. There is currently no agent-selection UI in the modal
   at all — a workspace's real, already-created `OfficeAgent`s
   (visible on the separate Agent Office floor view,
   `office-floor.tsx`) are never fetched or offered here.
3. **Even a task that reaches `POST .../tasks` never runs.**
   `handleCreateTask` (`apps/gui/bridge/routes/office.ts:294-337`)
   does exactly one thing: `officeTaskSchema.parse({ …, status:
   "queued" })` then `saveTask(...)`. It never calls
   `scheduleDrain`/`buildAndDrain`/`createSupervisor(...).drainAgent`
   — the exact mechanism `handleRunAgent` (`office.ts:344-372`) and
   `handleChat` (`office.ts:434-511`) both use immediately after
   their own writes. A task created this way sits in `"queued"`
   forever unless the user separately visits the Agent Office floor
   and clicks "Run" on that agent by hand. The modal's success
   message — `alert("Task launched in Agent Office.")`
   (`card-drawer.tsx:239`) — is therefore false today even for a
   hypothetically-valid request: nothing launches.

Net effect: the flagship "Kanban card → autonomous agent" loop the
planner plan's Task 7 exists to deliver has never worked, for three
independently-sufficient reasons, and nothing in the existing test
suite caught it — `rg` finds no test file for
`agent-office-launch-modal.tsx` and no integration test that drives a
planner card through to a running Office task.

## Goal

Make "Launch Task" on a planner card actually: (a) resolve the real
workspace key, (b) let the user pick from the workspace's real,
already-created Office agents (or create one inline if none exist),
(c) queue the task AND schedule its drain in the same request path
`handleRunAgent`/`handleChat` already use, and (d) reflect the true
outcome back on the card (which agent, current task status) instead
of a fire-and-forget `alert()`.

## Non-Goals

- No change to `handleCreateTask`'s general contract (still
  queue-only) — other callers of `POST .../tasks` may intentionally
  want queue-without-run semantics (e.g. batch-queuing before a
  single `mega office run`). This spec adds a **new**, explicit
  "queue and run" path rather than silently changing the existing
  endpoint's behavior for all callers (Locked Decision 3).
- No new agent-role taxonomy, no changes to `predefined-roles.ts` or
  the seeded role set — the modal consumes whatever roles/agents
  already exist in the workspace.
- No automatic agent creation without user confirmation — if a
  workspace has zero Office agents, the modal offers an explicit
  "create an agent first" affordance (reusing the existing
  `createAgent` call the Agent Office floor already uses), never a
  silent implicit creation.
- No change to `createSupervisor`, `drainAgent`, or any
  `@megasaver/agent-office` engine code — the engine already works
  (proven by the Agent Office floor's own "Run" button); this spec
  only fixes the planner's NEW, broken entry path into that engine.
- No change to the CLI (`mega office run`/`assign`) — CLI-side Office
  commands are unaffected; this is a GUI-only wiring fix.

## Locked Decisions

1. **`AgentOfficeLaunchModal` receives `workspaceKey`, not `cwd`.**
   `PlannerPage` already computes `activeWorkspace` (`planner-page.tsx:12`)
   with a `.key` field; `CardDrawer` gains a `workspaceKey: string`
   prop threaded from `PlannerPage` → `CardDrawer` → the modal,
   alongside the existing `cwd` (kept for display/context text only,
   never used in a URL again). The modal's fetch calls switch to
   `/api/office/${encodeURIComponent(workspaceKey)}/...` throughout.
2. **The modal fetches real agents via the existing
   `fetchAgents(wk)`** (`apps/gui/src/lib/office-client.ts:93-95`,
   already used by `agent-board.tsx` and `office-floor.tsx` — no new
   client function). The hardcoded `<select>` options are replaced
   with the workspace's actual `OfficeAgent[]`, rendered as
   `${agent.name} (${agent.status})`. **Empty state:** zero agents →
   the modal shows "No agents in this workspace yet" plus a "Create
   one" button that opens the SAME inline create-agent flow
   `agent-board.tsx` already has (`createAgent(wk, input)` —
   `office-client.ts:97-99`), reusing its role-fetch
   (`fetchRoles()`) to populate a role dropdown for the new agent.
   This reuses two already-shipped, already-tested client functions
   rather than inventing a new creation path.
3. **New endpoint: `POST /api/office/:wk/agents/:agentId/launch`**
   (NOT a change to the existing `.../tasks` endpoint — Non-Goal
   above). Body: `{ instruction: string }` (same shape
   `taskCreateInputSchema` already validates). Behavior: identical to
   `handleCreateTask`'s validation + `officeTaskSchema.parse` +
   `saveTask`, PLUS one line calling `scheduleDrain(ctx, wk,
   agentIdParse.data)` before responding — the exact call
   `handleRunAgent` makes at `office.ts:368`. Response: `202` with
   the created `OfficeTask` (not the agent — the caller already knows
   the agent; the task is the new state the caller needs to poll).
   A dedicated endpoint (rather than a `?run=true` query flag on the
   existing route) keeps `handleCreateTask`'s contract untouched and
   gives the new "queue+run" semantic its own explicit, testable
   surface — consistent with how `handleRunAgent` and `handleChat`
   are already separate endpoints from `handleCreateTask` rather than
   flags on it.
4. **The modal's launch call becomes:** POST to the new
   `.../launch` endpoint via a new `office-client.ts` function
   `launchTask(wk: string, agentId: string, instruction: string):
   Promise<OfficeTask>` (mirrors `assignTask`'s exact shape at
   `office-client.ts:113-120`, minimal diff). On success, `onLaunched`
   now receives the created `OfficeTask` (signature change:
   `onLaunched: (task: OfficeTask) => void`) so `CardDrawer` can show
   a real status instead of a static `alert()`.
5. **`CardDrawer`'s post-launch UI**: replace
   `alert("Task launched in Agent Office.")` with an inline banner —
   "Launched on `<agent.name>` — status: queued" — that the drawer
   already has state machinery for (it re-renders on `loadBoard`
   refresh, per `planner-page.tsx:24-44`); no new polling loop is
   added (Non-Goal-adjacent YAGNI — the Agent Office floor is the
   canonical place to watch live task progress; the planner card
   only needs to confirm the launch succeeded, not stream status).
6. **`assignedAgent` on the card is set to the real agent's id on
   successful launch** (`writePlannerCard` already accepts
   `assignedAgent: string | null` per `plannerCardFrontmatterSchema`,
   `packages/core/src/planner/schema.ts:22`) — today the field exists
   but the modal never writes to it beyond the local `roleId` state
   default (`agent-office-launch-modal.tsx:11`, read-only). This
   makes a card's "who is working on this" durable and visible in the
   Kanban grid, not just inside the modal's own transient state.

## Architecture

```
apps/gui/src/views/planner-page.tsx        (passes workspaceKey down, unchanged cwd for display)
  -> apps/gui/src/components/planner/card-drawer.tsx          (passes workspaceKey to modal; renders launch outcome banner)
       -> apps/gui/src/components/planner/agent-office-launch-modal.tsx   (fetchAgents/fetchRoles/createAgent; calls launchTask)
            -> apps/gui/src/lib/office-client.ts        launchTask() [new], fetchAgents/fetchRoles/createAgent [reused]
                 -> apps/gui/bridge/handler.ts            new route: POST /api/office/:wk/agents/:agentId/launch
                      -> apps/gui/bridge/routes/office.ts    handleLaunchTask() [new] = handleCreateTask's body + scheduleDrain
```

No new package dependencies; no new workspace-graph edges. All
touched files already exist and already import everything this
feature needs (`officeTaskSchema`, `saveTask`, `scheduleDrain` are
all already in `office.ts`'s own module scope).

## Components

1. **`handleLaunchTask(ctx, wk, agentId)`** (new,
   `apps/gui/bridge/routes/office.ts`) — copy `handleCreateTask`'s
   body verbatim through the `saveTask` call, then add
   `scheduleDrain(ctx, wk, agentIdParse.data);` immediately after
   (mirroring the exact line/position `handleRunAgent` uses at
   `office.ts:368`), then `ctx.sendJson(ctx.res, 202, task,
   ctx.origin)` (202, not 201 — the resource is accepted AND already
   being processed, matching `handleRunAgent`'s own 202 for the same
   "started async work" semantic).
2. **Route registration** (`apps/gui/bridge/handler.ts`) — a new
   regex match alongside the existing
   `/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/tasks$/`
   (`handler.ts:633`): `/^\/api\/office\/([^/]+)\/agents\/([^/]+)\/launch$/`,
   `POST`-only, dispatching to `handleLaunchTask`.
3. **`launchTask(wk, agentId, instruction)`** (new,
   `apps/gui/src/lib/office-client.ts`) — one-line wrapper matching
   `assignTask`'s exact shape:

```ts
export function launchTask(wk: string, agentId: string, instruction: string): Promise<OfficeTask> {
  return postJson<OfficeTask>(
    `/api/office/${encodeURIComponent(wk)}/agents/${encodeURIComponent(agentId)}/launch`,
    { instruction },
  );
}
```

4. **`AgentOfficeLaunchModal` rewrite** — props become `{ card,
   workspaceKey, onClose, onLaunched: (task: OfficeTask) => void }`
   (drop unused `cwd` from this component's own props — the caller
   keeps `cwd` for its own display text). On mount, `fetchAgents(workspaceKey)`;
   render the result as the `<select>` options (id = value, `${name}
   (${status})` = label); track `selectedAgentId` instead of `roleId`.
   Zero-agents state renders the create-agent sub-form (role dropdown
   from `fetchRoles()`, name text input, `createAgent(workspaceKey,
   {...})` on submit, then re-fetch agents and auto-select the new
   one). `handleLaunch` calls `launchTask(workspaceKey,
   selectedAgentId, prompt)`.
5. **`CardDrawer` update** — new `workspaceKey` prop; passes it to the
   modal; `onLaunched` handler now does: `setLaunchedTask(task);
   setLaunchModalOpen(false);` then (via the existing patch-card path,
   reusing whatever function already calls `PATCH /api/planner/card`)
   persists `assignedAgent: selectedAgentId` onto the card so the
   Kanban grid reflects it; renders a dismissable inline banner from
   `launchedTask` state instead of the removed `alert()`.
6. **`PlannerPage` → `CardDrawer` wiring** — pass
   `workspaceKey={activeWorkspace?.key ?? ""}` alongside the existing
   `cwd={cwd}` prop; guard the "Launch" entry point (button that opens
   the modal) so it is disabled with a tooltip when `workspaceKey` is
   empty (mirrors the existing `if (!cwd) return;` guards already
   throughout this file for the same "no active workspace" case).

## Error handling

- `handleLaunchTask` reuses every one of `handleCreateTask`'s
  existing error branches unchanged (`guardOffice`, `validateWk`,
  `officeAgentIdSchema.safeParse` → 404, body parse failure → 400,
  `taskCreateInputSchema` validation → 400 with issue detail). The
  only new failure mode is `scheduleDrain` itself, which — per its
  own doc comment (`office.ts:414-423`) — already swallows its
  supervisor errors into `console.error` and never rejects the
  chained promise the route awaits nothing on (`scheduleDrain` is
  fire-and-forget by design; the route does not await the drain
  itself, only the save). No new try/catch needed at the route level.
- Modal-side: `fetchAgents`/`fetchRoles`/`createAgent`/`launchTask`
  failures each set a local error string state (mirrors
  `agent-board.tsx`'s existing `mutError` pattern) rather than a
  blocking `alert()` — consistent with the rest of the Office UI's
  existing error surface convention, and directly fixes the silent
  swallow the modal has today (`catch { alert(...) }` with no detail).
- A `409` from `handleChat`'s existing paused/stopped/error guard
  does NOT apply here (that check is `handleChat`-specific business
  logic for resuming a conversation) — `handleLaunchTask` does not
  duplicate it; `scheduleDrain`'s underlying `drainAgent` already
  no-ops safely on a non-runnable agent (same guarantee
  `handleRunAgent` relies on for its own fast-path check), so a
  launch onto a paused agent queues the task and simply waits without
  erroring — an acceptable, already-proven behavior reused as-is.

## Security & privacy

- No new trust boundary: `handleLaunchTask` runs the exact same
  policy-gated, workspace-scoped `createSupervisor`/`drainAgent` path
  every other Office launch trigger already uses (loopback-only bind,
  same token auth as the rest of `mega gui`). No new command
  execution surface — the launcher registry and permission resolution
  (`resolveLauncherPermission`) are unchanged.
- The task `instruction` field is the card's title + full markdown
  content verbatim (`agent-office-launch-modal.tsx:16`, unchanged) —
  same trust level as any other free-text Office task instruction
  today (a user-authored planner card, not external/untrusted input).

## Testing

| Unit | Test |
|---|---|
| `handleLaunchTask` | valid workspace + valid existing agent → 202 with `status: "queued"` task AND `scheduleDrain` was called (spy-asserted, mirrors any existing `handleRunAgent` test's spy pattern) |
| `handleLaunchTask` | invalid workspace key → 400; unknown agent id → 404; malformed body → 400 with issue detail — three tests mirroring `handleCreateTask`'s existing coverage for the same three cases |
| route registration | `POST /api/office/<wk>/agents/<id>/launch` dispatches to the new handler; a GET to the same path 404s/405s per the existing router's convention for the sibling `.../tasks` route |
| `launchTask` client fn | posts the right URL + body shape (mirrors any existing `assignTask` test) |
| `AgentOfficeLaunchModal` | renders real fetched agents, not the four hardcoded strings; zero-agents state renders the create-agent sub-form; `handleLaunch` calls `launchTask` with the selected agent's real id, never a role string |
| `CardDrawer` | `onLaunched(task)` renders the status banner (not `window.alert`, spy-asserted absent) and triggers a card patch setting `assignedAgent` |
| end-to-end bridge test | new `apps/gui/test/bridge/office-launch.test.ts`: seed a workspace + one real agent via the existing `createAgent`/`saveAgent` test helpers, POST to `.../launch`, assert the task transitions past `"queued"` within the test's existing supervisor-mocking convention (check `apps/gui/test/bridge/office-route.test.ts` — if one exists — for how `drainAgent`/launcher is faked in tests, and reuse that exact seam rather than inventing a new one) |

No timing-tight tests; supervisor completion is asserted via the
existing test seam for faking/awaiting a drain (to be confirmed
against whatever `apps/gui/test/bridge/*office*` already uses during
Task 1 of the plan — this spec does not invent a new async-test
pattern if a working one already exists in this test directory).

## Risk & process

**MEDIUM.** This wires an existing, already-reviewed engine
(`createSupervisor`/`drainAgent`, already exercised in production via
the Agent Office floor's "Run" and "Chat" buttons) to a second,
currently-broken entry point. No new spawning logic, no new
permission model, no change to what agents are allowed to do once
launched — only fixing HOW a planner card reaches the existing
launch mechanism. Escalation trigger: if implementation surfaces a
need to change `resolveLauncherPermission`, `allowFull` semantics, or
anything in `packages/agent-office/src/supervisor.ts` itself, STOP
and re-classify HIGH per `docs/conventions/risk-modes.md` ("connector
core path" / spawning-adjacent). Required reviewer: `code-reviewer`.
Regression evidence: the Agent Office floor's existing "Run"/"Chat"
flows are untouched (`handleRunAgent`/`handleChat` bodies are not
modified, only read as the pattern to copy); full `pnpm verify` green.

## Dependencies / build order

Independent of `2026-08-08-gui-pro-analytics-live-wire` (build 1) —
no shared files. Should land before or independently of the planner
plan's own Task 7 if that task is still unmerged/in-flight elsewhere
(check `git log` on the planner branch before starting Task 1 of this
plan, per the handoff note precedent in this repo's session history —
redoing already-fixed work wastes a review cycle).
