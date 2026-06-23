---
title: Agent Office live transcript (Phase A — read-only feed)
status: approved
risk: HIGH
created: 2026-06-23
sign-off: user approved 2026-06-23 (Phase A first; compact detail; per-agent persisted feed)
sources:
  - docs/superpowers/specs/2026-06-22-agent-office-design.md
  - wiki/entities/agent-office.md
---

# Agent Office live transcript — Phase A

## Problem

When an office agent runs, the user cannot see what it is doing. The
supervisor spawns headless `claude -p --output-format stream-json` and the
launcher already emits every stream-json event via `handle.onEvent`, but the
supervisor drops them (`supervisor.ts`: `handle.onEvent(() => {})`). The only
visibility is coarse audit rows (`spawn`, `task_done`). The user wants to click
an agent in the GUI and watch, live, a compact feed of what it is doing.

Phase A delivers the **read-only live feed**. Phase B (later, separate spec)
adds a message box to talk to the agent.

## Goal

Click an agent card → a panel shows that agent's activity as a compact,
chat-like feed: assistant messages, tool calls (`Edit foo.ts`, `Bash: pnpm
test`), tool-result summaries, and the final result. Updates live while the
agent works; shows accumulated history (across past tasks) when reopened.

## Design

Data already flows; Phase A captures, persists, and streams it.

### 1. Project events (`@megasaver/agent-office/transcript.ts`)

`projectEvent(event: LauncherEvent): TranscriptEntryInput | null` — pure,
maps a launcher event to a compact entry (or null to skip noise). The
`payload` is external (`unknown`) and is narrowed defensively.

`TranscriptEntry` (zod `.strict()`):
- `id: officeTranscriptId` (branded lowercase-UUID)
- `ts: string`
- `role: "assistant" | "tool" | "tool_result" | "result" | "stderr"`
- `text?: string` — assistant prose
- `tool?: string` — e.g. `"Edit"`, `"Bash"`
- `summary?: string` — compact one-liner (tool target / truncated result)

Mapping from `{kind:"stream", payload}` (claude stream-json):
- `assistant` text block → `{role:"assistant", text}`
- `assistant` `tool_use` → `{role:"tool", tool:name, summary:briefInput(name,input)}`
  - `Edit`/`Write`/`Read` → basename of `file_path`
  - `Bash` → first 80 chars of `command`
  - else → omitted
- `user` `tool_result` → `{role:"tool_result", summary: truncate(text, 200)}`
- `result` → `{role:"result", summary: is_error ? "failed" : "done"}`
- `system` / unknown → null (skip)
- `{kind:"stderr", text}` → `{role:"stderr", summary: truncate(text,200)}` (non-empty only)

Compaction bounds what is persisted: tool summaries + tool_result/stderr text
truncate to 200 chars (Bash command to 80). Assistant prose is the readable
core of the feed, so it is kept up to a larger cap (4000 chars) — bounded (no
unbounded disk/SSE entry) but NOT a secrecy boundary: assistant text may quote
file contents or command output the model echoes. Accepted HIGH-risk exposure;
mitigated only by the store being localhost-only under the office store dir.
`projectEvent` must never throw — the launcher emits from an async stdout
callback, so a throw would crash the bridge; malformed/hostile payloads return
null and are dropped (the supervisor also wraps the whole capture in try/catch).

### 2. Store (`transcript-store.ts`)

Append-only per agent, mirroring the audit-store pattern (one JSON file per
entry, atomic write, `assertSafeSegment`, zod-on-load):
`office/<wk>/transcript/<officeAgentId>/<transcriptId>.json`. `listTranscript`
reads the dir and sorts by `(ts, seq)`.
- `appendTranscript({storeRoot, workspaceKey, officeAgentId, entry})`
- `listTranscript({storeRoot, workspaceKey, officeAgentId})` → `TranscriptEntry[]`

Per-agent (not per-task) so the feed accumulates history across that agent's
task runs, which the GUI shows on reopen.

### 3. Supervisor wiring

Inject a transcript sink so the supervisor stays testable (no real fs in unit
tests), same way launchers are injected:
`createSupervisor({..., onTranscript?: (e: {workspaceKey, officeAgentId, entry}) => void})`.
Replace `handle.onEvent(() => {})` with:
```
handle.onEvent((event) => {
  const entry = projectEvent(event);
  if (entry) onTranscript?.({ workspaceKey, officeAgentId, entry: withId(entry) });
});
```
The bridge supplies an `onTranscript` that calls `appendTranscript` and notifies
SSE subscribers. A sink throw must never break the run (wrap, swallow — capture
is best-effort, never poisons task execution).

### 4. Bridge

- `GET /api/office/:wk/agents/:id/transcript` → `TranscriptEntry[]` backlog
  (route-layer wk + agentId validation, like the other agent routes).
- `GET /api/office/:wk/agents/:id/transcript/stream` → SSE; on connect, an
  in-process emitter (the supervisor's `onTranscript`) pushes new entries as
  `transcript` events. Cleanup the listener on disconnect (mirror the existing
  audit `handleOfficeStream` lifecycle: register before await, remove on close).

### 5. GUI

- `office-client.ts`: `fetchTranscript(wk, agentId)` + `openTranscriptStream(wk,
  agentId, {onEntry, onError})` (EventSource disposer), and a
  `TranscriptEntry` type.
- New `views/office/transcript-panel.tsx`: given `{wk, agentId}`, fetch backlog
  + open the stream; render a scrollable feed — assistant bubbles, tool lines
  (`▸ Edit foo.ts`), result line. Auto-scroll to newest. Read-only.
- `agent-board.tsx`: clicking an agent card selects it; the selected agent's
  `TranscriptPanel` renders (below the board or in a side column). Re-clicking /
  a close control deselects.

## Out of scope (Phase B+)

- Message input / talking to the agent (interactive chat). Phase B spec will
  resolve the "live-interactive vs background-session" model.
- Full raw transcript / tool-output inspection.
- Redaction integration with the evidence-ledger.

## Testing (TDD)

- `projectEvent`: one test per event type → expected entry (assistant text,
  tool_use Edit/Bash, tool_result truncation, result ok/fail, system→null,
  stderr).
- `transcript-store`: append then list round-trips; path confinement; per-agent
  isolation.
- supervisor: an injected `onTranscript` receives projected entries during a
  fake-launcher run that emits stream events; a throwing sink does not fail the
  task.
- bridge: backlog GET returns stored entries; SSE pushes a new entry to a
  connected client; wk/agentId validation → 400/404.
- GUI: clicking a card opens the panel and renders backlog; an SSE `onEntry`
  appends live; stubbed fetch/EventSource (no real bridge).

## Risk

HIGH — touches the launcher/supervisor execution path and persists projected
model I/O. Worktree isolation, full TDD, `pnpm verify`, `code-reviewer` +
`critic` before merge.
