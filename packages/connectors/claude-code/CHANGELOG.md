# @megasaver/connector-claude-code

## 1.7.0

### Minor Changes

- fe8fbf8: Claim-Verification Gate: exec receipts now record the child exit code
  (`childExitCode`, additive-optional on both token-saver event schemas);
  new `mega verify claims` scans caller-provided text for success claims
  and joins them to receipts in a time window (`--json`, `--strict`);
  opt-in Stop-hook reminder via `mega verify enable-hook` (warn-only,
  fail-open, off by default).
- a5c107c: Exec-Rewrite Saver (wave-2 #1): opt-in PreToolUse mode that rewrites eligible
  flat-token Bash commands to `mega output exec-live` before execution, so the
  compressed chunk-store-backed output is the only version the client ever
  caches. Adds the `^Bash$` exec-rewrite hook entry (tri-state `--exec-rewrite`
  install flag), the exec-live delivery path (raw byte-identical on decline,
  child exit always mirrored, LD13 self-validation), the PostToolUse saver
  exemption for exec-live invocations, and an additive `origin: "exec-rewrite"`
  field on overlay saver events (per-origin selector deferred to the UI wave).
- 9c69e21: `mega up` one-command activation (plan/apply/verify + undo manifest), `mega down` manifest-driven reversal, and a `planClaudeCodeHookInstall` dry-run on the Claude Code connector.

### Patch Changes

- 929c8b4: `compaction-guard`: reconnect post-compact agents to intra-session overlay
  receipts without repeating prior tool runs. Snapshot on PreCompact
  (`mega hooks capsule`), bounded recap context injection on SessionStart
  (`mega hooks recap`, ≤2,000 tokens), and reconnected `chunkSets` and `capsule`
  legs in `loadFailureSnapshot`. Installed by default with `--no-compaction-guard`
  opt-out.
- 4ff4855: `mega alerts --failures`: free, session-scoped silent-failure report —
  four detectors (tool-error, context-overflow, partial-completion,
  hallucinated-state) over existing overlay stores, alerts-style table +
  `--json`, per-detector opt-out, `--strict` CI exit. Detectors with no
  backing signal report `no-signal`, never a guess. Opt-in warn-only Stop
  hook (`mega hooks failure-scan`, off by default) fires when a session
  stops with an unresolved failing receipt. Core re-exports the read-index
  surface; the connector hook-command union gains `failure-scan`.
- Updated dependencies [962f42a]
- Updated dependencies [e565cc3]
- Updated dependencies [e24685e]
- Updated dependencies [00ab087]
- Updated dependencies [7103d8c]
- Updated dependencies [bd091b5]
- Updated dependencies [4ff4855]
- Updated dependencies [3071152]
  - @megasaver/core@1.8.0
  - @megasaver/connectors-shared@1.6.0

## 1.6.0

### Minor Changes

- db91dd3: Add Session Mesh Family (A1→A5) — local, file-backed session mesh.

  New leaf package `@megasaver/mesh` (files are truth, `store/mesh/`): presence register/heartbeat/listPeers/gc/events, at-most-once inbox (redacted, bounded drain), advisory claims (TTL 30m, repo-family scoping, glob via NFA), structured board (post/list/resolve/promote, disputed/supersede, TTL, 500-token injection), peer Q&A routing (`mesh_send` kind ask/answer, 60s rate-limit, keyword hint ≥3 overlap ≤200/30m ≤500 chars), handoff capability (`HandoffCapabilityProfile` on every `ConnectorTarget`, `evaluateHandoffFit` measured on rendered block, `open` strict vs `--fit`, `peers`/`offer` pointer-only). CLI `mega mesh {status,send,ask,answer,claims,events,gc}`, `mega board {post,list,resolve,promote}`, `mega handoff {peers,offer}` + `open --fit` / `pack` advisory, MCP 10 tools (`mesh_*` 7 + `board_*` 3) + `handoff-offer` bus kind, hooks (warmup register, saver heartbeat fire-and-forget ≥5s, guard conflict+inbox inject bounded 5/2000, board digest/delta 500/30s, `mesh-hint` opt-in `--mesh-hints`), daemon `GET /mesh/status` accelerator. All writes atomic tmp+rename 0600/0700, torn lines skipped/quarantined, every hook catch→exit 0, every user text through `redact()` before persist, advisory-only (warn, never block).

### Patch Changes

- Updated dependencies [db91dd3]
- Updated dependencies [db91dd3]
  - @megasaver/core@1.7.0
  - @megasaver/connectors-shared@1.5.0

## 1.5.2

### Patch Changes

- Updated dependencies [bb15ced]
  - @megasaver/core@1.6.0
  - @megasaver/connectors-shared@1.4.2

## 1.5.1

### Patch Changes

- @megasaver/core@1.5.1
- @megasaver/connectors-shared@1.4.1

## 1.5.0

### Minor Changes

- c3ccc07: Add an opt-in `mega cache --suffix-audit` read-only analysis. The Pro gate
  runs before any usage or settings I/O; free-tier invocations read neither.
  The audit adds a closed `suffixAudit` object to `--json` output only (plain
  `mega cache --json` stays byte-compatible) with a `measured-global`
  composition over exactly the four measured token classes — a zero denominator
  reports `no-usage` with null shares, never a misleading 0% — plus static
  Claude settings risks from a closed code union (duplicate owned hooks,
  foreign custom base URL, missing first-party flag on the owned route,
  settings unreadable/malformed, generated-output byte variance).

  Composition is measured fact, not an avoidable-cost claim: a cache-write
  share is the share of measured tokens, not a savings prediction. No risk
  carries a free-text detail, so URLs, commands, secrets, paths, and settings
  content never appear in the report.

- 7319277: Restore Claude Code first-party prompt caching behind the proxy. The route
  installer now writes `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` next to
  `ANTHROPIC_BASE_URL` (default upstream only) and removes it with the route,
  eliminating the custom-base-URL cache penalties: inline tool schemas
  (+90k tokens/request), uncached hook-output tail (~20k/session), and
  cold-cache double writes (up to 176k tokens).

  For an already-running proxy installed by an older version, run
  `mega proxy start --restart-supervisor` once after upgrading. The explicit
  managed-job restart loads the new monitor, which safely heals the owned route.

- 509cc8a: Extend the Claude Code PreToolUse cache adviser to a narrow class of
  read-only Bash commands. Only two content-free grammars qualify — recursive
  grep with an explicit `-e` pattern over relative paths, and a directory find
  with optional `-type` / `-print` — under a 4,096-byte / 64-token budget with
  ASCII-space tokens. Shell syntax, path escapes, option clusters, absolute
  executables, rg, git, and mutating forms never match.

  Before any advice, all five gates must pass: POSIX with the default store, a
  uniquely resolved project whose canonical root equals the hook cwd, exactly
  one open claude-code registry session, storeRawOutput enabled, and the exact
  reconstructed argv accepted by the existing policy and permissions preflight.
  The advice names only the registry session UUID and tells the agent to rerun
  the same approved command through `mega output exec`; it never restates the
  command, argv, pattern, paths, or permission details, and adds no
  permissionDecision or input rewrite. A family is offered once per session.

  This phase does not run, rewrite, deny, or grant any Bash command. An advice
  event records only that guidance was offered — it is not evidence that the
  agent adopted the route, and it makes no token or cost-savings claim. Advice
  state evolves to version 3 (offeredOutputRouteFamilies) inside the existing
  secure capsule transaction; malformed, v1, and unknown-future state stays
  untouched. Windows continues to create no hook state at all.

### Patch Changes

- f6b3fb2: Add an optional Claude Code PreToolUse batch-read adviser. After two eligible
  Read, Grep, or Glob calls in the same directory within sixty seconds, the hook
  offers one concise `additionalContext` suggestion for batching the remaining
  exploration. The current call stays native and remains subject to Claude Code's
  permission controls; the adviser never returns an allow or deny decision.

  An advice event records only that guidance was offered. It is not a
  token-saving event and makes no claim that the agent followed the advice or
  that any tokens were saved.

  Harden the adviser as a POSIX-only, owner-private version-2 transaction. An
  exclusive lock per canonical workspace and safe session serializes the
  read/decide/durable-rename boundary; contention or an abandoned lock safely
  suppresses optional advice instead of waiting or stealing a lease. Filesystem
  operations retain exact canonical realpaths while only an NFC copy enters the
  domain-separated directory hash. State is byte- and count-bounded, rejects
  legacy and special-node paths, and expires after thirty days; the same strict
  retention removes only owned UUID transaction temps. `hooks status --settings`
  reports advice installation from a custom settings file. Windows omits or
  removes only the owned advice hook and creates no adviser state. Fresh
  standalone-bundle and installed-tarball-bin smoke tests now exercise the
  two-call contract; the behavioral benchmark remains unmeasured, so this
  hardening adds no savings claim.

  Move adviser state into opaque per-record v3 capsules under
  `stats/cache-advice-v3`, enrolled in a bounded durable FIFO so the daily sweep
  claims at most eight frames behind a frozen tail — continuous activity can no
  longer starve an expired record out of the thirty-day retention contract. A
  single-flight off-hook maintainer (`mega hooks cache-advice-maintain`,
  triggered detached from install and from hooks that observe an incomplete
  migration) converts legacy flat state outside the PreToolUse response path:
  valid version-2 snapshots move into enrolled capsules, unparseable state
  becomes an opaque suppression, and migration completes only after a final
  clean rescan. Windows still creates none of these nodes, and no advice event
  is or becomes a cost-savings measurement.

- d270c93: fix: hook install/uninstall no longer widens `~/.claude/settings.json` permissions

  `mega hooks install`, `mega hooks uninstall`, `mega init` and the GUI "Connect
  Saver hook" toggle all rewrote the operator's global Claude Code settings file
  through a temp file created with no mode, so `rename()` swapped in a fresh
  inode at `0644` under the default umask. A deliberate `chmod 600` (or `400`) on
  a file holding `env.ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` was silently
  discarded on every hook write, leaving a live API key world-readable.

  All settings writes now go through one hardened writer
  (`src/settings-write.ts`, extracted from the existing proxy-route writer):
  the existing mode is preserved exactly, a file created fresh is `0600`, the
  write is fsynced and atomic, and a read-only preserved mode (`0400`) no longer
  fails the write.

  **Already-widened files are not healed** — the writer preserves the mode it
  finds, so a file a previous install left at `0644` stays there. `mega doctor`
  now reports the mode as `claude-code-settings-perms` and warns with
  `chmod 600 ~/.claude/settings.json` when the file is group- or world-accessible.
  It is a read-only warning: nothing chmods the operator's agent config for them,
  and the doctor's exit code is unaffected.

  **Behaviour change:** a symlinked `~/.claude/settings.json` (dotfiles-repo
  setups) is now **refused with an error** instead of being silently replaced.
  Previously the rename destroyed the symlink and orphaned the dotfiles-repo
  target, so the operator's tracked file quietly stopped receiving changes.
  `mega proxy` already refused symlinks; hook writes now match. Point
  `--settings` at the real file, or replace the symlink with a copy.

- 6ea5968: Add an optional POSIX Task Kickoff response with session-global at-most-once
  delivery, canonical unique-project selection, and owner-only persistence.
  Recognize and deduplicate only supported first-party hook launchers, refuse
  symlinked or non-regular accounting targets through a no-follow, nonblocking
  descriptor, and make the irreversible stdout accounting boundary explicit.
  Ship the sidecar-free Node 22 bundle behind a full-minification, sub-12 MiB CI
  gate; Windows continues to emit no Task Kickoff output or state.
  This release makes no measured cache-write savings claim; that remains gated on
  a paired fresh-store benchmark with task-parity and total-cost evidence.
- Updated dependencies [07a4e3d]
- Updated dependencies [88e479a]
- Updated dependencies [89eea64]
- Updated dependencies [07a4e3d]
- Updated dependencies [1ecbaef]
- Updated dependencies [0ad461a]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
  - @megasaver/core@1.5.0
  - @megasaver/connectors-shared@1.4.0
  - @megasaver/shared@1.3.1

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
