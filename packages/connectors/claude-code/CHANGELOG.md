# @megasaver/connector-claude-code

## 1.4.0

### Minor Changes

- 8db0074: Mistake Firewall (guard): PreToolUse hook intercepts Bash/edit calls matching stored failures and warns the agent mid-mistake with the estimated original cost. Durable bounded guard corpus captured on the proxy path; three-tier pure matcher (exact / path+text / BM25); outcome feedback loop with signature overlap + auto-mute; `mega guard` CLI (status/mode/events/mute/check); `check_approach` MCP tool with a free 7-day window (also applied to `find_similar_failures`); Pro retry-cost-avoided line in roi/savings surfaces. Free warn interception + Pro strict-deny / events ledger / cumulative analytics, all under the existing `savings-analytics` entitlement key.
- 6312ef3: Warm Start: budgeted session boot brief for every agent. A pure assembler
  (`assembleWarmStartBrief`) renders standing rules, decisions, open todos,
  branch-touching failed attempts, git delta, and hot-spot entities into a
  hard-budgeted markdown brief (default 2000 tokens; micro <4h = 300; reonboard
  > 14d shows what changed while you were away). Delivered via a fail-open
  > Claude Code SessionStart hook (`mega hooks warmup`, installed by
  > `mega hooks install`, opt-out `--no-warmup`), `mega warmup` on stdout, a
  > Pro-gated cross-agent sentinel block (`mega warmup --write`, refreshed by
  > `mega connector sync`), and an MCP `get_warm_start_brief` tool. Reporting is
  > measured-only: a separate `WarmStartEvent` (never a TokenSaverEvent) feeds a
  > "Warm start: N sessions warmed" line in savings history/insights.

### Patch Changes

- Updated dependencies [4403f40]
- Updated dependencies [eb74c35]
- Updated dependencies [5f8bbdb]
- Updated dependencies [6d40d2c]
- Updated dependencies [8db0074]
- Updated dependencies [2459179]
- Updated dependencies [6312ef3]
  - @megasaver/core@1.4.0
  - @megasaver/connectors-shared@1.3.0

## 1.3.0

### Minor Changes

- 5695012: Saver observability wave 4 (E21-E29): a dead saver is now visible. The
  per-workspace heartbeat registry becomes a full liveness ledger — hook
  failures (with a coarse kind), successful completions, and daemon
  fallbacks are recorded best-effort and surfaced in `mega session saver
resolve`, `mega hooks status`, and a new `mega doctor` verifier section
  (registration, binary, store bake, heartbeat liveness, spawned self-test,
  daemon ping). Corrupt per-session overlay summaries self-heal from their
  events JSONL (stamped `rebuiltAt`); summary read-modify-writes are
  serialized by a new stale-aware `withFileLock` in `@megasaver/shared`
  (which also unfreezes the heartbeat lock), and the daily GC sweep
  reconciles summaries that lag their JSONL. `mega hooks install` now
  registers hooks by absolute CLI path with explicit timeouts, bakes
  `--store` for non-default stores, and migrates legacy bare entries in
  place; `mega hooks status <id>` also resolves live overlay sessions, and
  the no-arg form aggregates savings and liveness across workspaces.

### Patch Changes

- ce66902: Saver coverage wave 1: the PostToolUse saver now compresses Task/subagent
  reports, BashOutput/Monitor retrievals, WebSearch/ToolSearch results, and
  third-party `mcp__*` tool outputs whose response exposes a recognized text
  shape (bare string, `{result}`/`{content}`, or a text content-block array) —
  16 KiB conservative floor; Mega Saver's own `mcp__megasaver__*` bridge is
  excluded. Any unrecognized response shape safely falls through untouched.
  Plus Grep files-mode/Glob
  filename arrays, Bash stderr (larger-stream slot), and the text blocks of
  mixed content arrays. Recovery is now real: `fetchChunk` reads hook-written
  overlay chunk sets, so the compression footer's new
  `mega output chunk "<set>" "0"` instruction works in every session (and an
  expansion is never itself re-compressed). `mega hooks install` repairs a
  stale hook matcher in place, and both hook matchers are anchored so they
  never over-match unrelated tool names.
