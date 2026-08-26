# @megasaver/context-gate

## 0.9.1

### Patch Changes

- Updated dependencies [297f9ac]
  - @megasaver/shared@1.3.2
  - @megasaver/content-store@1.2.3
  - @megasaver/evidence-ledger@0.2.4
  - @megasaver/output-filter@1.8.1
  - @megasaver/policy@2.1.1
  - @megasaver/stats@1.7.1

## 0.9.0

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
- e24685e: Generated-file fence: derive, evaluate, and compile committed `fence.yaml` rules to protect generated files, lockfiles, build outputs, and vendored code across Claude Code, flat-file agent connectors, and standalone CLI checks.
- a545d81: Package-Hallucination Firewall: a warn-only PreToolUse layer on agent
  edits extracts npm/PyPI package references from new text and verifies
  them offline in three tiers (project-local → committed seed ∪ local
  cache → unknown); unknown names get an additionalContext warning with a
  typosquat hint and firewall-ledger events (unknown-package /
  typosquat-suspect, grammar-bounded). `mega firewall status/refresh/allow`
  manage the cache and allowlist — refresh is the only network touchpoint
  and no hook path performs network I/O. Never blocks an edit; with no
  package refs the guard hook output is byte-identical to before.

### Patch Changes

- Updated dependencies [962f42a]
- Updated dependencies [fe8fbf8]
- Updated dependencies [929c8b4]
- Updated dependencies [e565cc3]
- Updated dependencies [a5c107c]
- Updated dependencies [9f87069]
- Updated dependencies [00ab087]
- Updated dependencies [8c1454c]
  - @megasaver/stats@1.7.0
  - @megasaver/content-store@1.2.2
  - @megasaver/output-filter@1.8.0

## 0.8.2

### Patch Changes

- Updated dependencies [db91dd3]
  - @megasaver/stats@1.6.2

## 0.8.1

### Patch Changes

- Updated dependencies [a3ee0af]
  - @megasaver/policy@2.1.0
  - @megasaver/output-filter@1.7.1
  - @megasaver/content-store@1.2.1
  - @megasaver/stats@1.6.1

## 0.8.0

### Minor Changes

- b3c498c: The daemon's POST /expand now records the B3 expansion-debt event (S2-3).
  The route called `fetchOverlayChunk` directly, bypassing the recovery-debt
  append that every other recovery route performs, so daemon-mediated
  expansions were invisible to the net ledger and to the recovery rate R.
  New context-gate export `recordOverlayExpansionDebt` charges the debt to the
  exact (workspaceKey, liveSessionId) named in the request — not a
  locateChunkSet resolution, which could bill another session holding the same
  content-addressed chunk-set id; `fetchChunk`'s overlay branch now delegates
  to the same recorder.
- 2c76b5b: Stage A of Net-Positive MegaSaver — two independent mechanisms.

  A per-workspace net-effect advisory: `mega doctor` weighs 7-day saved tokens
  against the cache_creation spread in the local proxy's usage ledger, persists a
  verdict, and `mega session saver resolve` echoes it as `netEffectVerdict`.
  Nothing acts on the verdict. The spread is a dispersion statistic that the usage
  ledger carries no workspace key to attribute, so it never gates the saver. It
  also requires the opt-in `mega proxy` (at least 20 continuation rows in the
  window); without that ledger every verdict stays `unknown` and doctor only
  reports that it cannot judge, so a default install is unaffected.

  The saver becomes first-sight-only: an output already compressed in a session is
  passed through untouched, and chunk-set ids derive from content hashes so footers
  stay stable across re-runs. This ships as a mechanism change with no demonstrated
  cost benefit — the Stage A benchmark gate measured 0.948x geomean (min task
  0.68x) against a required >=1.0x, and the replay harness that could resolve an
  effect this small has not been run. It does not stop a turn's first compression
  from invalidating the prompt cache.

