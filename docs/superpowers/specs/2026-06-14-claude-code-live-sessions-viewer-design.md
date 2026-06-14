# Claude Code Live Sessions Viewer — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Read-only, single implementation plan

## Problem

The MegaSaver GUI shows only MegaSaver's own sessions (`~/.local/share/megasaver/sessions.json`), which is stale, single-project demo data. The user wants to view the **live Claude Code desktop sessions** they are actively using — the transcripts the desktop app writes to `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` (~7000 files, continuously appended).

There is currently no bridge between the GUI and `~/.claude/projects`. The existing `@megasaver/connector-claude-code` package only reads/writes a project's `CLAUDE.md` context block — the opposite direction. So this is a new capability.

## Goals

- A new GUI view that lists Claude Code sessions across all projects, most-recently-active first.
- Selecting a session shows its transcript.
- The selected session updates **live** (real-time) as new lines are appended while the user works in Claude Code.
- Strictly **read-only**: never write to or import from `~/.claude/projects`; never mutate the MegaSaver store.

## Non-Goals (YAGNI)

- No ingest/import of Claude Code sessions into the MegaSaver store.
- No write-back to `~/.claude/projects`.
- No search or filtering beyond list + pagination.
- No editing, deleting, or annotating sessions.

## Decisions

- **Live mechanism:** SSE (Server-Sent Events). Faithful to the chosen "real-time stream" requirement; ~50 lines; node `http` supports streaming responses directly.
- **Reader location:** inside the bridge (`apps/gui/bridge/claude-sessions/`), not a new workspace package. It is consumed only by the bridge and is a read-only scan of an external directory.
- **List freshness:** the session list is fetched as plain JSON (cheap, matches existing route patterns). Only the *selected* transcript streams via SSE.

## On-Disk Format (observed)

Each line of `<session-uuid>.jsonl` is one JSON object. Two families coexist:

- **Turn lines** — `type: "user" | "assistant"`. Rich keys including `message`, `uuid`, `parentUuid`, `timestamp`, `cwd`, `sessionId`, `version`, `gitBranch`.
  - `user`: `message.content` is a string (or occasionally an array).
  - `assistant`: `message.content` is an array of blocks: `{type: "thinking", thinking, signature}`, `{type: "text", text}`, `{type: "tool_use", name, input}`, etc.
- **Desktop meta lines** — `type: "attachment" | "queue-operation" | "last-prompt" | "system"`. Different shapes; `last-prompt` carries `{lastPrompt, leafUuid, sessionId}`.

The `cwd` field on turn lines is the authoritative project path. The directory name (`-Users-halitozger-Desktop`) is a lossy encoding of the cwd (slashes/dots → dashes) and **must not** be reverse-decoded; treat it as an opaque id and read the display path from a transcript's `cwd` field.

## Architecture

```
GUI (claude-sessions view)
  │  fetchClaudeSessions()        → GET  /api/claude-sessions?limit&offset      (JSON list)
  │  openClaudeSessionStream()    → GET  /api/claude-sessions/:dir/:id/stream   (SSE)
  ▼
Bridge route  routes/claude-sessions.ts
  ▼
Reader  apps/gui/bridge/claude-sessions/
  ├─ reader.ts   listSessions / readTranscript / tailTranscript (fs.watch)
  └─ parse.ts    raw jsonl line → normalized message
        ▼
  ~/.claude/projects/<dir>/<id>.jsonl   (read-only)
```

### Module: `claude-sessions/parse.ts`

Pure function. Raw line object → normalized message, or `null` if the line is not renderable (attachment, queue-operation, malformed).

```
NormalizedMessage = {
  role: "user" | "assistant" | "system",
  ts: string,                 // ISO timestamp
  blocks: Block[],
}
Block = { kind: "text" | "thinking" | "tool_use" | "tool_result", text: string }
```

- `user`: one `text` block from the string content (or joined array).
- `assistant`: one block per content entry, mapping block `type` → `kind`; `thinking`→text of `thinking`, `tool_use`→summarized `name`+`input`.
- `system`: one `text` block (when present).
- `attachment` / `queue-operation` / `last-prompt`: return `null` (not rendered as a turn). `last-prompt.lastPrompt` is surfaced separately as an "in-progress prompt" hint, not a turn.

### Module: `claude-sessions/reader.ts`

