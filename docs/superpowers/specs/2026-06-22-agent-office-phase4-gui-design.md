---
title: Agent Office Phase 4 — GUI office board + role manager
status: draft
risk: medium
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
parent_spec: docs/superpowers/specs/2026-06-22-agent-office-design.md
---

# Agent Office Phase 4 — GUI

## Summary

Add the `agent-office` GUI view: a control room where the user manages roles,
creates/removes agents per workspace, assigns tasks, runs/pauses/stops them, and
sees what each agent is doing — consuming the Phase 3 `/api/office/*` API.

## Scope (`apps/gui/src`)

1. Register the `agent-office` view (`view-id.ts`, `app.tsx` nav + render).
2. API client methods + SSE wrapper for `/api/office/*` (`lib/office-client.ts`).
3. Components: `AgentOfficeView` (container), `RoleManager`, `AgentBoard` +
   `AgentCard`, `AssignTaskForm` / task queue.
4. Component tests (RTL + fetch stub, mirroring
   `test/components/memory-graph-panel.test.tsx`).

## Non-goals

- No new bridge routes / engine changes (Phase 3 API is the contract).
- No raw claude transcript streaming (office-native status/SSE only).
- No bespoke visual-design system pass — match the existing utilitarian GUI
  (tailwind tokens in `styles/tokens.css`, the two-pane / card patterns already
  in `views/`). A dedicated design polish (huashu/taste) is a noted follow-up.

## Risk

MEDIUM (UI calling the already-validated Phase 3 API; no spawn logic here).
Reviews: code-reviewer + critic (UI-focused). Tests stub `fetch`/SSE — no real
bridge, no real claude.

## §1 View registration

- `view-id.ts`: add `"agent-office"` to `VIEW_IDS` (alphabetical → first) and
  `VIEW_LABELS` (`"Agent office"`).
- `app.tsx`: add `"agent-office"` to `NAV_VIEWS`; render `<AgentOfficeView/>`
  when `view === "agent-office"` (it manages its own state; clears `selected`
  like other non-session views).

## §2 Office API client (`lib/office-client.ts`)

Use the existing `getJson`/`postJson` helpers (export them from `api-client.ts`
or replicate the tiny wrappers). Add a DELETE helper. Methods + response types:

- `fetchRoles(): Promise<Role[]>` → `GET /api/office/roles`
- `createRole(input): Promise<Role>` → `POST /api/office/roles`
- `deleteRole(roleId): Promise<void>` → `DELETE /api/office/roles/:id` (204)
- `fetchAgents(wk): Promise<OfficeAgent[]>`
- `createAgent(wk, input): Promise<OfficeAgent>`
- `deleteAgent(wk, agentId): Promise<void>`
- `fetchTasks(wk, agentId): Promise<OfficeTask[]>`
- `assignTask(wk, agentId, instruction): Promise<OfficeTask>`
- `runAgent(wk, agentId): Promise<OfficeAgent>` (202)
- `controlAgent(wk, agentId, action): Promise<OfficeAgent>`
- `fetchAudit(wk): Promise<AuditEvent[]>`
- `fetchOfficeStatus(wk): Promise<OfficeStatus>` where
  `OfficeStatus = { agents: { agent, currentTask, lastEvent }[] }`
- `openOfficeStream(wk, { onStatus, onError }): () => void` — wrap `EventSource`
  on `/api/office/:wk/stream`, parse `snapshot`/`status` events → `onStatus`;
  returns a disposer the caller invokes on workspace change / unmount.
  Mirror `openClaudeSessionStream` in `lib/claude-sessions-client.ts`.

Types mirror the engine (`Role`, `OfficeAgent`, `OfficeTask`, `AuditEvent`) —
define local TS types (the GUI doesn't import the node engine package; declare
the shapes locally, as the GUI does for other bridge payloads).

## §3 Components

- **`AgentOfficeView`** (container): a workspace selector (reuse the existing
  workspaces client/list to pick a `wk`; roles are global so the RoleManager is
  always shown), the `RoleManager`, and the `AgentBoard` for the selected
  workspace. Loading / error / empty states reuse `components/states.tsx`.
- **`RoleManager`**: lists roles (name, kind, model, permissionMode, tool count);
  a create form (name, kind=claude-code default, persona, model select,
  permissionMode select, allowedTools comma-input, workdir optional); delete
  with confirm. On create error (e.g. a leading-`-` tool rejected by the bridge),
  show the bridge error message inline.
- **`AgentBoard`**: from `fetchOfficeStatus(wk)` (and live `openOfficeStream`),
  render a grid of `AgentCard`s + an "Add agent" form (name, role select,
  workdir).
- **`AgentCard`**: role + name, a status dot (idle/working/paused/error/stopped
  with distinct colors), the current task instruction (truncated) + its status,
  the last audit event (type + time), and controls: **Run** (POST run),
  **Pause/Resume**, **Stop**, **Remove** (delete, confirm), and an **Assign**
  inline input (instruction → `assignTask`). After an action, refetch
  status (the SSE will also push updates).
- Permission/safety affordance: when creating a role with `permissionMode:
  "full"`, show a warning that it requires the bridge's `MEGA_OFFICE_ALLOW_FULL`
  to actually run with write/bypass power (else tasks fail closed).

## §4 Live updates

`AgentOfficeView` opens `openOfficeStream(wk)` on workspace select; on each
`status` event, update the board state. Close the stream on workspace change /
unmount. Fall back to an initial `fetchOfficeStatus` for the snapshot. (The SSE
already emits an initial `snapshot`.)

## Testing (RTL + stubbed fetch/SSE; no real bridge)

Mirror `test/components/memory-graph-panel.test.tsx` (a `fetch` stub + `waitFor`).
Cover:
- RoleManager: renders roles from a stubbed `fetchRoles`; create posts the right
  body; a bridge 400 (leading-`-` tool) surfaces the error inline; delete calls
  the endpoint.
- AgentBoard: renders agent cards from a stubbed status payload (status dot per
  state; current task + last event shown); add-agent posts; run/pause/stop/remove
  call the right endpoints; assign posts the instruction.
- AgentOfficeView: workspace select drives the board; SSE `status` event updates
  a card (stub the EventSource).
- office-client: each method hits the right path/method/body (stub fetch).
- view registration: `agent-office` in VIEW_IDS/labels; app renders the view
  when selected (light smoke).

Use `waitFor` for any async-populated assertions (avoid the timing flake that
bit the memory-graph panel test — wait for the data, don't read immediately).

## Definition of Done

- View registered; office-client + components implemented; live updates work.
- `pnpm --filter @megasaver/gui test` green; `pnpm verify` green ubuntu+windows.
- Changeset (minor `@megasaver/gui`).
- code-reviewer + critic (author ≠ reviewer).

## Follow-ups

- Visual-design polish pass (huashu/taste) for the board.
- Per-agent raw claude transcript stream in the detail pane.
- Surface launcher live `onEvent` activity (needs Phase 2/3 to record it).