- 9d46944: Saved tokens are measured at the write site and priced from a dated list-price
  table (child-spec #3). `recordAndFilterOverlayOutput` counts the raw and
  returned text as it records, writing `rawTokens`, `returnedTokens` and
  `deltaTokens` onto the overlay event; `RecordOverlayOutputInput` accepts an
  optional `countTokensImpl` seam. On timeout the three fields are **omitted
  rather than zeroed**: a value in a field named `rawTokens` is measured or
  absent, never inferred. `TOKEN_COUNT_BUDGET_MS` (500 ms) bounds only the lazy
  `js-tiktoken` load, which is the async part — it was sized above a measured
  cold start of 101–132 ms. It does **not** bound `encode` itself, which is
  synchronous and holds the event loop, so the race cannot interrupt it:
  measured post-guard, 400 KB of repeated characters returns a value after
  14,388 ms without the budget firing. Pathological input remains unbounded on
  this path. The stats event schema gains optional `modelId` and `isFreshStore`.

  `@megasaver/stats` exports the reading and pricing surface: `deltaTokensOf` and
  `measuredTokenCoverage`, with `observationsFromEvents` preferring a measured
  raw/returned pair over the bytes/4 fallback per row; `modelPriceTableSchema`,
  `ModelPriceTable`, `loadModelPriceTable`, `inputPricePerMTok`, `ResolvedPrice`,
  `PriceTableError`, `PriceTableErrorCode` and `MODEL_LIST_PRICES`;
  `estimateSavedValue` with `ValuedRow` and `SavedValueEstimate` (which carries
  `fallbackModelId` and `fallbackInputPerMTokUsd`); and `resolveModelId` with
  `ModelResolutionInput` and `ProxyModelRow`, built but wired to nothing —
  `estimateSavedValue` shares are computed on magnitude, so a window that is half
  unknown cannot report 0% unknown by netting out. `MODEL_LIST_PRICES` duplicates
  `scripts/model-list-prices.json` because the CLI bundle cannot read `scripts/`;
  a test pins the two together, and a second test pins the older
  `INPUT_PRICE_PER_MTOK_USD` to the table's fallback rate so the two dollar paths
  cannot drift apart silently.

  `mega audit honest` reports its token source (measured vs bytes/4 estimate) and,
  below the token lines, the net measured tokens with an estimated dollar figure.
  Two limits are printed, not buried: the figure is a **floor, not a cap** — a
  saved token is never written into the prefix, so what is avoided is one cache
  write plus a cache read on every later turn that would have carried it,
  `p·(2.0 + 0.1N)` against the `p·1.0` reported — and the unknown-model share is
  100% by construction, since nothing writes `modelId` today, so the line names
  the fallback model and its rate inline rather than leaving the reader to guess
  what price produced the number.

- 83202e0: Token measurement on the saver hot path has a real bound. The 500 ms race in
  `record-output` could never fire: `encode` is synchronous after memoization, so
  the timer callback waited on the work it was meant to interrupt. Measured on
  the shipped code, all with the budget silent — 8,000 characters of Japanese
  prose took 24,267 ms, 32 KB of newlines 46,218 ms, and `"a"` followed by 50,000
  spaces 114,331 ms. The PostToolUse saver runs on every tool call, so a padded
  file or a cleared progress area hung the agent for tens of seconds per counter,
  twice per event, after which the hook emitted nothing and the output passed
  through uncompressed. All four now decline in ≤1 ms.

  `countTokens` returns `number | null`; `null` means declined, never zero and
  never an estimate. It reads the encoder's own split pattern from
  `encoding.patStr` rather than restating it, and declines when
  `SUM over matches of (MATCH_OVERHEAD_BYTES + bytes) * bytes` exceeds
  `MAX_WORK_UNITS`. The sum is per match rather than a global maximum times a
  global total: the latter lets one outlier poison the document around it, and
  50 KB of clean log with a single 800-byte base64 line scored 22.7x the budget
  under that form though it encodes in 31.8 ms. Both terms are load-bearing —
  without the per-match floor, high-match-count input is admitted far past
  budget; without counting whitespace matches, 32 KB of newlines scores zero
  work, because cl100k matches a whitespace run as one match. Nothing is chunked,
  so a returned count is the encoder's own output — exact, not approximate. The
  new `tokenWorkUnits` export makes the decline decision assertable directly
  instead of through a stopwatch. `longestRun`, `MAX_SAFE_RUN` and `CHUNK_SIZE`
  are gone.

  Overlay events gain an optional `tokenCountOutcome` of `"declined"`,
  `"load-timeout"` or `"failed"`. Absence still means the count succeeded.
  Without it all three were byte-identical downstream, so a tokenizer that
  started throwing would have read as nothing more than a workload of large
  outputs — and a load timeout, which is environmental, would have been filed as
  a tokenizer bug.

  `MAX_WORK_UNITS` is derived against a **loaded** machine, not an idle one: the
  1500 ms per-tool-call ceiling divided by 4.3x measured contention, minus the
  lazy `getEncoding` load and the guard's own scans, which sit inside the awaited
  path and had previously gone uncounted. The work bound is exact and
  deterministic; the wall-clock bound follows from it only up to ~4x contention,
  and past that the fixed costs alone exceed the ceiling, so no work budget could
  hold it. That limit is stated rather than implied.

  Coverage on ordinary content: 186 KB of minified JSON, 141 KB of logs, 134 KB
  of prose, 121 KB of TypeScript, 63 KB of wrapped base64, 30 KB of punctuated
  Japanese, 240 KB of one-byte-match input — while a payload that is mostly long
  rules is admitted only to about 1 KB. Mixed content is measured on its own
  merits: a 50 KB log containing one 800-byte line is counted, not refused for
  it. A declined row omits all three token fields; `mega audit honest` already
  reports the resulting coverage, though `honest-metrics` then substitutes a
  bytes/4 estimate that is +19.3% wrong on JSON, so declines are visible but not
  free.

  `TOKEN_COUNT_BUDGET_MS` is renamed `ENCODING_LOAD_BUDGET_MS`, keeping its
  500 ms value and now bounding only the lazy encoding load, which really is
  async. `@megasaver/bench-replay`'s `TokenCounters.count` widens accordingly and
  `TokenDivergenceReport` gains `excludedCorpora`, so a declined corpus is named
  rather than silently dropped from the divergence figure.

  Note for anyone comparing across the upgrade: rows written before this change
  with a long unbroken run were chunked and biased slightly upward, while the
  same shapes are now exact-or-absent, so an aggregation window straddling the
  deploy mixes two measurement regimes.

### Patch Changes

- d270c93: Scope chunk-set deletion and retention holds by `(workspaceKey, session, chunkSetId)`.

  The saver derives chunk-set ids from the output's sha256 with no session or
  workspace salt, so two sessions that produce byte-identical output write the
  same filename in different directories. The evidence sweep still resolved "which
  file to delete" with `locateChunkSet`, a store-wide first-match scan — so the
  daily, unattended GC could delete a live session's (or another repo's) raw
  output while the expired record's own copy survived, leaving the ledger claiming
  `available` over a file that was gone. The retention pin walker had the mirror
  defect: holds keyed by the bare id let one workspace's pin retain another
  workspace's expired chunk forever.

  `ChunkDeletePort` now takes a `ChunkRef { workspaceKey, sessionRef, chunkSetId }`
  (the evidence record already carried all three), and `sweepEvidenceStore` deletes
  only at that path — an unscopable ref is skipped rather than searched for.
  `pruneOlderThan` takes `keepChunkSetKeys` built from the new exported
  `chunkSetKey`, matched against the same triple; an unscopable hold falls back to
  the bare id and over-retains. `locateChunkSet` keeps serving reads only —
  colliding sets are byte-identical, so any match answers a read.

  The triple addresses the FILE, not its owner: several records in one session can
  point at one chunk file, so `gcEvidence` also skips the unlink when any record
  that survives the pass (pinned, manual_hold, or unexpired) still points at that
  address. It already lists every record in the workspace, so the check is a set
  lookup. The expiring record is still degraded to `retained_metadata_only`.

  Breaking (pre-1.0, no shim): `ChunkDeletePort` takes a ref, not a string;
  `pruneOlderThan`'s `keepChunkSetIds` is now `keepChunkSetKeys`.

