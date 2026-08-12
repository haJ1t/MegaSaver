# @megasaver/stats

## 1.6.2

### Patch Changes

- db91dd3: Add Session Mesh Family (A1→A5) — local, file-backed session mesh.

  New leaf package `@megasaver/mesh` (files are truth, `store/mesh/`): presence register/heartbeat/listPeers/gc/events, at-most-once inbox (redacted, bounded drain), advisory claims (TTL 30m, repo-family scoping, glob via NFA), structured board (post/list/resolve/promote, disputed/supersede, TTL, 500-token injection), peer Q&A routing (`mesh_send` kind ask/answer, 60s rate-limit, keyword hint ≥3 overlap ≤200/30m ≤500 chars), handoff capability (`HandoffCapabilityProfile` on every `ConnectorTarget`, `evaluateHandoffFit` measured on rendered block, `open` strict vs `--fit`, `peers`/`offer` pointer-only). CLI `mega mesh {status,send,ask,answer,claims,events,gc}`, `mega board {post,list,resolve,promote}`, `mega handoff {peers,offer}` + `open --fit` / `pack` advisory, MCP 10 tools (`mesh_*` 7 + `board_*` 3) + `handoff-offer` bus kind, hooks (warmup register, saver heartbeat fire-and-forget ≥5s, guard conflict+inbox inject bounded 5/2000, board digest/delta 500/30s, `mesh-hint` opt-in `--mesh-hints`), daemon `GET /mesh/status` accelerator. All writes atomic tmp+rename 0600/0700, torn lines skipped/quarantined, every hook catch→exit 0, every user text through `redact()` before persist, advisory-only (warn, never block).

## 1.6.1

### Patch Changes

- @megasaver/output-filter@1.7.1

## 1.6.0

### Minor Changes

- 5e350e3: Add `normalizedCostUsd`: benchmark cost derived from the token breakdown at
  fixed standard rates, so identical token counts always price identically.
  Rates live in `scripts/benchmark-rates.json`, shared with the bash/python
  harness; a test pins the two in sync.

  Scope note: this was introduced to remove a suspected fast-mode (2x) billing
  artifact from the benchmark gate. Measurement of 24 saved benchmark result
  files afterwards showed every one was served `standard` tier with
  `fast_mode_state: off`, and raw `total_cost_usd` already equalled the
  normalized value in all of them — so on current data this changes no number.
  It is kept as insurance: the gate now cannot be perturbed by billing tier,
  whatever tier a future run is served at.

- 1ecbaef: Date the headline dollar figure. `packages/stats/src/savings-headline.ts` held
  its own copy of the input rate — `INPUT_PRICE_PER_MTOK_USD = 3.0`, a bare
  literal — and `savingsFootnote()` rendered
  `(est. at $3/M input; …)` with **no capture date**. That footnote is what the
  CLI audit line (`apps/cli/src/commands/audit/shared.ts:89`) and both GUI
  surfaces (`overview-page.tsx:211,231`, `workspace-session-list.tsx:298`) print
  next to the `$` a user actually reads, so the most-seen dollar figure in the
  product was the one undated pricing claim.

  Meanwhile the repo already enforced provenance on the path _fewer_ users reach:
  `MODEL_LIST_PRICES` carries `capturedAt`, `loadModelPriceTable` rejects a table
  without it (`missing_capture_date`), and `mega audit --honest` renders
  "published list input rates, captured 2026-08-01". Two pricing sources, one
  gate.

  Now one source. `INPUT_PRICE_PER_MTOK_USD` is derived —
  `inputPricePerMTok(MODEL_LIST_PRICES, undefined).usd` — and the new
  `INPUT_PRICE_CAPTURED_AT` export carries `MODEL_LIST_PRICES.capturedAt`
  alongside it. The footnote reads:

  ```
  (est. at $3/M input, published list rate captured 2026-08-01; saved tokens
  were never sent, so not cache-discounted.)
  ```

  **No user-visible number changes.** The dated table's fallback model is
  `claude-sonnet-5` at `$3.0/MTok`, exactly the literal that was there — this
  swaps the provenance, not the price. The `(est.)` labelling and the
  "not cache-discounted" caveat are untouched.

  Breaking (pre-1.0): `savingsFootnote(rate)` is now
  `savingsFootnote(rate, capturedAt)`. `capturedAt` is required rather than
  defaulted on purpose — a caller pricing at its own rate would otherwise inherit
  this module's date and stamp the wrong provenance on a figure that did not come
  from this table. The only in-repo call site is `SAVINGS_FOOTNOTE` itself;
  `packages/core/src/context-gate.ts` re-exports the function unchanged.

  The alignment pin in `packages/stats/test/savings-headline.test.ts` went
  tautological once the constant was derived from the table it was pinned
  against, so it is joined by literal pins on both `3.0` and `2026-08-01`:
  editing the price table reprices every headline `$` in the CLI and GUI, and
  that must fail a test and be re-approved, not ride along as a table edit.

  Two follow-ups this does not close. First, `formatSavingsHeadlineLines`
  (`apps/cli/src/commands/audit/shared.ts:89`) always prints the module-level
  `SAVINGS_FOOTNOTE` while the `$` beside it comes from
  `opts.inputPricePerMTok` when a caller overrides the rate. No production caller
  overrides today (only a test passes `{ inputPricePerMTok: 15 }`), so this is
  pre-existing — but the mismatch is now worse in kind, because an overriding
  caller would get a wrong rate _plus_ a capture date lending it authority. The
  fix is to thread the rate and date together, or to derive the footnote from the
  headline rather than from the module constant.

  Second, still undated: `apps/cli/src/commands/cache.ts:245` and
  `packages/pro-analytics/src/{bench,teardown}.ts` each build their own rate
  string from `INPUT_PRICE_PER_MTOK_USD` without a date. They can now import
  `INPUT_PRICE_CAPTURED_AT` from `@megasaver/stats`.

