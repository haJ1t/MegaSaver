# Agent Office Phase 4 — GUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD where practical (RTL component tests), commit per task, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.

**Goal:** `agent-office` GUI view — role manager + per-workspace agent board (create/assign/run/pause/stop/remove + live status) consuming the Phase 3 `/api/office/*` API.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-office-phase4-gui-design.md](../specs/2026-06-22-agent-office-phase4-gui-design.md). **Risk MEDIUM.**

**MUST mirror existing patterns (read first):**
- `apps/gui/src/lib/api-client.ts` (`getJson`/`postJson`/`handleResponse` + `BridgeError`) and `apps/gui/src/lib/claude-sessions-client.ts` (the `EventSource` SSE wrapper) — for `lib/office-client.ts`.
- `apps/gui/src/views/claude-sessions-view.tsx` / `views/workspace-session-list.tsx` — view + loading/error/empty states (`components/states.tsx`).
- `apps/gui/test/components/memory-graph-panel.test.tsx` — the RTL + `fetch`-stub test harness. **Use `waitFor` for async-populated assertions** (the memory-graph test had a timing flake from reading before data populated — don't repeat it).
- `apps/gui/src/view-id.ts` + `app.tsx` — view registration.

**CI discipline:** `pnpm lint` (= biome check .) before commits; paths N/A (UI); `pnpm verify` at end (ubuntu+windows). No deps added (no lockfile change expected). exactOptionalPropertyTypes + noUncheckedIndexedAccess ON.

---

## File Structure
```
apps/gui/src/view-id.ts                         # +"agent-office"
apps/gui/src/app.tsx                            # nav + render AgentOfficeView
apps/gui/src/lib/office-client.ts               # API methods + openOfficeStream + local types
apps/gui/src/lib/api-client.ts                  # export getJson/postJson (+ a delete helper) for reuse
apps/gui/src/views/agent-office-view.tsx        # container (workspace select + RoleManager + AgentBoard)
apps/gui/src/views/office/role-manager.tsx
apps/gui/src/views/office/agent-board.tsx       # AgentBoard + AgentCard (+ add-agent + assign inline)
apps/gui/test/components/office/*.test.tsx      # role-manager, agent-board, office-view, office-client
.changeset/agent-office-phase4-gui.md
```

## Task 1: office-client + view registration
- [ ] `lib/api-client.ts`: export `getJson`, `postJson`, and add `deleteJson(path): Promise<void>` (DELETE; 204 → resolve void; mirror handleResponse for errors).
- [ ] `lib/office-client.ts`: local TS types `OfficeRole`/`OfficeAgent`/`OfficeTask`/`OfficeAuditEvent`/`OfficeStatus` (mirror engine shapes), and the methods in spec §2 (`fetchRoles`/`createRole`/`deleteRole`/`fetchAgents`/`createAgent`/`deleteAgent`/`fetchTasks`/`assignTask`/`runAgent`/`controlAgent`/`fetchAudit`/`fetchOfficeStatus`) using getJson/postJson/deleteJson with the exact `/api/office/...` paths (encodeURIComponent the wk/ids). `openOfficeStream(wk, handlers)` mirrors `openClaudeSessionStream` (EventSource; parse `snapshot`+`status` → onStatus; onError).
- [ ] `view-id.ts`: add `"agent-office"` to VIEW_IDS (keep alphabetical) + VIEW_LABELS `"Agent office"`. Update `view-id.test-d.ts` if it pins the union.
- [ ] `app.tsx`: add to NAV_VIEWS; render `<AgentOfficeView/>` when `view === "agent-office"`.
- [ ] **Test** `test/components/office/office-client.test.tsx`: stub global `fetch`; assert each method calls the right path/method/body and parses the response; deleteJson resolves on 204; error envelope throws.
- [ ] lint + commit `feat(gui): office API client + view registration`.

## Task 2: RoleManager
- [ ] `views/office/role-manager.tsx`: fetch + list roles; create form (name, kind default claude-code, persona, model select opus/sonnet/haiku, permissionMode select plan/acceptEdits/full with a warning on `full`, allowedTools comma-separated input → string[], optional defaultWorkdir); delete with confirm. Inline error from the bridge envelope (e.g. leading-`-` tool → 400 message shown). Loading/error/empty via `components/states.tsx`.
- [ ] **Test** `test/components/office/role-manager.test.tsx`: renders stubbed roles; create posts correct body (use `waitFor`); a stubbed 400 surfaces the message; delete calls endpoint.
- [ ] lint + commit `feat(gui): office role manager`.

## Task 3: AgentBoard + AgentCard
- [ ] `views/office/agent-board.tsx`: props `{ wk }`. Initial `fetchOfficeStatus(wk)`; render grid of AgentCard from `status.agents`. Add-agent form (name, role select from roles, workdir). AgentCard: role+name, status dot (color per idle/working/paused/error/stopped), current task (truncated) + status, last event (type + relative time), controls Run/Pause|Resume/Stop/Remove(confirm) + inline Assign (instruction → assignTask). After any mutation, refetch status.
- [ ] **Test** `test/components/office/agent-board.test.tsx`: renders cards from a stubbed status payload (assert status dot + current task + last event via `waitFor`); add-agent posts; run/pause/stop/remove hit the right endpoints; assign posts instruction.
- [ ] lint + commit `feat(gui): office agent board`.

## Task 4: AgentOfficeView container + live SSE + changeset + verify
- [ ] `views/agent-office-view.tsx`: workspace selector (reuse the workspaces client/list to choose a wk; if only one workspace, auto-select). Always render RoleManager (global). When a wk is selected, render AgentBoard + open `openOfficeStream(wk)`; on `status` events update board state; close stream on wk change/unmount.
- [ ] **Test** `test/components/office/agent-office-view.test.tsx`: workspace select drives the board; a stubbed EventSource `status` event updates a card (stub `global.EventSource`); stream closed on unmount.
- [ ] changeset `.changeset/agent-office-phase4-gui.md` (minor `@megasaver/gui`).
- [ ] `pnpm verify` green. lint + commit `feat(gui): office view container + live updates + changeset`.

## Definition of Done
Per spec. `pnpm --filter @megasaver/gui test` + `pnpm verify` green (ubuntu+windows). Changeset. code-reviewer + critic.

## Self-Review (author)
Spec §1→T1(view reg), §2→T1(client), §3→T2+T3, §4→T4. Tests use `waitFor` (avoid the memory-graph flake). No bridge/engine changes. No deps added.