- `claudeProjectsRoot()` — resolves `~/.claude/projects`. If absent, callers treat as empty.
- `listSessions({limit, offset})` — glob `*/*.jsonl` under the root, `stat` each, sort by `mtime` desc, slice `[offset, offset+limit]`. For each, derive:
  - `dir` (opaque directory name), `id` (uuid filename without extension),
  - `mtime`, `size`,
  - `title` — first user prompt text (read lazily; bounded read of the first N lines),
  - `projectLabel` — `cwd` from the first turn line that has one.
  - `live` flag is computed client-side from `mtime` recency; the server just returns `mtime`.
  - Default `limit` = 50.
- `readTranscript(dir, id)` — validate path (below), read file, parse each line via `parse.ts`, drop `null`s, return `{ messages, projectLabel, byteLength }`.
- `tailTranscript(dir, id, onMessage, onError)` — read current content, then `fs.watch` the file; on append, read from the previous byte offset, split complete lines, parse, emit. A trailing partial line (mid-write) is buffered and retried on the next event. Returns a disposer that closes the watcher.

**Path safety (security-critical):** `dir` and `id` arrive from the URL. Reject any value containing `/`, `\`, `..`, or path separators; resolve the candidate path and assert it is a direct child `<root>/<dir>/<id>.jsonl` whose normalized absolute path still starts with the resolved projects root. On violation → 400 `invalid_request`. The reader never opens a write handle.

### Bridge routes: `routes/claude-sessions.ts`

Plain async handlers following the existing route pattern (validate → read → respond), dispatched from `handler.ts`.

- `GET /api/claude-sessions?limit&offset` → `sendJson` list. Validates `limit`/`offset` as non-negative integers (Zod, mirroring existing query schemas).
- `GET /api/claude-sessions/:dir/:id` → `sendJson` full transcript snapshot.
- `GET /api/claude-sessions/:dir/:id/stream` → SSE:
  - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, plus existing CORS origin handling.
  - Emit an initial `snapshot` event (current messages + byteLength), then `message` events for each appended turn via `tailTranscript`.
  - Periodic `: heartbeat` comment (~15 s) to keep the connection alive.
  - On `req` `close`/`aborted`: dispose the watcher and end the response.
  - If the file is deleted mid-stream: emit an `end` event and close.

### GUI

- Register view id `claude-sessions` in `VIEW_IDS` and the view registry (alongside the existing 9 views).
- API client (`api.ts`): `fetchClaudeSessions(limit, offset)`, `fetchClaudeTranscript(dir, id)`, and `openClaudeSessionStream(dir, id, handlers)` returning an `EventSource` wrapper with `onSnapshot` / `onMessage` / `onEnd` / `onError`.
- View component mirrors the **memory view two-pane** layout:
  - Left: session list — `projectLabel`, `title`, relative time, a green "live" dot when `mtime` is within a few seconds. Keyboard navigation + deep-linking consistent with memory view.
  - Right: transcript. On selection, open the SSE stream; render the snapshot, then append `message` events; auto-scroll to bottom unless the user has scrolled up. Close the previous stream when switching sessions or leaving the view.

## Data Flow (live path)

GUI `EventSource` → bridge SSE route → `tailTranscript` (`fs.watch`) → `parse` → `message` event → GUI appends bubble → auto-scroll.

## Error Handling

| Condition | Behavior |
|---|---|
| `~/.claude/projects` missing | List returns `[]`; GUI shows an empty-state message. |
| Malformed / partial trailing JSON line (mid-write) | Skip the incomplete line; retry on the next watch event. |
| Path traversal in `:dir`/`:id` | 400 `invalid_request`; nothing read. |
| Selected file deleted during stream | SSE emits `end`; GUI marks the session inactive and closes the stream. |
| Client disconnect | Watcher disposed, response ended (no leak). |

## Testing (TDD)

- **parse.ts** — one test per line type: `user` string, `assistant` with `thinking`/`text`/`tool_use` blocks, `system`, and `null` for `attachment`/`queue-operation`/malformed.
- **reader.ts** — against a temp fixture dir: `listSessions` ordering (mtime desc) + pagination (`limit`/`offset`); `readTranscript` normalization; path-traversal rejection (`..`, embedded separators); `tailTranscript` emits a `message` when a line is appended and tolerates a partial trailing line.
- **routes/claude-sessions.ts** — list endpoint validates query params; snapshot endpoint returns normalized messages; stream endpoint sets SSE headers and emits an initial `snapshot` event.

## Open Risks

- ~7000 files: `listSessions` must stat then slice, not read file bodies for the whole set. Title/`projectLabel` are read only for the page being returned (bounded line read per file).
- `fs.watch` semantics differ across platforms; on macOS (target) appends fire reliably. A size-based re-read from the last offset (rather than trusting event payloads) keeps it robust.
