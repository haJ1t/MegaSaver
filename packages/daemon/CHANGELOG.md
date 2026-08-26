# @megasaver/daemon

## 0.5.1

### Patch Changes

- Updated dependencies [297f9ac]
  - @megasaver/shared@1.3.2
  - @megasaver/content-store@1.2.3
  - @megasaver/context-gate@0.9.1
  - @megasaver/core@1.8.1
  - @megasaver/memory-recall@0.1.3
  - @megasaver/mesh@0.2.1
  - @megasaver/output-filter@1.8.1
  - @megasaver/retrieval@1.0.5
  - @megasaver/stats@1.7.1

## 0.5.0

### Minor Changes

- a5c107c: Exec-Rewrite Saver (wave-2 #1): opt-in PreToolUse mode that rewrites eligible
  flat-token Bash commands to `mega output exec-live` before execution, so the
  compressed chunk-store-backed output is the only version the client ever
  caches. Adds the `^Bash$` exec-rewrite hook entry (tri-state `--exec-rewrite`
  install flag), the exec-live delivery path (raw byte-identical on decline,
  child exit always mirrored, LD13 self-validation), the PostToolUse saver
  exemption for exec-live invocations, and an additive `origin: "exec-rewrite"`
  field on overlay saver events (per-origin selector deferred to the UI wave).

### Patch Changes

- Updated dependencies [962f42a]
- Updated dependencies [fe8fbf8]
- Updated dependencies [929c8b4]
- Updated dependencies [e565cc3]
- Updated dependencies [a5c107c]
- Updated dependencies [9f87069]
- Updated dependencies [e24685e]
- Updated dependencies [00ab087]
- Updated dependencies [7103d8c]
- Updated dependencies [a545d81]
- Updated dependencies [8c1454c]
- Updated dependencies [bd091b5]
- Updated dependencies [4ff4855]
- Updated dependencies [3071152]
  - @megasaver/stats@1.7.0
  - @megasaver/core@1.8.0
  - @megasaver/context-gate@0.9.0
  - @megasaver/content-store@1.2.2
  - @megasaver/output-filter@1.8.0
  - @megasaver/memory-recall@0.1.2

## 0.4.0

### Minor Changes

- db91dd3: Add Session Mesh Family (A1→A5) — local, file-backed session mesh.

  New leaf package `@megasaver/mesh` (files are truth, `store/mesh/`): presence register/heartbeat/listPeers/gc/events, at-most-once inbox (redacted, bounded drain), advisory claims (TTL 30m, repo-family scoping, glob via NFA), structured board (post/list/resolve/promote, disputed/supersede, TTL, 500-token injection), peer Q&A routing (`mesh_send` kind ask/answer, 60s rate-limit, keyword hint ≥3 overlap ≤200/30m ≤500 chars), handoff capability (`HandoffCapabilityProfile` on every `ConnectorTarget`, `evaluateHandoffFit` measured on rendered block, `open` strict vs `--fit`, `peers`/`offer` pointer-only). CLI `mega mesh {status,send,ask,answer,claims,events,gc}`, `mega board {post,list,resolve,promote}`, `mega handoff {peers,offer}` + `open --fit` / `pack` advisory, MCP 10 tools (`mesh_*` 7 + `board_*` 3) + `handoff-offer` bus kind, hooks (warmup register, saver heartbeat fire-and-forget ≥5s, guard conflict+inbox inject bounded 5/2000, board digest/delta 500/30s, `mesh-hint` opt-in `--mesh-hints`), daemon `GET /mesh/status` accelerator. All writes atomic tmp+rename 0600/0700, torn lines skipped/quarantined, every hook catch→exit 0, every user text through `redact()` before persist, advisory-only (warn, never block).

### Patch Changes

- Updated dependencies [db91dd3]
- Updated dependencies [db91dd3]
  - @megasaver/core@1.7.0
  - @megasaver/mesh@0.2.0
  - @megasaver/stats@1.6.2
  - @megasaver/memory-recall@0.1.1
  - @megasaver/context-gate@0.8.2

## 0.3.1

### Patch Changes

- Updated dependencies [bb15ced]
- Updated dependencies [d0d0b64]
  - @megasaver/core@1.6.0
  - @megasaver/memory-recall@0.1.0

## 0.3.0

### Minor Changes

- 4f2eb16: Session mission control (wave-4 2/3): live presence table + burn + claim warnings. Pure `buildLiveTable`/`deriveStatus`/`shortCwd` in daemon, `mega sessions live` CLI (read-only advisory, fail-open, cwdShort redacted), GUI `GET /api/sessions/live` + `SessionsLivePanel` (poll 5s, status colors, burn sparkline placeholder). TDD 6+4+5 tests, pnpm verify green.

### Patch Changes

- @megasaver/context-gate@0.8.1
- @megasaver/core@1.5.1
- @megasaver/output-filter@1.7.1
- @megasaver/memory-recall@0.0.2
- @megasaver/content-store@1.2.1
- @megasaver/stats@1.6.1

## 0.2.0

### Minor Changes

- 0ad461a: Short-term wave gap closure — cache-churn, session-mesh, mistake-airlock (10 tasks, consolidation supersedes 3 drafts).

  Closes the plan↔code gaps found 2026-08-10 across the three short-term improvement waves — no new invention, only wiring, bug fixes and hardening (TDD + `pnpm verify` green):

  - **`@megasaver/stats` canonical CacheChurn** — replace toy `0.05/0.8` constants with real `invalidatedCount/totalEvents` rate, `bytes/4`→`deltaTokens` pricing via `INPUT_PRICE_PER_MTOK_USD`, threshold table `bypass_compression (>0.5 && avgSavingRatio<0.2)` / `increase_floor (>0.3 && len≥5)` / `keep_enabled`, empty guard, `perTool` breakdown.
  - **`@megasaver/cli` `mega cache-doctor` (free) + `mega audit --cache` alias** — thin adapter over `analyzeCacheChurn` with injectable `readEvents`, `--json` → `CacheChurnResult`, `--store` override; no entitlement gate.
  - **`@megasaver/gui` `GET /api/stats/cache-churn`** — live handler `readEvents→analyzeCacheChurn` alongside the existing static `0.94` cache status.
  - **`@megasaver/daemon` `SessionMeshHub` IPC** — `net.createServer` on `~/.megasaver/mesh.sock` (0600, `withFileLock` race-safe, `chmod 0600` on start, unlink on stop), 200 ms connect timeout → silent disk fallback, Windows `\\.\pipe\megasaver-mesh` branch, heartbeat `Map<agentId,Memo>` + NDJSON broadcast (`memory_added|task_step_completed|gotcha_discovered|handoff_ready`).
  - **`@megasaver/mcp-bridge` `mesh_broadcast`/`mesh_query` + `get_applicable_rules` airlock merge** — Zod strict schemas under `Record<McpToolName>` compile lock; `get_applicable_rules` now returns `{ rules, airlockRules }` via lazy `readRules(storeRoot,sessionId)`.
  - **`@megasaver/core` `airlock-ledger` + `mistake-synthesizer` harden** — `appendRule/readRules/pruneExpired/clearRules` atomic JSONL (`tmp+fsync+rename` + `withFileLock`, `isSafeKeySegment`, TTL 3600 fail-closed, expired filtered on read), `escapeRegExp` + anchored `^tool(?:\s+.*)?--flag(?:\b|$)` pattern (ReDoS-safe).
  - **`@megasaver/policy` TTL + try/catch** — `evaluateCommand` now takes `airlockRules?: readonly AirlockNegativeRule[]` + `now?: number`; expired rules skipped via `Date.parse+ttl*1000<now`, broken regex swallowed with `try/catch`, word-boundary enforced.
  - **`@megasaver/cli` `mega firewall airlock list/clear` + `mega session mesh status/log`** — ledger-backed and mesh-backed thin adapters (`--json` everywhere, `--store`/`--session`/`--tail`).
  - **Bug fixes** — `mcp-bridge/server.ts` missing `storeRoot` wiring for airlock; `cli/firewall.ts` citty parent double-output (upsell over `[]`).

### Patch Changes

- b3c498c: The daemon's POST /expand now records the B3 expansion-debt event (S2-3).
  The route called `fetchOverlayChunk` directly, bypassing the recovery-debt
  append that every other recovery route performs, so daemon-mediated
  expansions were invisible to the net ledger and to the recovery rate R.
  New context-gate export `recordOverlayExpansionDebt` charges the debt to the
  exact (workspaceKey, liveSessionId) named in the request — not a
  locateChunkSet resolution, which could bill another session holding the same
  content-addressed chunk-set id; `fetchChunk`'s overlay branch now delegates
  to the same recorder.
- 07a4e3d: fix(daemon): keep the content-derived chunk-set id on the daemon path

  `makeRecord` stripped `newId` before POSTing to `/excerpt` (a closure is not
  JSON-serializable) and `excerptRequestSchema` had no field to carry it, so
  whenever `mega daemon serve` was up the P1 content-addressed chunk-set id
  degraded to `randomUUID()`. The documented property — byte-identical
  compressions produce identical recovery footers — silently never held under the
  daemon, and identical re-emits accumulated extra chunk-set files.

  `/excerpt` now accepts an optional `chunkSetId` (validated by the existing
  `safeSegmentSchema`, so a traversal value is still a 400) and the hook sends
  `newId()`'s derived value.

  Measured, two byte-identical `excerptHandler` calls in one session:

  - before: ids `d3e099f7-…` / `721d0c22-…`, 2 files under `content/<wk>/<sess>/`
  - after: id `cs-6c72797b6030b4ccdb3cbffd47e5d85a` both times, 1 file

- 07a4e3d: Check that the daemon process recorded in the discovery file is still alive
  before trusting the port it advertises.

  `getRunningDaemon` / `getDaemon` read `<store>/daemon/daemon.json` and pinged
  `GET /status` on the recorded port, treating any `res.ok` as "our daemon".
  `discoverySchema` has carried `pid` since the start but nothing ever read it.
  `clearDiscovery` only runs in `server.close()` and the CLI's SIGINT/SIGTERM
  handler, so SIGKILL/crash/power-loss leaves the record behind — with a port that
  is random and ephemeral (`server.listen(opts.port ?? 0)`), hence quickly
  reusable.

  Whatever local process next bound that port and answered 200 on `/status`
  received the daemon's bearer token and had its JSON returned verbatim as MCP
  tool output: `forwardOrFallback` (`mcp-bridge/src/tools/forward.ts:21`) does
  `mapResponse(await res.json())` with the default identity mapper for
  `proxy_read_file`, `proxy_run_command` and `proxy_search_code`, and the
  PostToolUse saver hook (`apps/cli/src/hooks/saver-run.ts:112`) casts the same
  body straight to `RecordOverlayOutputResult`. Attacker-chosen file contents and
  command output landed in the agent's context as trusted tool results.

  Before: with the daemon SIGKILLed and a squatter listening on the freed port,
  `getRunningDaemon` returned a handle to the squatter and sent it
  `Bearer <stale token>`. After: it returns `null` and the caller falls back
  in-process; `getDaemon` reaps the stale record and spawns a real daemon. The
  squatter receives zero requests.

  Liveness is `process.kill(pid, 0)` inside `ping`, so both entry points and the
  post-spawn wait loop are covered by construction. `EPERM` counts as alive (the
  pid exists, it just isn't ours to signal) so a permission quirk cannot wedge a
  running daemon into a respawn loop. Pid reuse is still theoretically possible;
  closing that needs a unix domain socket, not a wider check here.

  Covered by `test/client.test.ts`, which drives real sockets: a real child
  process is spawned and awaited to exit to obtain a definitively dead pid, and a
  real HTTP impostor binds a real port and records the `authorization` headers it
  is sent.

- 90552a8: Byte-identical stdout+stderr parts no longer collapse into one overlay
  savings event. `RecordOverlayOutputInput` gains an optional
  `streamSlot: "stdout" | "stderr"` that joins the overlay event id hash when
  present; the saver hook names it per dual-stream part and the daemon
  `/excerpt` body schema carries it so the daemon and the in-process fallback
  derive the same id for the same part. An absent slot hashes to the exact
  pre-slot id, so existing callers, recorded history, and old daemons stay
  id-compatible (an old strict-schema daemon rejects the field with a 400,
  which the hook client already treats as a fallback).
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [5e350e3]
- Updated dependencies [07a4e3d]
- Updated dependencies [b3c498c]
- Updated dependencies [1ecbaef]
- Updated dependencies [07a4e3d]
- Updated dependencies [b808902]
- Updated dependencies [07a4e3d]
- Updated dependencies [d270c93]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [88e479a]
- Updated dependencies [89eea64]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [2c76b5b]
- Updated dependencies [b00c54f]
- Updated dependencies [07a4e3d]
- Updated dependencies [d26c4ec]
- Updated dependencies [65575db]
- Updated dependencies [07a4e3d]
- Updated dependencies [1ecbaef]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [4ddac04]
- Updated dependencies [07a4e3d]
- Updated dependencies [9d46944]
- Updated dependencies [83202e0]
- Updated dependencies [07a4e3d]
- Updated dependencies [af5dc1e]
- Updated dependencies [0ad461a]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [90552a8]
- Updated dependencies [07a4e3d]
- Updated dependencies [d1093c3]
- Updated dependencies [6ea5968]
- Updated dependencies [9d46944]
- Updated dependencies [c100918]
- Updated dependencies [608eeba]
  - @megasaver/core@1.5.0
  - @megasaver/stats@1.6.0
  - @megasaver/output-filter@1.7.0
  - @megasaver/context-gate@0.8.0
  - @megasaver/content-store@1.2.0
  - @megasaver/shared@1.3.1
  - @megasaver/memory-recall@0.0.1
  - @megasaver/retrieval@1.0.4

## 0.1.4

### Patch Changes

- Updated dependencies [4403f40]
- Updated dependencies [eb74c35]
- Updated dependencies [5f8bbdb]
- Updated dependencies [6d40d2c]
- Updated dependencies [8db0074]
- Updated dependencies [2459179]
- Updated dependencies [6312ef3]
  - @megasaver/core@1.4.0
  - @megasaver/output-filter@1.6.0
  - @megasaver/stats@1.5.0
  - @megasaver/context-gate@0.7.0
  - @megasaver/content-store@1.1.4

## 0.1.3

### Patch Changes

- 815445a: Saver eligibility + ranking wave 3: the hook's byte gate is now the single
  compression-eligibility authority (no more 4–8 KB dead band), safe mode
  compresses Bash below Claude Code's output ceiling, file reads get semantic
  AST chunking, compressed views render in source order with `… [lines A-B
omitted]` markers, intent is per-session with a 30-minute TTL, the intent
  tokenizer understands non-ASCII prompts, and a committed
  `.megasaver/policy.json` can floor the mode a repo may be compressed with.
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
- Updated dependencies [64a5300]
- Updated dependencies [ce66902]
- Updated dependencies [815445a]
- Updated dependencies [b91c052]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/core@1.3.0
  - @megasaver/context-gate@0.6.0
  - @megasaver/output-filter@1.5.0
  - @megasaver/stats@1.4.0
  - @megasaver/shared@1.3.0
  - @megasaver/content-store@1.1.3
  - @megasaver/retrieval@1.0.3

## 0.1.2

### Patch Changes

- Updated dependencies [20977aa]
- Updated dependencies [14b2c6c]
- Updated dependencies [223fa0a]
  - @megasaver/output-filter@1.4.0
  - @megasaver/context-gate@0.5.0
  - @megasaver/stats@1.3.0
  - @megasaver/content-store@1.1.2
  - @megasaver/core@1.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [69ce82f]
- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
- Updated dependencies [b5c6c0d]
  - @megasaver/stats@1.2.0
  - @megasaver/core@1.2.0
  - @megasaver/shared@1.2.0
  - @megasaver/context-gate@0.4.0
  - @megasaver/output-filter@1.3.0
  - @megasaver/content-store@1.1.1
  - @megasaver/retrieval@1.0.2

## 0.1.0

### Minor Changes

- 5250357: Add `getRunningDaemon` — a no-spawn client that returns a `DaemonHandle` if a daemon is already
  running at the discovery path, or `null` otherwise. Never spawns, never waits, never mutates
  lock/discovery. Used by the `mega hooks saver` PostToolUse hook to forward captured tool output
  to the daemon's `/excerpt` route with a 1.5s timeout, falling back to in-process
  `recordAndFilterOverlayOutput` on any failure (daemon absent, connection error, or non-2xx).
- da6e687: Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
  and fills it as the ranking intent for PostToolUse-captured native output when no
  explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.
- abfaf3b: Add bi-temporal valid-time to memories (M1). `MemoryEntry` (and the
  overlay variant) gain optional, backward-compatible `validFrom` /
  `validTo` (valid time, alongside the existing `createdAt` / `updatedAt`
  transaction time) and `supersedesId`. New `isCurrent(memory, asOf)` and
  `isRecallable(memory, asOf)` helpers: `isRecallable` is the single shared
  recall predicate (approved AND currently valid) that every recall surface
  routes through — BM25 + semantic search, the MCP `recall` tool, the
  daemon recall handler, and the GUI connector-context builder — so the
  bi-temporal filter cannot drift between surfaces. `searchMemoryEntries`
  and `searchMemoryEntriesSemantic` filter to currently-valid memories and
  accept an optional `asOf` for time-travel ("what did we believe as of
  T"); the MCP `recall` / `get_relevant_memories` tools and the daemon
  recall route thread `asOf`. `save_memory` accepts `supersedesId`.
  Approving a memory that supersedes an older one closes the old memory's
  `validTo` (it drops out of default recall but is kept for time-travel —
  lossless); the supersede target is validated (same project + scope,
  not self, must exist) so an agent-controlled `supersedesId` cannot close
  a memory it should not touch or vanish itself. The CLI/GUI memory graphs
  emit a `supersede` edge from the recorded `supersedesId`. Rows without
  temporal fields are treated as current, so existing stores load
  unchanged.
- a2b5643: Add tiered memory + confidence decay to memories (M2, Letta/MemGPT-class
  working/recall/archival). Deterministic, no LLM, no background timer;
  additive and backward-compatible.

  `MemoryEntry` (and the overlay variant + update patch) gain an optional
  `tier` (`working` | `recall` | `archival`); an absent tier reads as
  `recall`, so existing stores load unchanged. The centralized recall
  predicate `isRecallable` is now tier-aware — it excludes `archival` by
  default and includes it only with `{ includeArchival: true }` — so all
  recall surfaces (BM25 + semantic search, the MCP `recall` /
  `get_relevant_memories` tools, the daemon recall handler, and the GUI
  connector-context builder) inherit tier filtering with no per-surface
  re-implementation. `searchMemoryEntries` / `searchMemoryEntriesSemantic`
  accept `includeArchival` and filter `archival` by default.

  New `effectiveConfidence(memory, now)` pure helper (exported) weights a
  memory's base confidence by age (30-day half-life) and tier (small
  working boost); it is read-time only and never mutates stored
  confidence. `searchMemoryEntries` multiplies BM25 scores by it so an
  aged/low-confidence memory ranks below a recent/high one — strictly a
  down-rank, never a drop. New `mega memory sweep <project>` CLI command
  and `mega_memory_sweep` MCP tool apply the one deterministic, lossless
  mutation: an approved, currently-valid memory that is closed/superseded,
  stale, or low-confidence-and-inactive is demoted to `tier = "archival"`
  (reversible, never deleted). Both report `archived=N scanned=M` (with
  `--json`) and are idempotent.

- b1978fa: feat: outline-first read mode

  `mega_read_file` accepts `outline: true`: for a supported source file it
  returns the file skeleton (imports + top-level signatures + line ranges +
  chunk ids) and persists every body as a fetchable chunk, so an agent expands
  only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
  falls back to a normal read for non-source / unsupported / unparseable files.

### Patch Changes

- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [7fcd881]
- Updated dependencies [66ac31e]
- Updated dependencies [62b3c65]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [0a3256b]
- Updated dependencies [7c916db]
- Updated dependencies [da9d3a7]
- Updated dependencies [42207dd]
- Updated dependencies [da6e687]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [031f6de]
- Updated dependencies [391e659]
- Updated dependencies [31238a3]
- Updated dependencies [4e8c6e8]
- Updated dependencies [abfaf3b]
- Updated dependencies [a2b5643]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [97ccb98]
- Updated dependencies [aa42dbd]
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
- Updated dependencies [8b735fb]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [3e678e3]
- Updated dependencies [f46ce66]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [4fe5749]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0
  - @megasaver/context-gate@0.3.0
  - @megasaver/content-store@1.1.0
  - @megasaver/stats@1.1.0
  - @megasaver/core@1.1.0
  - @megasaver/retrieval@1.0.1
