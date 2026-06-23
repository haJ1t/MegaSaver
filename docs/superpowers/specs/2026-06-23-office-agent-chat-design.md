---
title: Agent Office chat (Phase B — talk to the agent)
status: approved
risk: HIGH
created: 2026-06-23
sign-off: user approved 2026-06-23 (resume continuity; message box in transcript panel)
sources:
  - docs/superpowers/specs/2026-06-23-office-agent-transcript-design.md
  - wiki/entities/agent-office.md
---

# Agent Office chat — Phase B

## Problem

Phase A gives a read-only live transcript feed per agent. The user wants to
**talk** to the agent: type a message, the agent responds, and the reply
streams into the same feed — a chatbox.

## Goal

A message box at the bottom of the agent transcript panel. Sending a message
shows it in the feed as a `user` turn, runs the agent against it, and the
agent's response streams into the feed live. Multi-turn: the agent remembers
previous messages (resume continuity).

## Design

Reuses Phase A (transcript capture + SSE feed) and the existing
assign/run machinery. A chat message is just a task whose response is already
streamed by Phase A; the only new pieces are a `user` feed entry and a single
endpoint that wires "append user turn → queue task → run".

### 1. `user` transcript role

Add `"user"` to `transcriptRoleSchema` (`packages/agent-office/src/transcript.ts`).
A user turn is `{role:"user", text:<message>}`. `projectEvent` never emits it
(it only maps launcher output); user entries are created by the bridge.

### 2. Continuity (already built)

The supervisor resumes `agent.claudeSessionId` when set
(`supervisor.ts`: `resumeSessionId` branch). So each chat message continues the
same claude session — the agent remembers prior turns and its task work. No
supervisor change.

### 3. Bridge — `POST /api/office/:wk/agents/:id/chat`

`handleChat(ctx, wk, agentId)`:
1. `guardOffice` + `validateWk` + `officeAgentIdSchema` (404 on bad id).
2. Parse body with `chatInputSchema` (`{ message: z.string().min(1) }`,
   `.strict()`) → 400 on failure.
3. `loadAgent` (404 if the agent does not exist).
4. Append a `user` transcript entry (`{ id: newId(), seq: 0, ts: now(),
   role:"user", text: message }`) via `appendTranscript`, then
   `publishTranscript` it so open feeds show it immediately.
5. Create + save a task (`instruction = message`, `status:"queued"`), exactly
   like `handleCreateTask`.
6. Start the drain via a shared `startAgentDrain(ctx, wk, agentId, agent)`
   helper (extracted from `handleRunAgent`): if the agent is already `working`,
   the message simply queues behind the in-flight run; otherwise a fresh drain
   processes it. The drain's `onTranscript` already persists + streams the
   reply.
7. Respond `202` with the created task.

`startAgentDrain` is `handleRunAgent`'s existing supervisor-build + fire-and-
forget `drainAgent` (with the Phase A `onTranscript` persist+publish wiring),
factored out so `handleRunAgent` and `handleChat` share one code path (DRY).

### 4. GUI — message box in the transcript panel

- `office-client.ts`: `sendChat(wk, agentId, message): Promise<OfficeTask>`
  (`POST .../chat`).
- `transcript-panel.tsx`: a textarea + Send at the bottom. Submit →
  `sendChat`; clear the input. The `user` turn and the agent reply both arrive
  over the existing SSE (no optimistic dup — the bridge publishes the user
  entry). Render `user` turns right-aligned / distinct from `assistant`. Enter
  sends, Shift+Enter newlines. Disable Send while the request is in flight;
  when the agent is `working`, show a subtle "queued — agent busy" hint but
  still allow sending (it queues).

## Out of scope

- Interrupting / cancelling an in-flight turn (cooperative cancel — existing
  deferred follow-up).
- Editing/retrying a turn; attachments.

## Known limitation

If a message is sent in the brief window after a drain loop has ended but
before another run is triggered, the queued task waits until the next message
or an explicit Run. Acceptable for Phase B (matches the existing assign/run
queue semantics); a run-on-enqueue reaper is a later refinement.

## Testing (TDD)

- `transcript`: `transcriptEntrySchema` accepts `role:"user"`.
- bridge `handleChat`: appends a `user` entry + creates a queued task +
  responds 202; empty/missing message → 400; unknown agent → 404; the
  published entry reaches a connected transcript SSE client.
- bridge: `handleRunAgent` still works after the `startAgentDrain` extraction
  (existing tests green).
- GUI `transcript-panel`: typing + Send calls `sendChat` with the message and
  clears the input; a `user` SSE entry renders distinctly.

## Risk

HIGH — extends the run path and persists user input that becomes the claude
instruction (the launcher cwd is the workspace dir). Worktree, full TDD,
`pnpm verify`, `code-reviewer` + `critic` before merge.
