---
title: Context daemon — agent↔tool local proxy (intent-matched excerpt + session memory)
status: approved
risk: HIGH
created: 2026-06-25
sign-off: user approved 2026-06-25 — machine-wide daemon; clients = MCP + hook;
  transport A (loopback HTTP + token); hook intent generic-only in v1 (prompt
  capture deferred). Supersedes the llm-proxy approach for Desktop.
sources:
  - docs/conventions/mission.md
  - docs/superpowers/specs/2026-06-24-llm-proxy-phase0-design.md
  - wiki/concepts/proxy-mode.md
  - wiki/concepts/context-ledger-architecture.md
  - packages/mcp-bridge/src
  - packages/output-filter/src
---

# Context daemon

## Why

MegaSaver already saves **tool-output** tokens, but the mechanism is split
across three channels and the wrong one was being invested in:

| Channel | Mechanism | Desktop status |
| --- | --- | --- |
| LLM-proxy | `ANTHROPIC_BASE_URL` | **dead** — Claude Desktop overrides the base URL |
| MCP tools | `proxy_read_file(intent)` etc. — agent must call them | works **if** the server is registered; intent-rich |
| PostToolUse hook | `mega hooks saver` | **works today** — transparently compresses native tool output |

Confirmed this session: the LLM base-url proxy (Phase 0) cannot route inside
Claude Desktop, but tool-side interception (MCP tools and the hook) **is**
honored. Therefore the correct channel for token saving is the **agent↔tool**
path, not the agent↔LLM path.

Two structural problems with the current tool-side setup:

1. **Cold start per call.** The hook spawns a fresh `mega` subprocess on every
   tool call — no warm index, no cross-call state.
2. **No session memory and no true intent matching on the transparent path.**
   `intent` only exists when the agent explicitly calls an MCP `proxy_*` tool;
   the hook sees output after the fact with no intent.

This spec introduces a **machine-wide context daemon**: a persistent local
process between the agent and its tools that returns **intent-matched excerpts**
and keeps **session memory** warm. The MCP server and the hook become thin
clients of the daemon.

## Hard constraint (kept from mission §1)

The daemon sees **tool output only** — file reads, command output, search
results. It does **not** see the conversation/prompt stream (that is assembled
inside Claude Desktop and never exposed to a tool). Conversation-context saving
is therefore **out of scope** and not achievable on this channel; the llm-proxy
was the only path to it and is dead in Desktop. We do not blind the model: raw
is preserved and expandable; evidence is never silently dropped.

## Goals

- One machine-wide daemon serving all sessions/agents/projects, keyed by
  `sessionId + projectId`.
- Warm engine: classify → compress → rank-by-intent → fit-to-budget → store,
  reusing the existing `output-filter` pipeline (proxy-mode v1.2, P1–P6).
- Session memory: per-session tool-call history + chunk references, queryable by
  `recall(intent)` so the agent recalls without re-reading.
- Two clients feed the same daemon: MCP server (primary, intent-carrying) and
  the PostToolUse hook (transparent fallback, generic compression).
- Lazy auto-spawn + idle shutdown; loopback-only with a per-daemon token.

## Non-goals

- Conversation/prompt-token saving (see hard constraint).
- Replacing the existing `output-filter`/`content-store` engine — the daemon
  **wraps** it, it does not reimplement it.
- Multi-machine / networked daemon. Loopback only.
- Removing the llm-proxy code in this spec — it is marked deprecated for Desktop;
  its removal/repurposing is a separate decision.

## Architecture

### Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `apps/daemon` (new) | Persistent process. Session-keyed warm engine. HTTP API. Lazy spawn + idle shutdown. | engine + session-store |
| daemon `engine` | classify → compress → rank(intent) → fit → store. Thin wrapper over `output-filter`. | output-filter, retrieval, policy |
| daemon `session-store` | `sessionId+projectId` → memory (tool-call records, chunk refs, recentFailures). Warm in-memory + append-only persist. | content-store, stats |
| `mcp-bridge` (refactor) | `proxy_*` tools forward to the daemon; spawn if down; in-process fallback if unreachable. | daemon-client |
| `mega hooks saver` (refactor) | native tool output forwards to the daemon (generic); in-process fallback. | daemon-client |
| `daemon-client` (new, shared) | read discovery file, authenticated HTTP call, spawn, fallback. Shared by both clients. | — |

### Data flow

1. Agent issues a read/command. Either it calls an MCP `proxy_*` tool (with
   `intent`) or it uses a native tool that the PostToolUse hook intercepts (no
   intent).
2. The client (MCP server or hook) calls the daemon over loopback HTTP.
3. The daemon runs `/exec` (it executes the real, policy-gated command) or
   `/excerpt` (it compresses already-captured raw), then ranks chunks by intent,
   fits to budget, stores raw chunks (redacted), and appends a session-memory
   record.
4. The daemon returns the ranked excerpt + `chunkSetId`. Omitted raw is fetched
   later via `/expand`.
5. `recall(intent)` ranks the session's past records and returns the relevant
   ones without re-reading.

### Daemon HTTP contract (shape, not final types)

- `POST /excerpt` — `{sessionId, projectId, tool, target, intent?, raw}` →
  `{excerpt, chunkSetId, rawTokens, returnedTokens, decision}`
- `POST /exec` — `{sessionId, projectId, command, args, intent}` → daemon runs
  the real command policy-gated, compresses, returns the same excerpt shape