- 89eea64: Hot Handoff (i10): `mega handoff pack/open/inspect/clear` — redacted,
  expiring `.megahandoff` task packets carry live task state across agents.
  `pack` (Pro; `--dry-run` free) writes a budgeted brief, recallable
  memories, unresolved failures, and a secret-path-filtered dirty diff into a
  hash-framed packet; `open` (Pro) applies it as a redaction-guarded HANDOFF
  sentinel block in the target agent's config file (creating the file with
  its header when absent) and optionally merges memories as suggested
  entries; `inspect` (free) recomputes the redaction/secret-path scan from
  the payload instead of trusting manifest claims; `clear` (free) removes the
  block. New `"hot-handoff"` ProFeature key; advisory `HandoffEvent` stats
  stream.
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

- b00c54f: The savings headline prices the signed NET (S4-1). `SavingsHeadlineTotals`
  accepts an optional `deltaBytesTotal` (gross minus expansion debits);
  `computeSavingsHeadline` prices that net — clamped at zero — instead of the
  gross `bytesSavedTotal`, and `SavingsHeadline` gains `grossTokensSaved`,
  `netTokensSigned` (the UNCLAMPED signed net), and `tokensRefetched`
  (derived from the unclamped delta, so it can exceed gross) so surfaces can
  render "X saved − Y re-fetched + overhead = Z net" exactly, including
  windows that lost more than they saved. The negative-delta pool includes
  envelope overhead, not only refetches — hence the label. Absent
  `deltaBytesTotal` falls back to gross (legacy callers, pre-B1 stores).
  `savingsHeadlineFromTokens` reports gross == net with zero refetch — a bare
  token count carries no expansion split. The stats event schema is
  unchanged. The GUI overview and workspace strip now show the net as the
  primary figure with the gross breakdown secondary.
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

- 6ea5968: Add an optional POSIX Task Kickoff response with session-global at-most-once
  delivery, canonical unique-project selection, and owner-only persistence.
  Recognize and deduplicate only supported first-party hook launchers, refuse
  symlinked or non-regular accounting targets through a no-follow, nonblocking
  descriptor, and make the irreversible stdout accounting boundary explicit.
  Ship the sidecar-free Node 22 bundle behind a full-minification, sub-12 MiB CI
  gate; Windows continues to emit no Task Kickoff output or state.
  This release makes no measured cache-write savings claim; that remains gated on
  a paired fresh-store benchmark with task-parity and total-cost evidence.

### Patch Changes

