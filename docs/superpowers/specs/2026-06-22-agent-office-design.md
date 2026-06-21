---
title: Agent Office — multi-agent roster, roles, task queues, live board
status: draft
risk: critical
created: 2026-06-22
updated: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
safety_confirmation: >
  User explicitly confirmed (2026-06-22) the CRITICAL safety posture in §8:
  office-spawned agents are SAFE-BY-DEFAULT (permissionMode `plan`/read-only on
  every new agent); write capability (`acceptEdits`/`full`) is opt-in PER ROLE
  and must be granted explicitly by the user; all writes are confined to the
  agent's assigned workdir; every spawn and task lifecycle transition is logged
  to the evidence-ledger. `--dangerously-skip-permissions` is never used by
  default. This satisfies the §12 CRITICAL requirement for manual user
  confirmation recorded in the spec.
---

# Agent Office

## Summary

Agent Office turns Mega Saver's GUI into a control room where the user creates,
removes, and manages multiple coding agents at once — as if running a single
office. Each agent is assigned a **role** (a reusable template: persona, model,
tools/skills, permission policy, default workdir) and a **task queue**. The
office launches agents through the connector layer, runs their queued tasks, and
shows live per-agent status (what each agent is working on right now) on one
board.

The user is the office manager. The office never runs unsupervised loops; it
executes the tasks the user assigns and surfaces evidence.

## Goals

- Create / remove agents within the office; assign each a role and tasks.
- Predefined roles (seeded from the CLAUDE.md §6 agent roster) plus user-created
  custom roles.
- Per-agent task queue with a tracked lifecycle (queued → running → done/failed).
- Live, per-agent visibility into what each agent is currently doing.
- Stay inside Mega Saver's agent-agnostic core principle: the engine never
  contains agent-specific logic; only connector adapters do.

## Non-Goals (v1, YAGNI)

- No automatic inter-agent messaging or delegation. Agents do not talk to each
  other; the user routes work. (Shared memory via the wiki/core already exists if
  needed; auto-delegation is out of scope.)
- No codex / cursor / aider launcher adapters. The architecture is typed for all
  four agent kinds, but v1 implements only the **claude-code** adapter. Each
  other adapter is a separate follow-on connector spec.
- No cloud / multi-machine orchestration.
- No autopilot / ralph / unsupervised loops (forbidden by §12 CRITICAL).

## Decisions locked during brainstorming

1. **Agent model = Hybrid.** The office *launches* agents through the connector
   adapter layer AND *tracks* them live. Process spawning is isolated to a
   connector capability, not the engine.
2. **Scope = all four agent kinds by interface, claude-code adapter ships v1.**
   codex/cursor/aider become their own connector specs that plug into the
   finished office.
3. **Roles = rich bundle** (persona + model + allowed tools/skills + permission
   policy + default workdir). Predefined seed + custom.
4. **Tasks = queue + lifecycle** per agent.
5. **Execution = headless run per task with resumed session**: each task is a
   `claude -p "<instruction>"` run; session continuity across the queue via
   `--resume`.
6. **Surface = engine package + GUI board + thin CLI.**
7. **Safety = per-role permission policy + workdir confinement + evidence-ledger
   audit, safe-by-default.** (See §8; user-confirmed in frontmatter.)

## Architecture

### Chosen approach (A)

New package **`@megasaver/agent-office`** (engine, agent-agnostic). It owns its
own atomic-json persisted state for roles/agents/tasks and *composes*:

- `@megasaver/core` `CoreRegistry` — Session lifecycle per agent run.
- `@megasaver/evidence-ledger` — audit of spawns and task transitions.
- a **new `AgentLauncher` connector capability** — process spawning, with the
  agent-specific implementation living only in the claude-code adapter.
- `@megasaver/shared` — branded ids, `AgentId` enum, `RiskLevel`, `titleSchema`.

Rejected alternatives:

- **B — fold office state into `core` CoreRegistry.** Bloats the central
  registry and couples process supervision next to core.
- **C — host the office inside `apps/gui/bridge`.** Breaks the §7 CLI-parity
  dogfood rule and leaves the logic untestable as a package.

### §1 Domain model (zod schemas, validated at boundaries)

- **Role** — reusable template.
  `{ id: RoleId, name: Title, kind: AgentId, persona: string, model: 'opus'|'sonnet'|'haiku', allowedTools: string[], skillPacks: string[], permissionMode: 'plan'|'acceptEdits'|'full', defaultWorkdir?: string }`.
  Predefined roles seeded from CLAUDE.md §6 (architect, executor, code-reviewer,
  critic, debugger, verifier, writer, security-reviewer, test-engineer,
  document-specialist, tracer, explore, designer). Custom roles: create/edit.