- Updated dependencies [64a5300]
- Updated dependencies [b91c052]
- Updated dependencies [5695012]
  - @megasaver/core@1.3.0
  - @megasaver/shared@1.3.0
  - @megasaver/connectors-shared@1.2.2

## 1.2.1

### Patch Changes

- @megasaver/core@1.2.1
- @megasaver/connectors-shared@1.2.1

## 1.2.0

### Minor Changes

- 297ebc2: Persistent proxy routing: one explicit CLI/GUI action persistently enables the
  local proxy for future supported Claude launches, owned by a dedicated
  supervisor LaunchAgent that reconciles desired↔actual state and never touches a
  foreign route or a process it did not start. Fixes the 2026-07-02 finding where
  the proxy was healthy but no client was routed (zero metering), and removes the
  GUI's boot/shutdown route-clearing that could strand a session.

  - `@megasaver/llm-proxy`: a nonce-bound ownership health endpoint (HMAC
    challenge-response) answered in-process and never forwarded upstream.
  - `@megasaver/proxy-control` (NEW, agent-agnostic): strict versioned control/
    runtime state stores; fenced owner identity + locks (pid + start-token +
    boot-id, PID-reuse-safe); the reconciliation recovery matrix as a pure,
    exhaustively-tested decision (a foreign route is never removed, no route is
    applied in a disable/drain transition, remove targets only a leased exact
    owned url); supervisor wiring (startup fixpoint + 5s monitor); and a macOS
    LaunchAgent adapter (structured plist, legacy-service-present manual bootout,
    idempotent-by-observation, foreign untouched).
  - `@megasaver/connector-claude-code`: a value-guarded Claude route adapter
    (inspect/apply/removeExpected/ensureHooks) that owns the `~/.claude/settings.json`
    route and never overwrites/removes a foreign value.
  - `@megasaver/cli`: `mega proxy start` (persist an enable intent + install the
    supervisor LaunchAgent), `stop` (enter drain) and `stop
--confirm-clients-restarted` (finish drain: stop the listener + reach terminal
    idle), `status [--json]` (read-only; separated facts + saver liveness from the
    heartbeat registry), `service uninstall --confirm`,
    and the internal `proxy supervise` daemon. The daemon binds a health-capable
    loopback listener and runs the reconcile state machine on a 5s cadence under a
    fenced transition lock, so a persisted enable intent becomes a live, verified
    route (closing the "healthy but unrouted" gap). `--upstream` is schema-
    validated and a non-default origin requires `--confirm-credential-forwarding`.
    **Public behavior break:** the old foreground `mega proxy start` is now
    `mega proxy supervise`.
  - `@megasaver/gui`: the proxy toggle persists desired state through the shared
    control plane (also under the transition lock) and no longer owns a listener,
    clears the route, or runs osascript.

  Security hardening (CRITICAL review): the handler forwards with
  `redirect:"manual"` (a cross-origin 3xx can't re-send the API key) and answers
  the reserved health path locally (never forwarded); the route mutator fsyncs and
  preserves file mode; the usage log is 0600/0700, symlink-refusing, with a bounded
  control-char-stripped model label; the lock re-judges quarantined content so a
  live owner is never stolen; the LaunchAgent verifies the managed plist byte-exact
  and restores a backed-up legacy plist on bootstrap failure.

  Deferred (flagged): the full GUI auth bootstrap (launch capability → HttpOnly
  SameSite cookie + CSRF) and cross-process supervisor discovery (runtime.json +
  control server). The single self-driving supervisor needs neither to route.

### Patch Changes

- Updated dependencies [326ed5a]
- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/connectors-shared@1.2.0
  - @megasaver/core@1.2.0
  - @megasaver/shared@1.2.0

## 1.1.0

### Minor Changes

- 8ff3003: Agent Office Phase 1: add the agent-agnostic AgentLauncher interface
  (+ LauncherError) and a claude-code adapter that runs one headless
  `claude -p` task with stream-json output. Spawn is injectable; the
  engine/supervisor wiring lands in Phase 2.
- de4ffb2: Agent Office Phase 2: supervisor engine, permission gating, audit log

  - `@megasaver/agent-office`: add `createSupervisor` (processNextTask /
    drainAgent / runWorkspace), `resolveLauncherPermission` (safe-by-default
    full gate), `createLauncherRegistry`, `auditEventSchema` /
    `appendAudit` / `listAudit`. Tighten `workspaceKey` to `workspaceKeySchema`
    on `OfficeAgent` and `OfficeTask`. Add `permission_denied` and
    `launcher_not_registered` error codes.

  - `@megasaver/connectors-shared`: `LaunchHandle.cancel(signal?)` now accepts
    an optional `NodeJS.Signals` argument (default `SIGTERM`).

  - `@megasaver/connector-claude-code`: forward `cancel(signal?)` to
    `child.kill(signal ?? "SIGTERM")`.

- a71f06e: Add an in-app "Connect Saver hook" toggle. The Token saver panel can now
  install/uninstall the global Claude Code Mega Saver hooks
  (`~/.claude/settings.json`) in the background, replacing the terminal-only
  `mega hooks install claude-code`. Hook-settings logic moved into
  `@megasaver/connector-claude-code` (new `uninstall`/`status` functions),
  exposed via a global bridge route `/api/hooks/claude-code` (GET/POST/DELETE)
  and a symmetric CLI `mega hooks uninstall claude-code`.
- da6e687: Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
  and fills it as the ranking intent for PostToolUse-captured native output when no
  explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.

### Patch Changes

- 968f76b: Compress WebFetch output via the PostToolUse saver hook. `WebFetch` is added to
  the saver matcher and mapped to the `fetch` source kind, and the tool-response
  reader now handles WebFetch's shapes (a bare string or `{ result: string }`),
  swapping in compressed text while preserving the original schema. Output that is
  already small still passes through unchanged.
- Updated dependencies [7fcd881]
- Updated dependencies [8ff3003]
- Updated dependencies [de4ffb2]
- Updated dependencies [44931b7]
- Updated dependencies [0a3256b]
- Updated dependencies [e2f7867]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [031f6de]
- Updated dependencies [391e659]
- Updated dependencies [31238a3]
- Updated dependencies [4e8c6e8]
- Updated dependencies [abfaf3b]
- Updated dependencies [a2b5643]
- Updated dependencies [4be82f8]
- Updated dependencies [900ce56]
- Updated dependencies [900ce56]
- Updated dependencies [f1fe1d3]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [27960fb]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [484f243]
- Updated dependencies [00bd97e]
- Updated dependencies [1db07df]
- Updated dependencies [39e5eb6]
- Updated dependencies [f46ce66]
- Updated dependencies [4fe5749]
- Updated dependencies [4c184db]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/connectors-shared@1.1.0
  - @megasaver/core@1.1.0

## 1.0.2

### Patch Changes

- @megasaver/core@1.0.2
- @megasaver/connectors-shared@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [a2526d3]
  - @megasaver/core@1.0.1
  - @megasaver/connectors-shared@1.0.1

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- 59fca3a: Add the initial Claude Code connector with deterministic root `CLAUDE.md`
  managed-block rendering, validation, and sync helpers.
- a3a4401: Refactor `@megasaver/connector-claude-code` to delegate render, parse,
  upsert, remove, and filesystem operations to
  `@megasaver/connectors-shared`. Rendered block is byte-identical
  (regression test asserts).

  BREAKING (input shape): `ClaudeCodeContextSchema` now requires a
  top-level `agentId: "claude-code"` field — previously the agent
  identity was hardcoded inside the renderer and the schema only
  validated `{ project, session, memoryEntries }`. Callers constructing
  a `ClaudeCodeContext` literal must add `agentId: "claude-code"`. All
  exported function names and rendered output remain unchanged.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [0c30651]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [a3a4401]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/connectors-shared@1.0.0
  - @megasaver/core@1.0.0