- 07a4e3d: Collect the evidence records that were already on disk. The previous fix
  stamped `expiresAt` on new writes only, so every record the saver had written
  before it — one per compressed tool output, each carrying a
  `returnedChunkRefs` entry per 40-line chunk of the full raw output — kept
  `expiresAt: null`, which `gcEvidence` reads as "never expires" and skips.
  `maybeRunOverlayGc` therefore swept those stores daily and degraded nothing:
  the records stayed `available` with refs dangling into chunk sets the
  content-store prune had already deleted, and the GUI memory-graph route kept
  `JSON.parse`ing and zod-parsing all of them on every request — the exact bloat
  the previous changeset claimed to fix, untouched on every pre-existing store.

  `gcEvidence` now takes an optional `fallbackExpiryMs`: when a record has no
  `expiresAt`, it expires at `createdAt + fallbackExpiryMs`. `sweepEvidenceStore`
  passes `EVIDENCE_RETENTION_MS`, so legacy rows age out on the same 30-day clock
  as the ones written after the fix. The window is a caller-supplied policy, not
  a ledger default — the ledger owns no retention policy (the same reason
  redaction is a port) and a direct caller that passes nothing still sees the
  documented "null means no expiry". Retention exemptions are unchanged: `pinned`
  and `manual_hold` are skipped before expiry is considered, and a legacy record
  still inside the 30-day window keeps its chunk set.

- 07a4e3d: Make evidence-ledger GC actually collect. `gcEvidence` was dead code in two
  independent ways: nothing outside the package ever called it, and every record
  the saver writes was stamped `expiresAt: null`, which its own loop skips. One
  evidence record per compressed tool output therefore accumulated forever, each
  one carrying a `returnedChunkRefs` entry per 40-line chunk of the _full_ raw
  output, pretty-printed. Meanwhile the chunk set those refs point at is deleted
  by the content-store prune after 30 days, so the store filled with permanently
  dangling evidence — and `/api/claude-sessions/:dir/:id/memory/graph` re-reads,
  `JSON.parse`es and zod-parses every one of them on each request.

  Measured on a 348,889-byte command output (1,000 chunks, `mode: "aggressive"`):
  the evidence record is **96,932 bytes** — 28% of the raw output it describes —
  and before this change it stayed 96,932 bytes forever. After the retention
  window it is now degraded to **1,120 bytes**, an 86x drop, and its chunk set is
  deleted.

  Three parts, all at the single site each concern routes through:

  - `@megasaver/context-gate` — the only production writer of evidence
    (`recordAndFilterOverlayOutput`) now stamps `expiresAt` at
    `createdAt + EVIDENCE_RETENTION_MS` (30 days), the same clock the content
    store prunes overlay chunk sets on, so a record cannot outlive the chunks it
    references.
  - `@megasaver/context-gate` — new `sweepEvidenceStore`, a store-wide wrapper
    over the per-workspace `gcEvidence` that resolves each record's chunk set via
    `locateChunkSet` and deletes it through `deleteOverlayChunkSet`. It lives
    here, not in the CLI, because the CLI must not depend on
    `@megasaver/evidence-ledger` directly.
  - `@megasaver/cli` — the existing daily throttled `maybeRunOverlayGc` hook now
    calls `sweepEvidenceStore` alongside the chunk/intent/seen sweeps.
    Best-effort: a failure never fails the GC pass.
  - `@megasaver/evidence-ledger` — degrading a record to
    `retained_metadata_only` now also clears `returnedChunkRefs`. Every ref
    pointed into the chunk set just deleted, and on a large output they are
    ~99% of the record's bytes — they account for the whole 96,932 → 1,120
    collapse above.

  Retention exemptions are unchanged: `pinned` and `manual_hold` records still
  survive ordinary GC.

- 65575db: Overlay savings events are idempotent under the daemon-timeout replay (B11 /
  HOOK-3). `recordAndFilterOverlayOutput` derives the overlay event id from the
  compression's stable inputs (workspace, session, source, mode, label, raw
  content) plus a 10-minute creation bucket, so the daemon write and the hook's
  in-process timeout fallback produce the SAME id for the same tool output.
  `appendOverlayEvent` performs the id-existence check AND the append under the
  same file lock as the summary fold (the two writers are concurrent by
  construction — an unlocked check-then-append could interleave), treats a
  replay as a no-op (never an error), and now returns the summary extended with
  `appended: boolean` so callers gate first-sight side effects (the evidence
  row) without a second ledger scan. New export `hasOverlayEvent(store,
workspaceKey, liveSessionId, eventId)` remains for read-side consumers.
  Residuals, named: bucket skew (writers stamping different 10-minute buckets;
  P ≈ min(1, skew/600 s), modeled, not measured) and a lock-contended append
  (50 ms deadline) degrading to the unlocked check-then-append so no event is
  lost. A byte-identical re-delivery in a later bucket (first-sight ledger
  failing open) still counts.
- 07a4e3d: Stop the retention prune from deleting raw chunks that pinned or `manual_hold`
  evidence still points at.

  `pruneOlderThan` deleted every chunk set older than the window purely by
  `createdAt`, while the evidence ledger exempts pinned/`manual_hold` records from
  GC. On day 31 the hook GC (and `mega output gc`) deleted the chunk and left the
  record `available` with `rawExpandable: true` — the one evidence class a user
  explicitly protected became a dead pointer, and any expand on it failed.

  `pruneOlderThan` now accepts `keepChunkSetIds`, and the new
  `pruneChunkSetsHonoringPins` (context-gate, the package that already composes
  content-store + evidence-ledger) joins the two stores and supplies the exempt
  ids. Both CLI prune call sites use it. A corrupt ledger aborts the prune instead
  of pruning blind.