- **Agent** (office instance, a "desk").
  `{ id: OfficeAgentId, name: Title, roleId: RoleId, kind: AgentId, workdir: string, status: AgentStatus, claudeSessionId?: string, coreSessionId?: SessionId, createdAt: ISO8601 }`.
  `AgentStatus = idle|working|paused|error|stopped`. `kind` reuses the shared
  `AgentId` enum (the agent *kind*); the instance id `OfficeAgentId` is a new
  branded lowercase-UUID, distinct from kind.
- **OfficeTask** (queue item).
  `{ id: TaskId, agentId: OfficeAgentId, instruction: string, status: TaskStatus, queuedAt: ISO8601, startedAt?: ISO8601, finishedAt?: ISO8601, exitCode?: number, evidenceId?: string }`.
  `TaskStatus = queued|running|done|failed|canceled`.

New id types (`RoleId`, `OfficeAgentId`, `TaskId`) follow the
`@megasaver/shared` branded lowercase-UUID pattern; names use `titleSchema`.

### §2 Persistence (atomic-json, mirrors content-store)

```
${storeRoot}/office/
  roles/${roleId}.json                          # global role templates
  ${workspaceKey}/agents/${officeAgentId}.json  # agent (desk) records
  ${workspaceKey}/tasks/${officeAgentId}/${taskId}.json   # per-agent queue
```

