# @megasaver/llm-proxy

## 0.3.1

### Patch Changes

- 58057c1: Address the independent code-reviewer and critic passes on the cache-advice
  range. Every fix is behavior- or durability-hardening; the public CLI and
  hook surfaces are unchanged.

  - Durability (review P1): capsule state/suppression deletion, the GC sweep
    lock release, and future-timestamp normalization now fsync the parent
    directory after the unlink/futimes, so a deleted entry or normalized node
    is durable across a crash — matching the fair-GC spec §2.2 promise.
  - Queue liveness (review P1): the off-hook maintainer now compacts the
    append-only v3 work log under the no-wait queue lock, dropping fully
    consumed bytes and rewriting control offsets via a durable
    new-file + fsync + rename + parent-directory fsync. Without compaction the
    1 MiB log cap eventually silenced new enrollments permanently.
  - Output-route gate (critic): the default-store gate compares canonical real
    paths, so a symlinked or relatively-spelled path to the default store is
    correctly treated as the same store instead of suppressing advice.
  - Composition integrity (critic): usage-event token counts are capped far
    below 2\*\*53 at the schema boundary, and `cacheComposition` reports an
    `overrange` status with null shares rather than a corrupted 0%/100% when a
    sum loses float64 integer precision.

  The cache-advice GC spec §2.1 records the accepted single-JSONL work log +
  control-offset design (head/inflight replay is the WAL) in place of the
  originally-specified `transition.json`, and the output-route grammar's
  SAFE_WORD is pinned to its exact implemented ASCII-safe class. No token or
  cost-savings claim is made.

- 1ecbaef: Bound the SSE usage scanner's partial-line buffer.

  `createSseUsageScanner` appended every chunk to `leftover` and only drained on a
  newline, so a stream that never emitted one grew it without bound — contradicting
  the handler's own invariant that streaming size is irrelevant to memory. A
  usage-bearing line is one small JSON event, so past `MAX_SSE_LINE_CHARS` the
  oversized partial is dropped and the scanner resyncs at the next newline. Usage
  totals for well-formed streams are unchanged.

## 0.3.0

### Minor Changes

- b91c052: Saver metrics honesty wave 5 (F30-F34): every reported number now counts
  the bytes actually delivered to the model, and no ratio divides mismatched
  scopes. `recordAndFilterOverlayOutput` computes the persisted
  returnedBytes/bytesSaved/savingRatio from the FINAL delivered text — D16
  elision markers plus the recovery footer, which now renders inside record
  (new canonical `buildRecoveryFooter` + `includeFooter` flag, wired through
  the saver hook and the daemon /excerpt schema) — and degrades to
  passthrough with ZERO side effects when a compressed replacement would be
  net-negative. Overlay events carry `secretsRedacted`/`chunksStored`, so
  summary rebuilds recover both counters without carryForward, and the GC
  reconcile counts schema-valid lines only (garbage lines no longer force a
  rebuild every sweep). The proxy usage reader tolerates torn JSONL lines
  and `mega audit usage` reports the skipped count, matches a GLOBAL savings
  numerator to the global usage denominator, adds a per-workspace savings
  breakdown (no unattributable ratios), and carries a scoped-ratio branch
  for future workspace-keyed usage rows. The proxy supervisor re-applies a
  removed route in place (lease kept; counter surfaced by the new
  `saver-proxy-route` doctor check), and metering is no longer framed as
  saving: `saver_mediated_token_savings`, `mediation: "saver_hook"`, and an
  explicit metering note in the audit report.

## 0.2.0

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

## 0.1.0

### Minor Changes

- f674fdd: Add an opt-in local Anthropic-API proxy (Phase 0): `@megasaver/llm-proxy` +
  `mega proxy start`. It binds 127.0.0.1, forwards `/v1/messages` (and all paths)
  to the upstream **unchanged** (transparent passthrough, streaming preserved),
  and records each round-trip's real token usage from Anthropic's `usage` —
  counts + model only, never prompts, responses, or auth keys. This is the
  measurement foundation for conversation-token saving (compression is a later
  phase). Relaxes mission §1 "not a model proxy" to permit this opt-in proxy.