- 07a4e3d: Stop a `mega audit` / `mega hooks status` READ from destroying registry-session
  stats.

  The layout discriminator added in `fix/gc-reconcile-clobbers-legacy-summaries`
  guarded `reconcileOverlaySummaries` only. `readOverlaySummaryAnyWorkspace` still
  walked every `stats/<dir>` as an overlay workspace behind `isSafeSegment`, and
  it is a SELF-HEALING read: a summary that fails
  `overlaySessionTokenSaverStatsSchema` is rebuilt and written back
  (`loadOverlaySummarySelfHealing` → `rebuildGuarded` → `atomicWriteFile`). A
  registry summary at `stats/<projectId>/<sessionId>.json` always fails that
  schema, so the scan overwrote it with a zeroed overlay summary — the same data
  loss, now on a read path reachable from three commands (`mega audit session`,
  `mega audit honest`, `mega hooks status --session`) instead of the once-a-day GC
  sweep. `mega audit honest` does not even consult the registry first.

  Measured (temp store, one registry `appendEvent`, then a single
  `readOverlaySummaryAnyWorkspace(store, <sessionId>)` call), before the fix:

  ```
  BEFORE {"sessionId":"1111…","eventsTotal":1,"rawBytesTotal":10000,
          "bytesSavedTotal":9000,"secretsRedactedTotal":2,"chunksStoredTotal":3,…}
  SCAN   {"workspaceKey":"22222222-…","summary":{"liveSessionId":"1111…",
          "eventsTotal":0,…all zeros…,"rebuiltAt":"…"}}
  AFTER  {"liveSessionId":"1111…","eventsTotal":0,…all zeros…,"rebuiltAt":"…"}
  READ   readSummary THREW store_corrupt
  ```

  After the fix, same store: `SCAN null`, `AFTER` byte-identical to `BEFORE`,
  `readSummary` returns `bytesSavedTotal: 9000`.

  All three `stats/*` walkers now share one `overlayWorkspaceKeys` helper that
  applies the `workspaceKeySchema` discriminator (16 lowercase hex, what
  `encodeWorkspaceKey` emits), so the next walker added cannot reintroduce this.
  `readAllWorkspaceTokenSaverTotals` is unchanged in behaviour — registry
  summaries already failed its schema filter — it just no longer descends into
  registry dirs.

- 07a4e3d: Stop the daily GC sweep from destroying registry-session stats.

  `reconcileOverlaySummaries` walked every `stats/<dir>` as an overlay workspace,
  filtered only by `isSafeSegment`. Registry sessions live in the same tree under
  `stats/<projectId>/<sessionId>.json`, so one sweep (`maybeRunOverlayGc`, once a
  day from the PostToolUse saver) rewrote them as overlay summaries.

  Measured on a store holding one registry session plus a `handoff.events.jsonl`
  ledger, before → after:

  ```
  before  {"sessionId":"1111…","eventsTotal":1,"bytesSavedTotal":9000,
           "secretsRedactedTotal":2,"chunksStoredTotal":3,…}
  after   {"liveSessionId":"1111…","eventsTotal":0,"bytesSavedTotal":0,
           "secretsRedactedTotal":0,"chunksStoredTotal":0,…,"rebuiltAt":…}
  ```

  `rebuilt` was 2, and the sweep also fabricated `stats/<projectId>/handoff.json`
  out of the handoff ledger (same for the `guard` / `warm-start` / `code-truth`
  ledgers). The rewritten file no longer parses as `sessionTokenSaverStatsSchema`,
  so `readSummary` and `appendEvent` threw `store_corrupt` from then on — every
  later `mega output exec/file/filter` in that session returned
  `store_write_failed`, and `mega session saver stats --session <id>` threw.

  The sweep now only enters dirs matching `workspaceKeySchema` (16 lowercase hex,
  what `encodeWorkspaceKey` emits) — the same layout discriminator
  `locateChunkSet` already uses. Same store after the fix: `rebuilt` 0, the
  registry summary byte-identical, no `handoff.json`, and a real overlay
  workspace in that store still repaired (`eventsTotal` 1 → 2).

- 07a4e3d: Repair registry summaries that the pre-fix overlay GC sweep clobbered. The
  layout discriminator stopped new damage but left already-damaged stores
  permanently dead: `stats/<projectId>/<sessionId>.json` held an overlay-shaped
  summary, so `readSummary` and `appendEvent` both threw `store_corrupt` on every
  call — `mega output exec/file/filter` returned `store_write_failed` and
  `mega session saver stats --session <id>` threw, forever.

  A summary that is valid JSON but fails the registry schema is now rebuilt from
  the intact `<sessionId>.events.jsonl` and persisted, mirroring the overlay
  path's rebuild-from-JSONL recovery. A summary that is not JSON at all keeps the
  existing loud `store_corrupt` posture: that is a torn write, not a layout
  mismatch, and the registry event carries no `secretsRedacted`/`chunksStored`,
  so a rebuild would silently zero those two counters.