- 07a4e3d: Fix a lost-update race in `recordSeenOutput` (`saver-seen.ts`), the P1 first-sight
  ledger that decides whether the PostToolUse saver may rewrite a tool result.

  `mega hooks install` registers `mega hooks saver` as Claude Code's PostToolUse
  hook, so every tool result in a turn runs in its **own process** — and every tool
  result of one turn carries the same `session_id`, hence the same
  `stats/<workspaceKey>/saver-seen/<sessionId>.json`. The read-modify-write
  (`readHashes` → push → `writeFileSync(tmp)` → `renameSync`) was unlocked, so
  parallel tool calls clobbered each other: the last rename won and the other
  hashes were gone for good.

  Measured through the exported function with real OS processes (4 writers, 24
  barrier-synchronised rounds, one hash per writer per round — the production shape
  of one hash per hook process): of the hashes a writer had already _observed_ land
  in the ledger, 22–39 of ~96 were missing at the end of the run, on 5 of 5 runs.
  After the fix, 0 missing on 10 of 10 runs.

  The consequence is fail-open by design, so no tool call ever breaks and the store
  cannot corrupt (the chunk-set id is content-derived, so a repeat compression
  reuses the same id). What it costs is the guarantee the file exists for: a dropped
  hash makes `hasSeenOutput` return false, the saver rewrites that `tool_result`
  again, and the prompt-cache churn measured in `wiki/syntheses/saver-cache-churn.md`
  (0.96x balanced / 0.93x aggressive) happens anyway — the exact regression the
  first-sight guard was shipped to prevent.

  Fixed with the lock this repo already applies to the identical shape one call
  earlier in the same hook: `withFileLock(`${path}.lock`, { deadlineMs: 50, staleMs:
5000 })`, the same constants as `appendOverlayEvent` (`stats/store.ts`, E26) and
  `saver-heartbeat.ts` (E25), keyed on the same (workspaceKey, sessionId) scope.
  `hasSeenOutput` stays unlocked — it is a single read of an atomically renamed
  file, so it cannot tear.

  `withFileLock` remains best-effort: a writer contended past 50 ms skips its write
  rather than stalling the agent. That is the pre-existing fail-open (one redundant
  compression), not a lost update, so the guard test asserts the lost-update
  property directly — every record a writer saw land must still be there — instead
  of a survivor count that machine load could move.

