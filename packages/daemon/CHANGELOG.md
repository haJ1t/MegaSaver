# @megasaver/daemon

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