- 07a4e3d: Write the store owner-only (dirs 0700, files 0600). Everything MegaSaver
  persists was created with process-default permissions — 0644 files inside 0755
  directories — so on a shared box every other local account could read it with
  `cat` (CWE-732).

  The exposed data is the sensitive half of the product: an `OverlayChunkSet`
  holds the verbatim body of every file the agent read and the full transcript of
  every command it ran (redacted only for known secret shapes), and
  `stats/<wk>/session-intent.json` holds the user's verbatim prompt. Both are
  written on the default install path — the `mega hooks install` UserPromptSubmit
  and PostToolUse hooks — with no exploit step beyond `ls -l`.

  Measured on a fresh `HOME` through the real hook entry point
  (`… | mega hooks intent`), before → after:

  ```
  drwxr-xr-x  <HOME>/.local/share/megasaver           drwx------
  drwxr-xr-x  …/megasaver/stats/<wk>                  drwx------
  -rw-r--r--  …/<wk>/session-intent.json              -rw-------
  -rw-r--r--  …/<wk>/intent/sess1.json                -rw-------
  ```

  and through `mega output file <session> big.txt --intent …`, every one of
  `content/<proj>/<sess>/{<chunkSetId>,read-index,shown-index}.json`,
  `stats/<proj>/<sess>{.json,.events.jsonl}` and
  `stats/<proj>/<sess>-traces/replay-traces.jsonl` moved from `-rw-r--r--` to
  `-rw-------`, with every containing directory from `drwxr-xr-x` to `drwx------`.

  Fixed at the writers rather than at one directory, matching the convention the
  already-hardened siblings use (`daemon/discovery.ts`, `llm-proxy/store.ts`,
  `context-gate/saver-store.ts`): the three `atomicWriteFile` helpers
  (content-store, stats, evidence-ledger), the seven stats JSONL appenders (now
  routed through one `appendPrivateLine`), `writeReplayTrace`, the CLI intent
  hook's `writeIntentAt`, and `initStore` for the store root itself.

  Each site pairs the create-time `mode` with an explicit `chmod`, which is what
  actually repairs an existing install: `mkdir`'s mode is a no-op on a directory
  that already exists and `appendFileSync`'s is ignored once the file exists. That
  gap is why the hardened writers were being defeated in practice — an unhardened
  writer usually created `stats/` first, leaving `saver-hook-heartbeats.json`
  (0600) sitting in a 0755 directory. On the next write, an old store now heals
  itself.

  Windows is unaffected (NTFS ignores POSIX mode bits); the permission assertions
  skip there.

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

- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [b808902]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [d26c4ec]
- Updated dependencies [07a4e3d]
- Updated dependencies [4ddac04]
- Updated dependencies [83202e0]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [9d46944]
  - @megasaver/output-filter@1.7.0
  - @megasaver/shared@1.3.1

## 1.5.0

### Minor Changes

- eb74c35: Code-Truth Verify (i6): git-anchored memories that stale and heal.

  - core: `memory-anchor` module (codeAnchor/lastVerified schemas, best-effort
    `captureCodeAnchor`), `code-truth` module (pure `verifyAnchors` planner +
    `runVerify` git runner), whole-batch `applyMemoryEntryPatches`, and
    `STALE_WEIGHT` down-ranking for stale rows on includeStale surfaces.
    Contradiction closes `validTo` with ownership tracking
    (`closedByCodeTruth`); heal reopens only code-truth-owned closes. Anchor
    paths reject control characters at the schema boundary.
  - output-filter: public `extractBlocksForFile` polyglot per-file extraction.
  - cli: `mega memory verify` (free one-shot; `--install-hook` /
    `--uninstall-hook` Pro post-commit automation), `--symbol` inputs,
    `--no-anchor` opt-out, sweep verify pre-pass (Pro), show/explain anchor
    summary + verification badge.
  - mcp-bridge: `save_memory` symbol anchors, `get_relevant_memories`
    verification badges + Pro pre-recall spot-check with sentinel-guarded
    disclosure, new `verify_memories` tool (Pro).
  - stats/entitlement: `code-truth` ProFeature key, stale-recall-avoided ledger
    and "stale recall waste avoided" savings line.

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

- Updated dependencies [eb74c35]
  - @megasaver/output-filter@1.6.0

## 1.4.0

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