Reuse the content-store discipline: temp-file + fsync + atomic rename;
2-space JSON + newline; zod validation on save and load; `assertSafeSegment` on
every path segment (reject `.` `..` `/` `\`); ids lowercase at the source.
Roles are global to the store; agents and tasks are scoped by `workspaceKey`
(via `encodeWorkspaceKey` from shared).

### §3 AgentLauncher (new agent-agnostic connector capability)

New interface in `@megasaver/connectors`, separate from the existing
file-projection `ConnectorTarget` (today's connectors do file I/O only — no
process spawning; this is genuinely new surface):

```
interface AgentLauncher {
  kind: AgentId
  launchTask(input: {
    workdir: string
    instruction: string
    model: 'opus' | 'sonnet' | 'haiku'
    allowedTools: string[]
    permissionMode: 'plan' | 'acceptEdits' | 'full'
    resumeSessionId?: string
  }): {
    sessionId: string                 // resolved/echoed agent session id
    onMessage(cb: (m: LauncherEvent) => void): void
    onExit(cb: (r: { code: number }) => void): void
    cancel(): void
  }
}
```

**claude-code adapter** builds and spawns:

```
claude -p "<instruction>" \
  --output-format stream-json \
  --model <model> \
  --permission-mode <plan|acceptEdits> \
  [--allowedTools <list>] \
  [--resume <claudeSessionId>]
```

`cwd = workdir`. The adapter parses `stream-json` lines into `LauncherEvent`s
(tool use, assistant text, usage) for live activity, and resolves the exit code
to done/failed. `--dangerously-skip-permissions` is emitted ONLY when the role's
`permissionMode === 'full'` and a per-spawn explicit confirmation flag is set
(see §8). codex/cursor/aider adapters implement the same interface in their own
specs.

### §4 Supervisor (engine)

Per-agent **serial** worker loop:

1. Pull next `queued` task for the agent.
2. Mark task `running`, agent `working`; persist.
3. `CoreRegistry.createSession` for the run; `evidence-ledger.appendEvidence`
   (sourceKind `agent_request`) for the spawn.
4. `launcher.launchTask(...)`, resuming `agent.claudeSessionId` for context
   continuity across the queue.
5. Stream `LauncherEvent`s → update task live activity.
6. On exit 0 → task `done`, store the run's session id back onto the agent for
   the next `--resume`. On non-zero → task `failed`, agent → `error` (queue
   halts for that agent; user decides).

Agents run **concurrently**; a configurable cap bounds simultaneously-spawned
processes. No auto-retry, no autopilot loop (§12 CRITICAL). Pause stops pulling
new tasks; stop cancels the active spawn and parks the agent.

### §5 Live status (reuse existing machinery)

Each task run is a Claude Code session with a jsonl transcript. The board reuses
the bridge's `tailTranscript` / SSE and `safeSessionPath` path-safety. Per-agent
card surfaces: status dot, current task, last activity (last tool / last
assistant text), token usage (from jsonl `usage` meta), and exit status.

### §6 Surfaces

- **Engine package `@megasaver/agent-office`** — pure domain + supervisor;
  composes CoreRegistry; no agent-specific logic.
- **GUI** — new `agent-office` view:
  - **Board**: grid of agent cards (role, name, status, current task, live
    activity).
  - **Detail pane**: task queue, live transcript stream, controls (assign /
    pause / stop / remove).
  - **Role manager**: CRUD over roles.
  - **Bridge**: new `/api/office` routes following the `handler.ts` dispatch +
    `RouteContext` pattern; reuse session tailing for per-agent transcript
    streams.
- **CLI** — `mega office` subcommands (Citty, thin handlers calling the engine):
  `role {list,create,edit,rm}`, `agent {create,list,rm}`,
  `assign <agent> "<task>"`, `status [agent]`, `{start,pause,stop} <agent>`,
  `logs <agent>`.

### §7 Data flow (one task)

```
assign (GUI/CLI)
  → enqueue OfficeTask (persist)
  → supervisor picks up
  → CoreRegistry.createSession
  → evidence-ledger.appendEvidence (spawn, agent_request)
  → launcher spawns `claude -p --resume` in workdir
  → stream-json events → task running + live activity
  → process exit → task done|failed → persist new claudeSessionId
  → board updates via SSE
```

## §8 Safety (risk = CRITICAL — user-confirmed in frontmatter)

Office-spawned agents run headless and can modify files in their workdir. The
posture is **safe-by-default**:

- **Per-role permission policy.** Every NEW agent defaults to `permissionMode:
  'plan'` (read-only). Write capability (`acceptEdits` / `full`) is opt-in **per
  role** and must be granted explicitly by the user.
- **Workdir confinement.** Spawn `cwd = agent.workdir`; no extra `--add-dir`.
  `acceptEdits` writes are confined to that tree.
- **No skip-permissions by default.** `--dangerously-skip-permissions` is emitted
  only when role `permissionMode === 'full'` AND a per-spawn explicit
  confirmation flag is set.
- **Audit.** Every spawn and every task lifecycle transition is logged to the
  evidence-ledger (`appendEvidence`, sourceKind `agent_request`); file mutations
  are additionally captured via the agent's own jsonl / saver hook.
- **No unsupervised loops.** No autopilot, no ralph, no auto-retry.

Per §12 CRITICAL, implementation requires: architect design pass, critic
adversarial review, security-reviewer pass, tracer evidence loop, and a verifier
pass with reproduction evidence — in addition to the standard chain.

## §9 Implementation phasing (writing-plans will detail)

0. Domain model + zod schemas + atomic-json store (pure logic, TDD; no spawning).
1. `AgentLauncher` interface + claude-code adapter (the isolated risky part:
   spawn `claude -p`, parse stream-json, resolve exit code).
2. Supervisor (queue loop, lifecycle, resume continuity, concurrency cap) +
   per-role permission/workdir safety + evidence-ledger audit.
3. Bridge `/api/office` routes + reuse of session tailing.
4. GUI office board view + role manager.
5. CLI `mega office` commands.

## Testing strategy

- **Engine (phases 0,2):** unit + property tests for schemas, store round-trips
  (atomic write/load, path-safety rejection), supervisor state machine
  (queue ordering, lifecycle transitions, failure halts agent), permission
  policy (new agent = plan; skip-permissions gated).
- **Launcher (phase 1):** adapter builds the correct argv per permissionMode;
  stream-json parsing → LauncherEvents; exit code → done/failed. Spawn is
  injected (fake child process) so tests never launch a real `claude`.
- **Bridge (phase 3):** route dispatch, path-safety on agent/task ids, SSE
  snapshot+message events.
- **GUI (phase 4):** board renders agent cards from fixture state; controls call
  the right api-client methods; role manager CRUD.
- **CLI (phase 5):** each `mega office` subcommand maps input → engine call →
  exit code / JSON output.
- **Smoke evidence (DoD §5):** a captured run where the office launches a real
  claude-code agent in a throwaway workdir, assigns a read-only task, and the
  board shows live activity + done status.

## Open questions (resolve in plan)

- Concurrency cap default value.
- Whether role `skillPacks` maps to anything launchable in v1 (skill-packs is a
  v0.2 placeholder) or is recorded-but-inert until that lands.
- Exact `claude` CLI flag names/behavior to verify against the installed version
  before phase 1 (consult the `claude-api` / claude-code-guide resources).