- af5dc1e: Fix a superquadratic ReDoS in `FILE_PATH` (`session-hints.ts`), the pattern
  `extractFailureSignatures` uses to distil stored failure blobs into ranking
  hints.

  `/[\w./\\-]*\w+\.[a-zA-Z]{1,5}(?::\d+)?/g` placed two unbounded quantified runs
  over overlapping classes back to back — `\w` is a subset of `[\w./\\-]`, so the
  split between them was ambiguous at every offset _and_ every start position
  rescanned to end-of-input to fail the `\.`. Measured through
  `extractFailureSignatures`: 1.2 s at 2 KB, 9.1 s at 4 KB, 80.5 s at 8 KB
  (~7x per doubling).

  4 KB was the shipped worst case, not a crafted one: both capture sites store
  `redact(...).redacted.slice(0, 4000)` (`run-command.ts:305`, `:574`). The cost
  was also persisted and amplified — up to `MAX_OVERLAY_FAILURES` (50) stored
  records are re-extracted by `buildSessionHints` / `buildOverlayHints` on every
  read and exec, including inside the Claude Code `guard-run` hook, so one session
  that captured a hex dump or a long identifier run added minutes of CPU to every
  subsequent tool call, permanently.

  Fixed by collapsing the second run to the single `\w` it actually required:
  `/[\w./\\-]{0,255}\w\.[a-zA-Z]{1,5}(?::\d+)?/g` — 2.3 ms at 4 KB. Semantics are
  preserved exactly (the character before the dot must still be a word char,
  everything before it still comes from the wider class); verified identical on 22
  real diagnostic lines — tsc caret and parenthesised, rustc, go, vitest, and
  node/java/python frames, Windows `\` paths, deep monorepo paths — plus 200k
  randomised strings over the triggering alphabet.

  The one deliberate divergence is the 256-char cap on the leading run, matching
  the already-merged twin in `@megasaver/output-filter`: a path whose head exceeds
  256 chars now yields a clipped signature. A clipped path is still a substring of
  the output it should boost, and real paths are far shorter.

  The obvious alternative collapse `[\w./\\-]{1,256}\.` is equally fast but was
  rejected: it drops the `\w`-before-dot requirement and starts matching `-.ts`,
  `..ts` and `a/.js`.

  Guarded by `test/session-hints-redos.test.ts`, which drives the exported
  function (never the bare regex) at the shipped 4000-char cap and asserts a
  growth ratio rather than a wall-clock ceiling.

- 90552a8: Byte-identical stdout+stderr parts no longer collapse into one overlay
  savings event. `RecordOverlayOutputInput` gains an optional
  `streamSlot: "stdout" | "stderr"` that joins the overlay event id hash when
  present; the saver hook names it per dual-stream part and the daemon
  `/excerpt` body schema carries it so the daemon and the in-process fallback
  derive the same id for the same part. An absent slot hashes to the exact
  pre-slot id, so existing callers, recorded history, and old daemons stay
  id-compatible (an old strict-schema daemon rejects the field with a 400,
  which the hook client already treats as a fallback).
- 07a4e3d: fix: apply the secret-path denylist to the symlink-resolved read target

  The two-gate read matched `SECRET_PATH_PATTERNS` against the caller's literal
  path (`normalizePath` is a pure string op — no filesystem access) but read
  through `fs.readFile`, which follows symlinks. Gate 2 (`resolveSafeReadPath`)
  computed a realpath only to test sandbox _containment_ against
  `[projectRoot, cwd, homedir()]` and then returned the un-resolved lexical path,
  so the denylist was never applied to the file actually opened.

  Before: with `ln -s ~/.aws cfg` checked into a repo, `proxy_read_file({path:
"cfg/credentials"})` returned `{ok: true}` and the credential file's contents;
  `ln -s ~/.ssh keys` + `keys/config` returned the whole ssh config in cleartext
  with 0 redactions. No `blocked-read` firewall event was recorded, because the
  deny branch never fired. Control reads of the same bytes via
  `<home>/.aws/credentials` correctly returned `path_denied` /
  `secret_path_read`.

  After: all three shapes (directory symlink, plain file symlink, direct path)
  return `{ok: false, code: "path_denied", reason: "secret_path_read"}` on both
  `runTwoGates` and `runOverlayTwoGates`, so the firewall ledger records them.
  Ordinary in-sandbox reads are unaffected.

  `resolveSafeReadPath` now returns the realpath it already computed as
  `real` alongside `absolute` (additive field on the exported `ResolvedPath`).

- d1093c3: remove the net-effect auto-pause; the verdict is advisory only

  The estimator's `Σ max(0, cache_creation − median)` is a dispersion statistic,
  not a cost or causation measurement: it is positive for any spread distribution
  whether or not the saver caused a token, and the usage ledger carries no
  workspace key to attribute it with. Holding total cache_creation constant and
  changing only its spread flips the verdict, so ordinary traffic shape (prompt
  cache TTL expiry, compaction) could silently switch the saver off.

  - `@megasaver/stats`: `NetEffectVerdict.churnTokens` → `excessTokens`.
  - `@megasaver/context-gate`: `saverPausedByNetEffect` and `writeResumeOverride`
    removed; `NetEffectRecord.churnTokens` → `excessTokens` and the
    `resumeOverrideAt` field is dropped (existing records read as absent).
  - `@megasaver/cli`: the saver hook no longer takes a pause dependency,
    `mega session saver resume` is removed, and `mega doctor` reports a negative
    verdict as an explicitly unattributed warning instead of failing.

- c100918: An unchanged re-read now reaches the ledger (spec §7 item 3, S2-2/S4-5).
  Both read pipelines used to return the unchanged-marker before any event
  append, so the suppression's saving AND its real envelope cost were invisible,
  while the struct self-reported fabricated `returnedBytes: 0 / savingRatio: 1`.
  The unchanged branch appends a compression-kind event with
  `returnedBytes = mcpEnvelopeBytes(result)`, clamped `bytesSaved`/`savingRatio`
  against the raw, a signed `deltaBytes`, and the prior chunk-set id — the same
  envelope-true accounting as a normal read. The delivered marker struct itself
  is unchanged.
- Updated dependencies [07a4e3d]
- Updated dependencies [5e350e3]
- Updated dependencies [193e757]
- Updated dependencies [07a4e3d]
- Updated dependencies [1ecbaef]
- Updated dependencies [07a4e3d]
- Updated dependencies [b808902]
- Updated dependencies [07a4e3d]
- Updated dependencies [ab4d04c]
- Updated dependencies [d270c93]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [20bf90d]
- Updated dependencies [89eea64]
- Updated dependencies [25b23b8]
- Updated dependencies [07a4e3d]
- Updated dependencies [2c76b5b]
- Updated dependencies [b00c54f]
- Updated dependencies [07a4e3d]
- Updated dependencies [d26c4ec]
- Updated dependencies [65575db]
- Updated dependencies [07a4e3d]
- Updated dependencies [d270c93]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [4ddac04]
- Updated dependencies [07a4e3d]
- Updated dependencies [ddd86a7]
- Updated dependencies [9d46944]
- Updated dependencies [83202e0]
- Updated dependencies [0ad461a]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [d1093c3]
- Updated dependencies [6ea5968]
- Updated dependencies [9d46944]
- Updated dependencies [608eeba]
  - @megasaver/stats@1.6.0
  - @megasaver/policy@2.0.0
  - @megasaver/output-filter@1.7.0
  - @megasaver/evidence-ledger@0.2.3
  - @megasaver/content-store@1.2.0
  - @megasaver/shared@1.3.1

## 0.7.0

### Minor Changes

- 8db0074: Mistake Firewall (guard): PreToolUse hook intercepts Bash/edit calls matching stored failures and warns the agent mid-mistake with the estimated original cost. Durable bounded guard corpus captured on the proxy path; three-tier pure matcher (exact / path+text / BM25); outcome feedback loop with signature overlap + auto-mute; `mega guard` CLI (status/mode/events/mute/check); `check_approach` MCP tool with a free 7-day window (also applied to `find_similar_failures`); Pro retry-cost-avoided line in roi/savings surfaces. Free warn interception + Pro strict-deny / events ledger / cumulative analytics, all under the existing `savings-analytics` entitlement key.

### Patch Changes

- Updated dependencies [eb74c35]
- Updated dependencies [8db0074]
- Updated dependencies [6312ef3]
  - @megasaver/output-filter@1.6.0
  - @megasaver/stats@1.5.0
  - @megasaver/content-store@1.1.4

## 0.6.0

### Minor Changes

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
- 3905c30: Saver recovery wave 2: hook-compressed output is now stored as uniform
  40-line chunks — the recovery footer advertises `N chunks` with fetch-by-id
  (`i = 0..N-1`) so an agent expands only the slice it needs instead of
  re-paying for the whole raw. The content
  store self-cleans: `pruneOlderThan` now recognizes overlay chunk sets (they
  previously leaked forever), removes emptied directories, runs best-effort
  from the saver hook at most once a day (30-day retention), and is available
  manually as `mega output gc [--days N]`.

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
- Updated dependencies [815445a]
- Updated dependencies [b91c052]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/output-filter@1.5.0
  - @megasaver/stats@1.4.0
  - @megasaver/shared@1.3.0
  - @megasaver/content-store@1.1.3
  - @megasaver/evidence-ledger@0.2.2
  - @megasaver/policy@1.2.2

## 0.5.0

### Minor Changes

- 20977aa: Decision-Trace Viewer: surface the causal chain behind each context decision.

  Registry/proxy outputs now record their ranking decision inline on the replay
  trace — the classification, the selected/omitted chunks with their EngineScore
  breakdown, the memory ids that boosted the ranking (`rankedByMemoryIds`), and the
  redaction summary. Replay tracing is now **on by default** (disable with
  `MEGASAVER_SEAM_TRACE=false`), bounded by a retention cap on trace-session dirs.

  - New `readSessionDecisionTrace` reader joins the trace's inline attribution into
    a per-output `SessionDecisionTrace` (output granularity).
  - New CLI: `mega trace explain <sessionId> --project <name> [--workspace <key>]