- Updated dependencies [815445a]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/output-filter@1.5.0
  - @megasaver/shared@1.3.0

## 1.3.0

### Minor Changes

- 14b2c6c: Savings headline: surface saved tokens as a visible, defensible value.

  MegaSaver already computed tokens saved but showed them only as raw bytes/tokens
  buried in an audit command. This turns that number into a value a person feels:
  a cumulative `≈$X saved (est.) · ≈Z sessions' worth of context reclaimed` on the
  GUI home strip and the `mega audit report` output.

  - **@megasaver/stats**: new pure `computeSavingsHeadline` (byte entry) +
    `savingsHeadlineFromTokens` (token entry) share one price/window model —
    `INPUT_PRICE_PER_MTOK_USD = 3.0` and `CONTEXT_WINDOW_TOKENS = 200_000`. Tokens
    reuse the existing `tokensFromBytes` (bytes/4) model. New
    `readAllWorkspaceTokenSaverTotals` aggregates every workspace with a blended
    ratio for the cumulative headline. A browser-safe `@megasaver/stats/headline`
    subpath lets the GUI client import the const without pulling the node store.
  - **@megasaver/cli**: `mega audit report` renders a `$` headline line + a
    one-line footnote after the summary, and carries the `SavingsHeadline` object
    under `--json`. Zero savings renders an honest
    `No savings recorded in this window yet.` — never a fake `$0.00` flex.
  - **@megasaver/gui**: a new `GET /api/token-saver/all-workspaces` bridge route
    returns the summed totals; the home strip renders
    `≈$X saved (est.) · ≈Z sessions reclaimed` with the estimate assumption in a
    hover footnote, and an honest `No savings recorded yet — enable the saver to
start.` empty state.

  Honesty: the `$` is always labeled `(est.)` because the one modeled assumption is
  the per-model input price. Saved tokens were compressed away and never sent, so —
  unlike the conversation proxy's `$` — they carry no prompt-cache discount to
  double-count. The 200K-per-session divisor deliberately UNDER-counts real
  sessions (a session rarely fills 200K), so reclaim is never overstated.

- 223fa0a: Savings share card: the product generates its own shareable savings image.

  The savings screenshot is the niche's native currency, so MegaSaver becomes its
  own ad creative. A new pure `renderSavingsCardSvg(headline, { windowLabel })`
  turns a `SavingsHeadline` into a 1200×630 direction-B card (minimal editorial:
  light `#f6f5f2` ground, dark `#17181a` ink, one big `$` number, "Mega Saver"
  mark, three sub-stats, footer "Less tokens. More signal."). It lives in the
  browser-safe `@megasaver/stats/headline` barrel so the GUI and a future
  `mega share` reuse one renderer; all text derives from the real headline (no
  invented numbers), carries `(est.)`, and untrusted window labels are escaped.

  - New GUI **Share** button beside the savings strip, shown only when
    `bytesSavedTotal > 0`. It opens a modal previewing the card and exporting it:
    **Download PNG** (zero-dep SVG→canvas→`toBlob`), best-effort **Copy image**
    (guarded when the clipboard API is missing), and **Share on X** (a tweet-intent
    whose honest, `(est.)`-carrying text comes from the same `computeSavingsHeadline`
    — one source, no overstatement). X can't auto-attach the image, so the modal
    tells the user to download the card then attach it.

### Patch Changes

- Updated dependencies [20977aa]
  - @megasaver/output-filter@1.4.0

## 1.2.0

### Minor Changes

- 69ce82f: Audit overlay fallback: when a session has no recorded audit overlay, fall back
  to the last known good overlay instead of rendering an empty panel, so the audit
  view stays useful across sessions that predate overlay capture.

  - `@megasaver/stats`: overlay resolution degrades gracefully — a missing
    per-session overlay resolves to the most recent available overlay rather than
    returning nothing.
  - `@megasaver/cli`: the audit command surfaces the fallback overlay and flags it
    as inherited so the operator knows the data is not session-specific.

- b5c6c0d: Workspace token-saver totals: aggregate per-session token-saver stats into a
  workspace-wide total so the GUI can report savings across every session in a
  repository, not just the active one.

  - `@megasaver/stats`: totals aggregation over the session set — sums input,
    output, and saved tokens across sessions and derives the workspace savings
    rate from the aggregate rather than averaging per-session rates.
  - `@megasaver/gui`: the token-saver panel reports the workspace-wide totals
    alongside the active session's figures.

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0

## 1.1.0

