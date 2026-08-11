---
feature: session-mesh
date: 2026-08-06
risk: HIGH
status: approved-design
pending: [user-spec-review, architect-pass, critic-pass]
reviewers: [code-reviewer, critic]
build-order: "1 of 11 (next-wave batch; see syntheses/vibe-coding-pains-2026)"
---

# Session Mesh v1 (A1 Bus + A2 Claims + A5 Live View)

## Problem

Parallel agent sessions in different terminals are islands: no
discovery, no messaging, no shared state, no conflict warning. The
2026 default is "agents have no idea the others exist" — the pain the
operator hits daily (terminal panes + hand-edited `wiki/agent-channel.md`
are manual workarounds). Multiplexer tools manage panes (tmux level);
nobody owns the agent-agnostic **semantic** session layer. Mega Saver
already has the primitives: session registry, MCP bridge, connector
hooks, daemon + launchd, atomic store writes.

## Goal

Any Mega Saver-connected session can (a) announce presence and status,
(b) discover live peers, (c) send/receive directed or broadcast
messages, (d) claim file paths and get warned when touching paths a
live peer claimed, (e) be observed via `mega mesh status`. Works for
Claude Code (hooks) and any CLI agent (MCP tools) with zero
agent-specific logic in core.

## Non-Goals (YAGNI)

- Blackboard / shared fact store (A3 — separate spec).
- Cross-agent task handoff (A4 — extends hot-handoff i10, separate).
- Automatic peer Q&A routing (A6 — separate spec).
- Blocking claims (v1 is warn-only; block mode is a later opt-in).
- Cross-machine mesh, network transport, team features.
- GUI panel (daemon push contract is designed GUI-ready; panel ships
  separately).
- Killing/terminating stale sessions (observe-only; we never touch a
  process we did not start).

## Locked Decisions

1. **Hybrid transport, files are truth.** Source of truth = append-only
   event log + presence/claim/inbox files under the store. The daemon
   is an optional accelerator (fs.watch push, GC); with the daemon
   down, every consumer works identically via polling. Mesh down ≠
   mesh broken.
2. **v1 scope = A1 + A2 + A5.** Bus (register/presence/message/ask),
   claim registry (advisory, warn-only), CLI live view.
3. **Delivery is pull-based, at-most-once.** Messages land in a
   per-session inbox; the receiving session drains it on its next hook
   fire (Claude Code) or explicit MCP poll (other agents), atomically
   (rename). No push into a running agent's context.
4. **Fail-open everywhere.** No mesh failure may ever break or block
   the agent's real work. Hook wrappers swallow and log; corrupt files
   are quarantined and recreated.
5. **Advisory claims with TTL.** Claims refresh with heartbeat; a dead
   session's claims expire (TTL default 30 min, configurable). Claims
   never block in v1 — they warn.
6. **Repo-family-scoped by default.** Presence records carry
   `repositoryFamilyKey` — the canonical repo family identity (reuse
   the saver-activation identity: caseMode-aware `realpath.native`,
   NFC) — whenever the registering hook can resolve it. v1 matching
   rule: peer queries and conflict checks match on
   `repositoryFamilyKey` when BOTH records carry it; otherwise they
   fall back to `workspaceKey` equality. Sibling worktrees of one
   repo therefore see each other (same family key, different
   workspace keys). `--all` widens.
7. **Package placement:** new `@megasaver/mesh` package. Core stays
   agent-agnostic; mesh knows nothing about specific agents; the
   Claude Code connector and MCP bridge adapt.

## Architecture

```
store/mesh/
  presence/<liveSessionId>.json    heartbeat + status + identity
  events.jsonl                 append-only bus log (rotated, GC'd)
  claims/<claimId>.json        advisory path claims
  inbox/<liveSessionId>/<msgId>.json  pending directed messages
```

Writers: hook handlers, MCP tools, CLI. Readers: same + daemon
(watch → GUI/`--follow` push) . All writes atomic (`.tmp` + rename);
events.jsonl is append-only line-JSON, torn lines skipped on read.

## Components

### 1. `@megasaver/mesh` (new package)

Public API (Zod-validated at boundaries):

- `registerSession(reg)` → presence file; called on session start.
- `heartbeat(liveSessionId, patch?)` → refresh lastSeenAt, optionally
  patch status/task label. Cheap (single small file write, debounced
  ≥5 s).
- `setStatus(liveSessionId, status)` — `working | blocked | idle |
  done`.
- `listPeers(filter)` → live presence records; staleness derived from
  lastSeenAt (stale > 90 s, dead > 10 min — constants, config later).
- `postEvent(evt)` / `readEvents({since, repo})` — bus log.
- `sendMessage({to, from, kind: message|ask|answer, text})` → inbox
  write + event. Text passes SECRET-REDACT before persist.
- `drainInbox(liveSessionId)` → atomic claim of pending messages.
- `claimPaths({liveSessionId, paths, intent})` /
  `releaseClaim(claimId)` / `checkConflicts(liveSessionId, paths)` →
  conflicting live claims.
- `gc()` — expire dead presence, expired claims, rotate events.jsonl
  (size cap 5 MB / age 7 d), drop inboxes of dead sessions.

### 2. Claude Code connector integration