[--json]` renders the causal chain for a registry session.
  - New GUI: a Cytoscape decision-flow panel with a project-scoped session picker
    (traces come from proxy/registry sessions for the workspace).

  Note: the memory attribution is _ranking-causal_ (which memory boosted the
  output's ranking), distinct from the evidence ledger's retention `pinnedByMemoryIds`.
  `highRiskFindings` is the seam's redaction count. Traces exist only for
  registry/proxy sessions; pure cockpit/overlay sessions show an honest empty state.

### Patch Changes

- Updated dependencies [20977aa]
- Updated dependencies [14b2c6c]
- Updated dependencies [223fa0a]
  - @megasaver/output-filter@1.4.0
  - @megasaver/stats@1.3.0
  - @megasaver/content-store@1.1.2

## 0.4.0

### Minor Changes

- 26106bc: Live Context Seam: capture agent failures as first-class evidence and feed them
  back into the next task's context selection, closing the loop between what an
  agent got wrong and what it sees on the retry.

  - `@megasaver/shared`: new `sessionFailureIdSchema` — the branded id boundary for
    a persisted failure record, so a failure id is validated once at the edge and
    trusted internally thereafter.
  - `@megasaver/core`: new `SessionFailure` type plus registry methods
    `createSessionFailure(input)` and `listSessionFailures(query)`. Failures are
    stored alongside sessions with the same metadata discipline as memory
    (source, timestamp, scope), and `listSessionFailures` is the read side the
    ranking path consumes.
  - `@megasaver/context-gate`: failure capture wires recorded `SessionFailure`
    rows into the gate, and failure-aware ranking boosts files/blocks implicated
    in recent failures so a retry surfaces the evidence the last attempt missed.
    Additive — with no recorded failures the ranking is byte-identical to today.
  - `@megasaver/mcp-bridge`: new `get_task_context` MCP tool exposes the
    failure-aware context selection to connected agents, returning the ranked
    context for a task including any failure-boosted evidence.

- 794be8b: Saver activation inheritance across Git worktrees: a repository-family setting is
  inherited by every worktree sharing the same canonical Git common directory, so an
  enabled repo covers its `.claude/worktrees/...` sessions. Fixes the live case where
  an enabled main repo left its worktree sessions uncompressed.

  - `@megasaver/shared`: new `RepositoryFamilyKey` branded type (`gf1_` + base64url
    SHA-256), browser-safe validator.
  - `@megasaver/context-gate`: canonical-path family identity (platform/volume-aware,
    durable across reboot/remount/restore), a bounded Git common-directory resolver
    (no subprocess; separate-git-dir main + worktrees converge; foreign worktree-admin
    pointers rejected), a hardened v1 activation store (exact/family/global records +
    legacy-shape normalization, atomic 0600/0700 writes, digest fail-closed, activation
    lock), the `resolveWorkspaceTokenSaverSettings` precedence (exact → repository →
    legacy-root → global → disabled; degraded git never resurrects a legacy record but
    the global default still applies), a bounded heartbeat registry (256/30d/future-skew,
    derived `latest`/`latestCompression`, non-mutating reads) that also feeds proxy
    status, and the shared `resolveActivationScope`/`writeActivation` helpers.
  - `@megasaver/cli`: the PostToolUse saver hook now resolves activation through the
    repository-family precedence (a worktree inherits its repo's enable) and writes
    invocation/compression liveness heartbeats. `mega session saver workspace
{enable,disable}` is repository-aware (family record by default in a repo, `--exact`
    for this checkout only, scope echo); new `default {enable,disable}` writes the global
    default; new `resolve` shows the resolved activation + liveness. **Public behavior
    change:** the activation record shape is now strict v1 and the workspace toggle
    defaults to family scope inside a repo.
  - `@megasaver/gui`: the workspace saver toggle writes through the same shared scope
    helper (family inside a repo) and reports the effective inherited activation + source.

- 4269f42: Live Context Seam phase 2: harden failure capture, feed failures back through
  every read path, and make the seam observable and switchable end to end.

  - `@megasaver/context-gate`: overlay failure store persists captured failures
    through the registry; failure-aware ranking now applies on registry read
    paths, with new memory and conventions hint sources feeding the gate.
    Hint building is best-effort per source — a corrupt store file degrades to
    a non-fatal `session hints skipped` warning instead of failing the read.
    Capture filtering skips evidence-free exit-1 runs, redacts the full raw
    output before the 4000-char evidence cap, and failure signatures are
    restricted to a code-extension allowlist so non-code noise never becomes a
    signature. Seam replay traces are recorded with an A/B switch, gated behind
    opt-in `MEGASAVER_SEAM_TRACE=true`.
  - `@megasaver/output-filter`: new kill switch resolver disables the seam per
    scope, `seamTraceEnabledByEnv` gates trace recording, and
    `readReplayTraces` exposes recorded replay traces to consumers.
  - `@megasaver/cli`: new `mega audit seam` command reports seam effectiveness
    from recorded replay traces.

### Patch Changes

- Updated dependencies [69ce82f]
- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
- Updated dependencies [b5c6c0d]
  - @megasaver/stats@1.2.0
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0
  - @megasaver/content-store@1.1.1
  - @megasaver/evidence-ledger@0.2.1
  - @megasaver/policy@1.2.1

## 0.3.0

### Minor Changes

- c12a575: Add per-session already-in-context dedup to the registry read pipeline.
  When `runOutputPipeline` is about to return an excerpt whose exact text
  was already shown earlier this session (recorded in a new sibling
  `shown-index.json`), the excerpt is dropped from the inline result and
  referenced via its prior chunk-set id instead — so identical text is not
  billed twice. Dedup runs after the chunk-set is persisted, so every
  suppressed excerpt remains recoverable via the referenced chunk-set
  (evidence-preserving). Adds an optional `deduped` field to
  `FilterOutputResult` and a `SHOWN_INDEX_FILENAME` constant to
  content-store (skipped when listing chunk-sets).
- c12a575: feat: per-session already-in-context dedup

  Suppress an excerpt whose exact text was already returned to the model
  earlier in the same session (any read, command, or grep) and reference the
  prior chunk-set instead, so identical text is not billed twice. New
  per-session shown-index.json sibling index; evidence stays recoverable via
  the referenced chunk-set (lossless expand).

- 46dce69: diff-on-reread (suppression-only): re-reading an unchanged file in the same
  session returns an `unchanged: { priorChunkSetId }` marker with empty
  excerpts and skips re-filtering + re-persisting. Lossless — the prior
  chunk-set is recoverable via expand. Adds FilterOutputResult.unchanged +
  unchanged-marker decision (output-filter); readRaw / filterRaw / read-index
  exports (context-gate); exports atomicWriteFile + read-index-tolerant
  listChunkSets / READ_INDEX_FILENAME (content-store).

  No @megasaver/daemon or @megasaver/mcp-bridge bump — passthrough only,
  confirmed by T11.

- da6e687: Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
  and fills it as the ranking intent for PostToolUse-captured native output when no
  explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.
- ede092b: Lazy-load the TypeScript compiler out of the eager import graph. The
  semantic AST chunker imported `@megasaver/indexer` (which statically
  imports the multi-MB `typescript` compiler) at the top of
  `output-filter`, so importing `@megasaver/output-filter` — and thus
  every per-tool-call hook, the daemon, and the CLI — eagerly paid a
  multi-second compiler load on startup. The indexer is now imported
  dynamically inside `chunkBySemantic`, gated behind a supported-extension
  precheck, so `typescript` only loads when a source file is actually
  chunked.

  This makes `filterOutput` and `chunkByFormat`/`chunkByFormatWithMeta`
  (`@megasaver/output-filter`) and `filterRaw` (`@megasaver/context-gate`)
  async — they now return promises. All in-tree callers await them; the
  semantic chunker still never throws (parse error or unsupported source
  falls back to line chunking).

- fde8e86: Live-first Phase 4: session-scoped overlay surface keyed by
  `(workspaceKey, liveSessionId)` instead of `(projectId, sessionId)`.

  Adds, alongside the existing project-keyed APIs (kept for Phase 5):

  - `@megasaver/core`: `overlay-key` types (`workspaceKeySchema`,
    `liveSessionIdSchema`, `isSafeKeySegment`), `overlayMemoryEntrySchema`
    (scope-split: `project` = workspace/cwd-scoped, `session` = conversation),
    `overlayTaskPlanSchema`, and the overlay store fns
    (`read/writeOverlayMemory`, `read/writeOverlayTaskPlans`).
  - `@megasaver/stats`: `overlayTokenSaverEventSchema`,
    `overlaySessionTokenSaverStatsSchema`, and the overlay store fns
    (`appendOverlayEvent`, `readOverlaySummary`, `readOverlayEvents`,
    `resetOverlayOnDisable`).
  - `@megasaver/content-store`: `overlayChunkSetSchema` plus
    `saveOverlayChunkSet`/`loadOverlayChunkSet` for the
    `content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json` layout.
  - `@megasaver/context-gate`: `runOverlayOutputPipeline`,
    `runOverlayOutputExecCommand`, and `resolveOverlayEffectiveSettings`
    — the proxy pipeline re-keyed off the live session (no registry
    lookup), emitting events/chunks under the overlay keys.

- b1978fa: feat: outline-first read mode

  `mega_read_file` accepts `outline: true`: for a supported source file it
  returns the file skeleton (imports + top-level signatures + line ranges +
  chunk ids) and persists every body as a fetchable chunk, so an agent expands
  only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
  falls back to a normal read for non-source / unsupported / unparseable files.

- 3e678e3: Realize Saver Mode on native tool output: a `mega hooks saver` PostToolUse hook
  compresses large Read/Bash/Grep/Glob/LS output (evidence-preserving — the full
  redacted output is stored as a recoverable chunk), feeds the model the
  compressed result via `updatedToolOutput`, and records per-session overlay
  events that populate the live GUI Token saver tab. Gated on the Saver Mode
  toggle + mode budget; never blocks (exit 0; any error or multi-modal output ⇒
  original untouched). `mega hooks install` now installs both the PreToolUse
  telemetry hook and the PostToolUse saver hook. Adds context-gate
  `recordAndFilterOverlayOutput`.
- 4fe5749: runOutputPipeline now records a TokenSaverEvent per file read
  (RunOutputResult widens with store_write_failed), core re-exports the
  stats read/append surface, and `mega session saver stats` reads the
  real stats store (text totals + eventStats in --json; BB6 stub retired).

### Patch Changes

- 7c916db: Fix `recordAndFilterOverlayOutput` storing every overlay chunk-set with
  `source: { kind: "file", path: label }` regardless of the tool. A Bash
  command or grep was recorded as a file path in the stored chunk-set's
  `source` metadata. The `input.sourceKind` is now mapped to the matching
  `OverlayChunkSet["source"]` variant (`command` / `grep` / `fetch` /
  `file`). Cosmetic correctness only — the hook's behaviour and lossless
  raw recovery are unaffected; the overlay event already recorded the
  correct `sourceKind`.

  Note: the `fetch` variant's `url` is schema-validated (`z.string().url()`),
  so a future `sourceKind: "fetch"` caller must pass the actual URL as the
  label. No current caller emits `fetch` (hook matcher is
  `Read|Bash|Grep|Glob|LS`), so there is no behaviour change today.

- da9d3a7: Defense-in-depth security hardening (PR #146 follow-up)

  **evidence-ledger / context-gate**: `appendEvidence` now requires a `redactSourceRef`
  port (compile-time fail-closed: every caller must wire it). The port is applied to
  `sourceRef` before schema parse, so the stored record can never contain an
  unredacted secret-bearing field. `context-gate/record-output` wires
  `policyRedactSourceRef` which runs `@megasaver/policy` redact over
  command/args/url/query/path/label (hookTool left as-is — it's a tool name, not
  secret-bearing).

  **mcp-bridge**: The server-owned expansion-guard `Set<string>` is replaced with a
  FIFO-bounded `BoundedSet(EXPANSION_GUARD_CAP)` (cap = 4096). A long-lived server
  process can no longer grow the allowed-chunkSet set without bound. Per-session
  keying is deferred: `mega_fetch_chunk` args carry no `sessionId`, so keying by
  session would require a breaking wire-protocol change; stdio MCP is single-session-
  per-process in practice.

- 97ccb98: Redact the source label before it is persisted on the saver hot path. The
  overlay chunk-set `source` (command/url/grep-query/file-path) and the overlay
  stats event `label` previously stored the raw label — a credential-bearing
  command line (`curl -H "Authorization: Bearer ..."`), a token-bearing fetch
  URL, or a secret-laden path landed on local disk even though the chunk CONTENT
  was already redacted. `recordAndFilterOverlayOutput` now runs the
  `@megasaver/policy` `redact` over the label once and feeds the redacted form to
  both write points, mirroring the `policyRedactSourceRef` port on the evidence
  path. Redaction keeps the label readable (secret → marker, not blanked); a
  redacted fetch URL still passes the `overlayChunkSetSchema` `z.string().url()`
  guard, so `mega audit`/recall display the same source minus the secret.

  Scope: this closes the leak for the `recordAndFilterOverlayOutput` overlay path
  and for the secret shapes `redact` recognises (prefix/structure-based: `ghp_`,
  `sk-`, `AKIA`, `Bearer <tok>`, JWT, private-key blocks, quoted env values, DB
  URLs). Generic secrets with no recognised shape (e.g. a bare `?token=<hex>`
  query param or `user:pass@host` basic-auth) are still not caught — the same
  blind spot the content redactor has. The parallel `run-command.ts`
  (`proxy_run_command`) and `run.ts`/`read.ts` file-read saver paths persist their
  own raw command/args/path and are NOT covered here; both are tracked as
  follow-ups.

- aa42dbd: Redact the source label/command/args/path before persistence on the remaining
  saver paths. PR #148 fixed only `recordAndFilterOverlayOutput`; the parallel
  live paths still wrote the raw label to disk:

  - `run-command.ts` (`runOutputExecCommand` legacy + `runOverlayOutputExecCommand`
    overlay — the latter wired into `proxy_run_command`) persisted
    `source.command` + `source.args` and the stats event `label` raw. Because it
    stores the real `args` array, a bearer token in `curl -H "Authorization:
Bearer ..."` landed verbatim in `source.args` on disk.
  - `run.ts` (legacy + overlay file pipelines) persisted the file `path` raw in the
    stats event `label`.
  - `read.ts` `persistChunkSet` + `persistOverlayChunkSet` persisted the file
    `path` raw in `source.path`.

  Each sink now applies `@megasaver/policy` `redact` (the same detector used for
  chunk content): the command and each `args` element are redacted element-wise,
  the joined event label is rebuilt from the redacted parts, and the file path is
  redacted at the `persist*` sink (covering every caller of those exported
  functions) and again for the event label in `run.ts`. Redaction stays readable
  (secret → marker, not blanked).

  Known limit (unchanged from #148): `redact` only catches prefix/structure-shaped
  secrets, so a bare `?token=<hex>` query param or `user:pass@host` basic-auth in a
  command/path is still not caught — the same blind spot the content redactor has.
  Hardening `packages/policy/src/redaction-patterns.ts` is tracked separately.

- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [7fcd881]
- Updated dependencies [66ac31e]
- Updated dependencies [62b3c65]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [9fc766e]
- Updated dependencies [0a3256b]
- Updated dependencies [da9d3a7]
- Updated dependencies [42207dd]
- Updated dependencies [b2e39cd]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
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
- Updated dependencies [f46ce66]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0
  - @megasaver/content-store@1.1.0
  - @megasaver/stats@1.1.0
  - @megasaver/evidence-ledger@0.2.0
  - @megasaver/policy@1.2.0

## 0.2.0

### Minor Changes

- bb3d179: Load and enforce project permissions (`.megasaver/permissions.yaml`).

  New public API: `loadProjectPermissions(projectRoot): ProjectPermissions | null`
  — synchronously reads `<projectRoot>/.megasaver/permissions.yaml`, parses it with
  the new `yaml@^2` dependency (safe-by-default `parse`, no custom tags / code-exec),
  and delegates validation to the pure `policy.parseProjectPermissions`. An absent
  file returns `null` (baseline only); every other failure mode (non-ENOENT fs error,
  YAML syntax error, schema violation) becomes a single typed `PolicyLoadError` —
  fail-closed.

  `resolveEffectiveSettings` now loads the permissions once per resolve (via an
  injectable loader, default = the real fn) and returns a discriminated
  `ResolveResult` (`session_not_found` | `policy_load_failed` | `ok`); `EffectiveSettings`
  carries the loaded `ProjectPermissions | null`, threaded into `evaluateCommand`
  and `runTwoGates`. A present-but-malformed file denies the operation in resolve,
  before any spawn or `fs.readFile`. Adds the `yaml@^2` runtime dependency.

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [bb3d179]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0
  - @megasaver/policy@1.1.0
  - @megasaver/content-store@1.0.1
  - @megasaver/stats@1.0.1

## 0.1.0

### Minor Changes

- a2526d3: Extract the context-gate orchestrator out of `@megasaver/core` into a
  standalone `@megasaver/context-gate` package (AA1 BB12 — §2a
  deferred-extraction trigger fired: 553 LOC > 500). Behavior-preserving:
  the orchestrator's `context-gate -> core` edge (a type-only `CoreRegistry`
  import in 4 files) is broken by a 3-property structural `OrchestratorRegistry`
  port defined in the new package; core's `CoreRegistry` structurally
  satisfies it, so no call site changes. `@megasaver/core` now re-exports the
  orchestrator from `@megasaver/context-gate`, so `apps/cli` and
  `@megasaver/mcp-bridge` consumers keep importing `runOutputPipeline`,
  `runOutputExecCommand`, `fetchChunk`, and `locateChunkSet` from
  `@megasaver/core` unchanged. No runtime behavior changes.