### Minor Changes

- 62b3c65: Add honest token-reduction metrics: token-weighted eligible reduction reported
  alongside eligible/proxied/passthrough/mediated fractions, a GA gate pairing
  reduction with an evidence-sufficiency floor, and `mega audit honest`. Passthrough
  outputs never create positive savings; the headline reduction is reported as
  eligible-mediated-context-only and cannot be inflated by eligibility-set selection.
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

- 484f243: Phase 8 — Context Audit & Token-Savings Dashboard. Extends
  @megasaver/stats (no new core entity) with an additive AuditEvent
  discriminated union (context_pack_built, rule_applied, failure_avoided,
  memory_retrieved, tool_route — scalar-only, no core types so the cycle
  guard holds), written to a sibling <store>/stats/<projectId>/<sessionId>
  .audit.jsonl (the byte .events.jsonl is untouched — no duplicate
  token-saver accounting). New pure summarizeAudit(events, { window, now })
  folds events in one exhaustive switch with window filtering
  (session|week|all) and derives tokensSaved/percentageSaved using the
  same formula as PackAudit; it imports no token estimator — tokensBefore/
  After arrive already-estimated from Phase 3's auditPack (estimateSpanTokens)
  carried verbatim into a context_pack_built event. New appendAuditEvent /
  readAuditEvents JSONL writer+reader (reuses StatsError schema_invalid /
  store_corrupt — no new codes). Core re-exports the audit surface (CLI/MCP
  never import @megasaver/stats directly). One read-only MCP tool
  audit_token_usage (bridge now 24 tools) and a mega audit CLI group
  (report / last / session / export --format json) returning the dashboard
  cards and the headline "would've been N tokens, was M, P% saved". Ships
  the context_pack_built emission on the build path to prove the demo;
  rule_applied/failure_avoided/memory_retrieved/tool_route emissions are
  fast-follows (the summarizer already handles all five kinds). No LLM, no
  new estimator, no GUI changes.
- 39e5eb6: Proxy Mode v1.2 Phase P5 — adoption + measurement (D7-rest, D8, D9).

  `@megasaver/stats` gains proxy metrics: `readEvents` reads the per-call
  audit trail, `aggregateAdoption` computes the universal adoption block
  (adoption rate, call count, calls-by-type, expand rate, proxy-mediated
  token savings, raw stored output count, average compression ratio),
  `ingestHookLog` + `computeInterception` derive the hook-based
  interception rate, and `buildProxyMetrics` assembles the combined shape
  (adoption always present; interception only when a Claude Code hook log
  exists, otherwise the verbatim install hint). Zero-denominator cases
  yield `0.0`; malformed JSONL lines are skipped.

  `@megasaver/cli` gains a `hooks` command group:

  - `mega hooks install claude-code` idempotently writes a `PreToolUse`
    telemetry hook into an injectable Claude Code `settings.json`,
    preserving unrelated keys.
  - `mega hooks log` is the metadata-only, best-effort, always-exit-0
    logger the hook invokes (never logs file contents, never blocks the
    tool call).
  - `mega hooks status <sessionId>` prints proxy adoption metrics always
    and hook-based interception only when the log exists, with honest
    wording that never overclaims universal interception.

  `mega doctor` now reports Claude Code hook telemetry as installed or
  missing (with the install hint). Connector instruction blocks bias
  agents to `proxy_*` tools and to expanding chunks before assuming
  omitted content is irrelevant. The README documents Proxy Mode as
  opt-in with the approved category-comparison framing and no
  competitor-specific headline.

### Patch Changes

- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [66ac31e]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [42207dd]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [8b735fb]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0

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

- 6078dc9: Add the `@megasaver/retrieval` and `@megasaver/stats` packages.

  `@megasaver/retrieval` provides standalone, pure BM25 ranking over chunked
  output text plus `DerivedIntent` derivation, giving the context gate a
  deterministic relevance signal without spawning git or holding a persistent
  index. `@megasaver/stats` adds the `SessionTokenSaverStats` and
  `TokenSaverEvent` Zod schemas with append/update helpers that persist under an
  injected store root (`<store>/stats/<projectId>/<sessionId>.json` +
  `.events.jsonl`) using the atomic-write pattern from `@megasaver/core`, so
  token-saver telemetry survives crashes without corrupting partial writes. Both
  expose their public surface from `index.ts` with closed, alphabetically pinned
  error-code enums.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [ae41534]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/output-filter@1.0.0