v1 adds **no new hook processes and no settings.json changes**: mesh
logic rides the three existing installed handlers (each already
spawns per event), keeping process count and install surface flat:

- `warmup-run` (SessionStart) → `registerSession` (+ intent label).
- `saver-run` (PostToolUse) → `heartbeat` (fire-and-forget, mtime-
  debounced ≥5 s; hot-path guard test asserts no added awaited I/O
  on the saver decision path).
- `guard-run` (PreToolUse, matcher `Bash|Edit|Write|MultiEdit|
  NotebookEdit`) → `checkConflicts` on target path(s) — on conflict,
  `additionalContext` warning (claimant session, agent, task label,
  claim age; never blocks) — and `drainInbox` → inject pending
  messages as `additionalContext` (bounded: ≤ 5 messages / ≤ 2 000
  tokens per drain; overflow stays queued).
- Sessions with the guard hook uninstalled (it is optional) lose
  conflict warnings and hook-side drain; MCP `mesh_poll` remains.
  Accepted degradation, documented in `mega mesh status`.
- Dedicated mesh hooks (own settings entries, Stop-hook done-status)
  are explicitly deferred to v1.1.

### 3. MCP bridge tools (for hook-less agents)

Seven tools: `mesh_claim`, `mesh_events`, `mesh_peers`, `mesh_poll`
(drain own inbox), `mesh_release`, `mesh_send`, `mesh_status_set`.
Ask/answer are not separate tools — they are `mesh_send` kinds
(`{kind: "ask" | "answer"}`); `mesh_events` exposes the bus log.
Registration follows the existing tool registration pattern; every
tool validates input with the shared schemas and calls
`@megasaver/mesh` directly.

### 4. CLI

- `mega mesh status [--all] [--follow]` — peers table: session, agent,
  repo, branch, task, status, age, last event. `--follow`: daemon push
  when available, else 2 s poll.
- `mega mesh send <session|agentName> "<text>"`
- `mega mesh claims [--repo]`
- `mega mesh events [--since] [--follow]`
- `mega mesh gc`

### 5. Daemon accelerator (optional path)

The daemon is request-driven today (no filesystem watching; lazy-
spawn, Bearer-token loopback HTTP). v1 adds one route, GET
`/mesh/status`, which reads the presence/claims dirs on request and
returns the live view — consumed by `--follow` CLI (when a daemon is
already running; never spawns one) and later the GUI bridge. Daemon
absent → CLI polls files directly (2 s). fs.watch push is explicitly
deferred; gc runs opportunistically on CLI/hook invocations
(probabilistic: ~1/50 calls, cheap mtime check first).

## Error handling

- Every hook entry point wrapped: catch-all → exit 0, optional debug
  log under store; never stderr noise into the agent.
- Corrupt presence/claim/inbox JSON → quarantine to
  `store/mesh/quarantine/` + recreate empty (recovery precedent).
- events.jsonl: skip unparsable lines; rotation is copy-truncate-free
  (rename + new file) to avoid Windows lock issues.
- Clock skew: staleness is computed from the persisted `lastSeenAt`
  field; a negative age (future skew) resolves to "live". File mtime
  is used only for the heartbeat debounce check.
- Session id collision/reuse: presence keyed by the megasaver
  `liveSessionId` (registry-issued), not agent-native id; agent-native
  id stored as metadata.

## Security & privacy

- All user text (messages, task labels) through SECRET-REDACT before
  persist (session-intent mechanism).
- Store is user-local; no network surface. Claims store repo-relative
  paths only. Inbox files 0600 on POSIX (store default perms).
- Injected `additionalContext` is data, not instructions: injection
  template labels messages as untrusted peer text.

## Testing

- Unit: schemas, staleness math, claim conflict logic (glob overlap),
  inbox atomic drain (concurrent drains → at-most-once), redaction
  applied, GC rules.
- Integration: two simulated sessions over a temp store — register →
  peers → send/ask → drain → claim → conflict warning → done/release.
  Hook handler tests per cli-test-pattern (stdin payload fixtures).
- Hot-path guard: test asserts the saver decision path adds no awaited
  mesh I/O (heartbeat is fire-and-forget) — lazy import guard like the
  indexer precedent.
- Windows CI leg: no fs.watch on truth path; polling test; rename
  semantics.
- No timing-tight assertions (CI-slowness lessons: structural guards,
  wide windows).

## Risk & process (§12 HIGH)

Session storage format + hot-path hooks ⇒ HIGH. Chain: this spec →
user spec review → architect pass (fresh context) → plan → worktree
`feat/session-mesh` → TDD → `code-reviewer` AND `critic` separate
passes → verifier evidence. No aggressive compression of evidence in
research (evidence-preserving only).

## Dependencies / build order

- Reuses: shared atomic write + locks, workspace/repo identity
  (saver-activation spec), SECRET-REDACT, session registry, MCP bridge
  registration, connector hook install pattern, daemon watch plumbing.
- Enables: A3 blackboard (bus events), A6 peer Q&A (ask/answer kinds),
  A4 cross-agent handoff (presence + inbox as carrier), C-cluster live
  burn column (stats join).

## Open questions (tracked, non-blocking)

- Heartbeat piggyback debounce constant (5 s) — tune after dogfood.
- Whether `mega mesh status` shows per-session token burn in v1
  (needs stats join; ship if trivial, else fast-follow).