- `POST /expand` — `{chunkSetId, chunkId}` → `{raw}`
- `POST /recall` — `{sessionId, intent}` → `{records: RankedRecord[]}`
- `GET /status` — `{sessions, totals}` (running sessions + savings aggregate)

### MCP tool surface (names unchanged)

`proxy_read_file(path, intent)`, `proxy_run_command(command, args, intent)`,
`proxy_search_code(query, intent)`, `proxy_expand_chunk(chunkSetId, chunkId)`,
`mega_recall(sessionId, intent)`. Same names as today — only the implementation
moves behind the daemon-client.

### Session memory model

- Key: `sessionId + projectId`.
- Record: `{intent, tool, target, chunkSetId, returnedExcerpt, scores, ts,
  recentFailures}`.
- `recall(intent)`: BM25 + memory boost over the session's records → ranked.
- Storage: warm in-memory map + append-only persistence via `content-store`;
  lazy reload per session on daemon restart.

### Lifecycle & security

- **Singleton:** lockfile (`daemon.lock`) under the megasaver store root. The
  first client (MCP or hook) that finds no live daemon spawns it
  (language-server style).
- **Discovery:** `daemon.json` (port + random per-daemon token) under the store
  root; clients read it to connect.
- **Security:** bind `127.0.0.1` only; every request carries
  `Authorization: <token>`; `/exec` and `proxy_search_code` go through the
  existing `policy` allow-list + redaction, and reject absolute paths / `..`
  (the proven proxy-mode pattern).
- **Idle shutdown:** the daemon exits after N minutes with no requests.

## Decisions (locked)

- **Topology:** one machine-wide daemon. (agent-agnostic core; multi-agent
  agent-office compatible; `mega_recall(sessionId)` fits.)
- **Clients:** MCP + hook, both feeding one daemon. MCP carries intent (true
  intent matching); hook is the transparent fallback (generic compression) so
  savings are guaranteed even when the agent forgets to call `proxy_*`.
- **Transport:** A — loopback HTTP + per-daemon token + discovery file.
  (Cross-platform, matches existing llm-proxy/bridge patterns.) Unix-socket /
  named-pipe transport is a later hardening option, not v1.
- **Hook intent:** v1 generic-only (no intent on the hook path). Capturing the
  last user prompt as a soft "session intent" (via a UserPromptSubmit hook) is a
  later phase, not v1.
- **Spawn cost on MCP hot path (2026-06-25):** Option A — the wiring phase uses
  a no-spawn `getDaemon` variant that returns `null` immediately when the daemon
  is unreachable, triggering in-process fallback with zero spawn latency. Opt-in
  spawn (env-gated) is not needed; falling back in-process is the correct default.

## Reuse / deprecate

- **Reuse:** `output-filter` (P1–P6 classifier/compressors/engine ranking),
  `content-store`, `retrieval` (BM25), `stats`, `policy`. No new engine.
- **Deprecate:** `llm-proxy` (`ANTHROPIC_BASE_URL`) for Desktop. The GUI
  "Conversation proxy" section becomes "Context daemon" status/control. Removal
  vs. keeping llm-proxy as a CLI-only non-desktop tool is a separate decision.

## Risk

**HIGH** (§12): context packer + memory schema + a `/exec` path that touches
user files + persistence. Mandatory: full superpowers chain + `architect`
design pass + `critic` adversarial review + worktree (no `main` edits).

## Testing strategy

- Pure engine functions: intent ranking, fit-to-budget, `recall` ordering.
- `daemon-client`: discovery read, auth, spawn race, in-process fallback when
  the daemon is unreachable.
- Security: `/exec` policy allow-list, path traversal / absolute-path rejection,
  token enforcement, loopback-only bind.
- Singleton: concurrent first-client spawn does not start two daemons.
- Integration: MCP `proxy_read_file(intent)` and the hook both produce a stored
  excerpt + a session-memory record against one daemon.

## Phasing (for the plan)

1. `daemon-client` + discovery + lockfile + lazy spawn (no engine yet).
2. Daemon `/excerpt` + `/expand` wrapping `output-filter` + `content-store`.
3. `/exec` policy-gated + `proxy_search_code` parity.
4. `session-store` + `/recall` + `mega_recall`.
5a. **Prerequisites for mcp-bridge wiring (OPEN):**
    - Extend each `proxy_*` tool env to carry `workspaceKey` + `liveSessionId`
      (sourced from the live-session mapping in `@megasaver/context-gate`).
    - Resolve chunk-store split: decide between migrating registry chunk sets to
      overlay layout OR adding a `/expand-registry` daemon route. Capture the
      decision as a spec update before phase 5b begins.
    - Note: daemon has no `/read-by-path` route (`/excerpt` only filters
      pre-captured raw); `proxy_read_file` may need a new daemon route or stays
      in-process permanently. Decision required.
5b. **Refactor `mcp-bridge` tools onto `daemon-client` (BLOCKED on 5a):**
    Reintroduce `forwardOrFallback` (Option A: no-spawn, immediate in-process
    fallback when daemon is down). Wire into `proxy_run_command` first (TDD: red
    test → green), then roll to remaining tools. `pnpm verify` green.
6. Refactor `mega hooks saver` onto `daemon-client` (generic).
7. GUI: "Context daemon" status/control; deprecate "Conversation proxy".
