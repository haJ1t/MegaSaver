# @megasaver/core

## 1.5.1

### Patch Changes

- Updated dependencies [a3ee0af]
  - @megasaver/policy@2.1.0
  - @megasaver/context-gate@0.8.1
  - @megasaver/output-filter@1.7.1
  - @megasaver/content-store@1.2.1
  - @megasaver/stats@1.6.1

## 1.5.0

### Minor Changes

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

### Patch Changes

- 07a4e3d: Fix `captureCodeAnchor` spawning one `git rev-parse HEAD:<path>` per related
  file. `relatedFiles` arrives from the `save_memory` MCP tool with no `.max()`
  on either schema (`save-memory.ts:56`, `memory-entry.ts:93`) and no request-size
  cap on the bridge, and capture runs _before_ `registry.createMemoryEntry`, so
  nothing downstream bounded the list. The loop contains no `await`, so the whole
  capture was one uninterruptible synchronous span — a large list froze the entire
  stdio server, not just the caller's request. The 3000 ms `execFileSync` timeout
  bounds one spawn, never the count.

  Fixed by asking git once, exactly as `code-truth.ts` already does for the verify
  side: `cat-file --batch-check` with the `HEAD:<path>` queries on stdin, replies
  paired positionally (safe because anchor paths are control-char-free by schema).
  Measured through `captureCodeAnchor` against a real 2,000-file repo, same
  anchors out:

  | cited files | before    | after  |
  | ----------- | --------- | ------ |
  | 100         | 631 ms    | 62 ms  |
  | 500         | 3,305 ms  | 139 ms |
  | 2,000       | 13,237 ms | 296 ms |

  Untracked paths are still skipped rather than anchored (`<query> missing`), and
  a git failure mid-capture still degrades to "no file anchors" with symbol
  capture continuing — capture stays best-effort and total.

  The injected `execGit` runner (`captureCodeAnchor` opts, `SaveMemoryEnv.execGit`)
  now takes a third `input` argument and **must forward it to git's stdin**; a
  runner that ignores it reads every cited file as untracked.

  Guarded at both call sites by spawn _counts_ at two input sizes — 20 and 400
  cited files, same count, no truncation — in
  `packages/core/test/memory-anchor-capture.test.ts` and
  `packages/mcp-bridge/test/tools/save-memory-anchor.test.ts`, plus a real-git test
  that batched replies stay paired to the right paths across an untracked gap.

- 88e479a: Redact three free-text handoff payload fields that shipped verbatim:
  `git.branch`, `git.changedFiles[].path`, and `git.diff.excludedPaths[]`. Every
  sibling field (commit subjects, diff text, memory and failure fields) was
  already redacted; a secret in a file name was redacted in
  `memories[].relatedFiles` and then shipped intact in
  `memories[].anchor.files[].path` two fields later. `excludedPaths` is by
  construction the list of files that matched a secret deny-glob.

  Code anchors are handled differently: `redactMemory` now DROPS the whole
  anchor (and `lastVerified` with it) when redaction would alter any anchor path
  or symbol name, instead of rewriting them. Those fields are code-truth lookup
  keys — `git cat-file HEAD:<path>` and symbol-name matching — so a redacted
  value resolves to nothing and makes the receiver record a false
  `contradicted`, closing the memory's `validTo`. The memory now imports
  unanchored instead. A clean anchor passes through byte-identical, hashes
  included. This lives in `redactMemory`, so `mega brain export` behaves the
  same way.

  Adds a structural guard against the underlying failure mode: handoff
  redaction is per-field discipline with no choke point, so a string field
  added to `handoffPayloadSchema` later would ship unredacted by default and
  silently. Three tests now enumerate every string leaf in the schema (failing
  closed on any zod wrapper the walker does not recognize), require each leaf
  to be classified as redacted / structural / dropped / unreachable, and plant
  one secret
  into every redacted path at once, asserting each is both populated and clean.

  Behavior notes: `report.excludedPaths` stays raw; it never leaves the
  sender's machine. A secret in a branch name now
  increments `redactionFindings` twice (once in the brief, once in
  `git.branch`); that counter is already documented as advisory high-water.

- 07a4e3d: Redact every secret-bearing memory field on the **import** side, not just
  `content` and `title`.

  `applyHandoffMemories` (`mega handoff open <packet> --merge`) ran
  `redactWithFindings` over `content` and `title` only, then spread the rest of
  the packet entry straight into `registry.createMemoryEntry`, which does nothing
  but `memoryEntrySchema.parse`. `mega brain import` redacted nothing at all. Both
  inputs are untrusted: `parseHandoffPacket` verifies no signature, only a
  self-computed `payloadSha256` an attacker recomputes freely.

  Measured on a packet whose `content`/`title` are benign, through the real
  registry:

  | field                                | before   | after          |
  | ------------------------------------ | -------- | -------------- |
  | `title`, `content`                   | scrubbed | scrubbed       |
  | `reason`, `goal`                     | **raw**  | scrubbed       |
  | `evidence[]`, `keywords[]`           | **raw**  | scrubbed       |
  | `relatedFiles[]`, `relatedSymbols[]` | **raw**  | scrubbed       |
  | `anchor.files[].path`                | **raw**  | anchor dropped |
  | `report.redactionFindings`           | 2 (of 7) | 7              |

  The fix routes both importers through the same `redactMemory` /
  `makeRedactor` the pack side already uses (`handoff-export.ts`,
  `brain-export.ts`), so an importer can no longer scrub fewer fields than the
  exporter — including the anchor, which drops whole rather than being rewritten,
  because its path is the `cat-file HEAD:<path>` lookup key. `redactionFindings`
  now sums the redactor's total, so the open-side warning stops under-reporting
  what it let through. Dedupe and `mega brain import`'s content key both move to
  the redacted content, keeping a re-run of a secret-bearing packet idempotent.

  Not covered: `mega brain import` still writes rules and failures unredacted,
  and the `handoff:<sourceProject.name>` provenance string is still appended raw.
  Both are the same class on other fields.

- 1ecbaef: Make `PlannerCard.filePath` platform-stable.

  `readPlannerBoard` and `writePlannerCard` built `filePath` with
  `relative(projectRoot, …)` and emitted it raw, so on Windows every card carried
  `.megasaver\planner\todo\my-card.md` while the same card on macOS/Linux carried
  `.megasaver/planner/todo/my-card.md`. The value crosses the GUI bridge's JSON
  boundary (`apps/gui/bridge/routes/planner.ts` → `card-drawer.tsx`), so the
  identifier a client sees depended on the host that produced it.

  This was the lone relative-path emitter in the repo that skipped normalization —
  `indexer/src/scan.ts:95` (`toPosix`), `mcp-bridge/src/tools/get-edit-impact.ts:85`
  (`replace(/\\/g, "/")`), `apps/cli/src/commands/memory/read-wiki.ts:37` and
  `apps/gui/bridge/routes/memory-graph.ts:89` (`split(sep).join("/")`) all already
  do it. `get-edit-impact.test.ts:155`, which asserts backslash-in → POSIX-out, is
  that convention written down as a test.

  All three `relative()` sites (`service.ts:63`, `:129`, `:153`) are normalized
  together. Partial normalization would be the only hazard here, and none of the
  three is load-bearing: every filesystem operation in the module builds its own
  `join()` path (`fullPath`, `probe`, `targetFile`, `tmpFile`, `archiveTarget`),
  and the `oldFilePath !== targetFile` rename check at `:159` compares two `join()`
  values, never the relative one. `filePath` is purely an identifier.

  Verified against `path.win32` semantics, reproducing the exact value CI reported:

  ```
  win32  raw  ".megasaver\\planner\\todo\\initial-task.md"
  win32  norm ".megasaver/planner/todo/initial-task.md"
  posix  raw  ".megasaver/planner/todo/initial-task.md"
  posix  norm ".megasaver/planner/todo/initial-task.md"
  ```

  `basename(norm, ".md")` returns `initial-task` under both `win32` and `posix`,
  so the parser's fallback-id path (`parser.ts:20`) is unaffected on either
  platform.

  Caught by `verify (windows-latest)`, where
  `packages/core/test/planner-service.test.ts:39` failed on
  `expect(card1.filePath).toContain(".megasaver/planner/todo/")`. The test was
  asserting the intended contract; the service was violating it. Both it and the
  sibling assertion at `:51` now pass unchanged.

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

- Updated dependencies [07a4e3d]
- Updated dependencies [5e350e3]
- Updated dependencies [193e757]
- Updated dependencies [07a4e3d]
- Updated dependencies [b3c498c]
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
  - @megasaver/stats@1.6.0
  - @megasaver/policy@2.0.0
  - @megasaver/output-filter@1.7.0
  - @megasaver/context-gate@0.8.0
  - @megasaver/content-store@1.2.0
  - @megasaver/shared@1.3.1
  - @megasaver/retrieval@1.0.4

## 1.4.0

### Minor Changes

- 4403f40: Brain Autopilot (i14): the brain grows itself, safely.

  - core: `autopilot` module — a pure `scoreCandidate` rule table plus the
    `runAutopilot` engine over the existing session extractor — and
    `autopilot-store` (policy + digest state, fail-closed). Auto-approval
    requires cross-session recurrence: a failure repeating inside a single
    session is a retry storm, not a lesson, so `ExtractedCandidate.occurrences`
    is a display-only signal and never a scoring input. The shared
    `from-session:` dedupe keyword is now a core export so every writer agrees.
  - cli: `mega brain autopilot status|on|off|run` — dry-run free, real run Pro,
    honors the enabled toggle, per-session cap with a capped-out notice — and
    `mega brain digest` (Pro): single-keystroke y/n/e/s/u/a/q triage over the
    suggested backlog, auto-approved spot-review with revoke, raw-mode teardown
    on every exit path, non-TTY and `--json` fallbacks. `runMemoryApprove` now
    admits a `suggested` target so an auto-approval can be revoked; its core
    flip is extracted as `applyApprovalFlip`.
  - entitlement: `brain-autopilot` ProFeature key.
  - mcp-bridge: the from-session tool imports the shared dedupe prefix from core
    instead of redeclaring it. Behavior unchanged.

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

- 6d40d2c: Living Brain (i1): auto-superseding memory save path with lineage recall and
  time-travel queries.

  - core: new `supersession` module — `detectSupersession` (lexical
    checkConflicts ladder + best-effort cosine overlay), the extracted
    `applySupersession` close, `buildLineage`, `changedFromFor`, and the single
    write entry point `saveMemoryWithLineage` with a born-approved close ladder.
    Optional `lastActiveAt` on the memory schema; `effectiveConfidence` decay
    rekeys to `lastActiveAt ?? updatedAt ?? createdAt` (legacy rows rank
    bit-identically). Warm-start briefs carry a `(was: … until …)` suffix.
  - connectors-shared: `ConnectorContext` gains an optional `memoryChangedFrom`
    record; its titles are sentinel-guarded, and the connector block renders a
    `(changed from …)` suffix. Closed/archival memories stop rendering in the
    connector block (validity gate).

- 8db0074: Mistake Firewall (guard): PreToolUse hook intercepts Bash/edit calls matching stored failures and warns the agent mid-mistake with the estimated original cost. Durable bounded guard corpus captured on the proxy path; three-tier pure matcher (exact / path+text / BM25); outcome feedback loop with signature overlap + auto-mute; `mega guard` CLI (status/mode/events/mute/check); `check_approach` MCP tool with a free 7-day window (also applied to `find_similar_failures`); Pro retry-cost-avoided line in roi/savings surfaces. Free warn interception + Pro strict-deny / events ledger / cumulative analytics, all under the existing `savings-analytics` entitlement key.
- 2459179: Reserve the `from-session:` idempotence-ledger keyword namespace so an agent can
  no longer suppress a legitimate autopilot / from-session capture by planting a
  forged ledger keyword (i14 gauntlet finding #5, denial-of-capture).

  - core: new `isReservedKeyword` / `stripReservedKeywords` exports; `brain import`
    strips reserved keywords from imported memories.
  - mcp-bridge: `save_memory` strips reserved keywords from agent input.
  - cli: `memory create` strips reserved keywords; `memory update` strips a forged
    add AND preserves the row's existing reserved keyword (so an edit can't drop
    the real ledger entry). Internal ledger writers (from-session, autopilot) build
    the keyword themselves and are unaffected; the shared ledger still dedupes.

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

- 5f8bbdb: Internal refactor: hoist the triplicated advisory atomic-JSON-store mechanic
  into one core-internal `json-store.ts` (`readJsonFile` + `writeJsonAtomic`),
  reused by `guard-state`, `warm-start-state`, and `autopilot-store`. Behavior is
  byte-identical — the helper owns only the filesystem plumbing; each store keeps
  its own Zod schema and fallback, so every error posture is preserved (guard/warm
  return `null`, autopilot fails closed to a `structuredClone`d default). No public
  API change. The three durable, fsync-ing, throwing atomic writers (embeddings,
  overlay, registry) are deliberately untouched — different contract.
- Updated dependencies [eb74c35]
- Updated dependencies [8db0074]
- Updated dependencies [6312ef3]
  - @megasaver/output-filter@1.6.0
  - @megasaver/stats@1.5.0
  - @megasaver/context-gate@0.7.0
  - @megasaver/content-store@1.1.4

## 1.3.0

### Minor Changes

- 64a5300: `mega brain export <project>` / `mega brain import <project> <file>` — the
  portable project brain (Mega Saver Pro). Export writes the knowledge layer
  (approved project-scoped memories, rules, failed-attempt lessons) to a
  2-line `.megabrain` bundle with a SHA-256 payload integrity hash and
  firewall redaction (findings counted in the manifest). Import verifies the
  hash, then merges everything as NEW entries with `approval: "suggested"` —
  nothing activates until `mega memory approve`; exact duplicates are skipped
  and counted. Core gains `exportBrain` / `importBrain` /
  `parseBrainBundle` / `serializeBrainBundle`.
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
- Updated dependencies [ce66902]
- Updated dependencies [815445a]
- Updated dependencies [b91c052]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/context-gate@0.6.0
  - @megasaver/output-filter@1.5.0
  - @megasaver/stats@1.4.0
  - @megasaver/shared@1.3.0
  - @megasaver/content-store@1.1.3
  - @megasaver/policy@1.2.2
  - @megasaver/retrieval@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [20977aa]
- Updated dependencies [14b2c6c]
- Updated dependencies [223fa0a]
  - @megasaver/output-filter@1.4.0
  - @megasaver/context-gate@0.5.0
  - @megasaver/stats@1.3.0
  - @megasaver/content-store@1.1.2

## 1.2.0

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

### Patch Changes

- Updated dependencies [69ce82f]
- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
- Updated dependencies [b5c6c0d]
  - @megasaver/stats@1.2.0
  - @megasaver/shared@1.2.0
  - @megasaver/context-gate@0.4.0
  - @megasaver/output-filter@1.3.0
  - @megasaver/content-store@1.1.1
  - @megasaver/policy@1.2.1
  - @megasaver/retrieval@1.0.2

## 1.1.0

### Minor Changes

- fde8e86: Add the live-first Phase 3 workspace-keyed read surface.

  - `@megasaver/shared`: `workspaceKeySchema`, `encodeWorkspaceKey(cwd)`
    (`sha256(cwd)` → 16 lowercase-hex chars), and `workspaceLabel(cwd)` —
    an fs-safe key space distinct from the lowercase-UUID `projectId`.
  - `@megasaver/indexer`: `resolveWorkspaceIndexPaths(storeDir, key)` and
    `buildWorkspaceIndex(...)` write under `index/<workspaceKey>/`, plus
    `workspaceProjectId(key)` (a deterministic UUIDv5 stamped on index
    blocks so `codeBlockSchema` parses without a schema migration).
  - `@megasaver/core`: `readWorkspaceRules` / `readWorkspaceTools` read the
    workspace-keyed overlay JSONL (`rules/<key>.jsonl`, `tools/<key>.jsonl`),
    reusing the existing rule/tool zod schemas. Read-only; no registry.

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

- 031f6de: M4 transcript→memory: deterministically distill a recorded session's failures
  into `suggested` memories for the human approval gate (claude-mem-class session
  distillation, the no-LLM variant).

  - `@megasaver/core`: new pure `extractSessionMemories(input)` derives candidate
    memories from a session's structured `FailedAttempt` rows — a test-shaped
    failure → a `test_behavior` candidate, a generic one → a `bug` candidate
    (source `test_failure`), a `DECISION:` marker → a `decision` candidate
    (source `session_summary`). Identical candidates within a session collapse by
    content hash. No model, no I/O, no clock.
  - `@megasaver/cli`: `mega memory from-session <session>` stages the candidates
    as `suggested` (never auto-approves) and prints `suggested=N skipped=M`
    (`--json` available). Idempotent — a per-candidate dedupe key carried in the
    memory's keywords means a re-run stages no duplicates.
  - `@megasaver/mcp-bridge`: `mega_memory_from_session` MCP tool with the same
    behaviour (`{ sessionId } -> { suggested, skipped }`).

  Suggested memories are not recallable until a human approves them (M3 then
  surfaces semantic duplicates at the approve gate), so a noisy extractor never
  leaks into recall. Additive; no change to the memory data model, the approval
  gate, or existing FORGE/learn behaviour.

- 391e659: Add an on-demand memory-index build so semantic memory recall goes live
  (WS3 increment 2). `embedMemoryEntries` previously had no production
  caller, so the `get_relevant_memories` coverage guard always fell back to
  BM25.

  - `@megasaver/core`: `buildMemoryIndex(storeRoot, projectId, entries,
embedFn?)` — the missing caller. Reads the prior id→hash manifest,
    runs the incremental embedder (carry-forward unchanged memories), then
    rewrites the manifest. Returns `{ embedded, carried, total }`.
  - `mega memory index <project>` — CLI command building the per-project
    vector sidecar on demand (loads the model; never on the save hot path).
  - `mega_index_memory` — MCP tool doing the same build for an agent.

  `embedFn` is injectable so the command/tool logic is tested with a
  counting fake; the real model path is E2E-gated and CI stays model-free.

- 31238a3: M5 task-scope the `memoryRelevance` signal in the context pruner. Closes the
  WS3-inc1 §1B "Known imprecision (v1, accepted)" follow-up: both context-pruning
  boundaries fed ALL approved memory's `relatedFiles` to `memoryRelevance`,
  boosting every memory-touched file on every task regardless of task relevance.

  New pure core helper `taskRelevantMemoryFiles(memories, { taskVector,
memoryVectors, topK })` ranks approved, non-stale memories by
  cosine(taskVector, memoryVector), keeps the top-K above a small floor, and returns
  the deduped union of THEIR `relatedFiles` (the narrowed counterpart of
  `approvedMemoryFiles`). Eligibility mirrors `approvedMemoryFiles` EXACTLY
  (`approval === "approved" && !stale`, no validity/tier gating) so the scoped set
  is always a task-filtered subset of the fallback — the signal never flips on
  whether a sidecar exists. A best-effort orchestrator `taskScopedMemoryFiles` loads
  the project's memory-vector sidecar, reuses the task vector the pruner already
  computes for the code-block signal (MCP) or embeds the task itself (CLI), and
  returns null on no/empty sidecar, no task vector, or any failure.

  Both boundaries (`mcp-bridge` context-pruning.ts + `cli` context/shared.ts) now
  use `taskScopedMemoryFiles(...) ?? approvedMemoryFiles(memories)`: task-scoped
  when embeddings are available, falling back to all-approved otherwise. Additive,
  best-effort (never throws), recall-safe (no-sidecar behavior is byte-identical to
  today), deterministic, CI model-free (injected vectors in tests; real `embed()`
  E2E-gated). `staleMemoryFiles` is unchanged.

- 4e8c6e8: Memory superset increment 1: semantic recall + entity graph +
  memoryRelevance wiring.

  - core: per-project memory-vector sidecar (`embedMemoryEntries`,
    `memoryEmbeddingsSidecarPath`, `memoryEmbedText`) keyed by memory id,
    incremental by content hash — opt-in, no model on import. New
    `searchMemoryEntriesSemantic` (cosine recall) alongside the BM25
    `searchMemoryEntries`. New `approvedMemoryFiles` / `staleMemoryFiles`
    helpers for the context-pruner memory signal.
  - mcp-bridge: `get_relevant_memories` boundary-embeds the task best-effort
    and semantic-ranks when a sidecar exists, gracefully falling back to BM25.
    The context tools now feed `memoryRelevance` from ALL approved memory's
    relatedFiles instead of a BM25-narrowed subset.
  - memory-graph: new `entity` node kind + `entity-mention` edge kind;
    deterministic (no-LLM) entity extraction from each memory's
    relatedSymbols / relatedFiles, enabling cross-memory entity aggregation.

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

- 900ce56: Phase 1 (DIMMEM) structured memory schema: `MemoryEntry` gains a typed
  `MemoryType` (10 categories), `title`, normalized `keywords`,
  `confidence`, `source`, `stale`, `updatedAt`, `expiresAt`, and optional
  `reason`/`goal`/`evidence`/`relatedFiles`/`relatedSymbols`. New exports
  `memoryTypeSchema`, `memoryConfidenceSchema`, `memorySourceSchema`, and
  `backfillMemoryEntry` (read-boundary upgrade of v0.1 rows — idempotent).
  The JSON-directory read path backfills legacy memory JSONL so existing
  stores keep loading. `mega memory create` and the GUI memory route emit
  the new typed shape with neutral defaults; typed `--type`/`--title`
  flags and search/update/delete/explain land in follow-up slices.
- 900ce56: Phase 1 (DIMMEM) read/write surface over the typed memory schema.

  Core: `CoreRegistry` gains `updateMemoryEntry` (mutable-in-place patch,
  bumps `updatedAt`, rejects immutable-field changes), `deleteMemoryEntry`
  (hard delete; empties remove the project's JSONL rather than leaving a
  zero-byte file), and `searchMemoryEntries` — local, offline BM25
  (`@megasaver/retrieval`) over title+content+keywords with type/
  confidence/scope filters, stale excluded by default, newest-first when
  no text. New exports: `memoryEntryUpdatePatchSchema`,
  `memorySearchQuerySchema`, `searchMemoryEntries`, `MemorySearchQuery`.

  CLI: `mega memory create` gains typed flags (`--type --title --keyword
--confidence --source --reason --goal --file --expires`, all optional
  with neutral defaults); new `mega memory search/update/delete/explain`
  (`delete` requires `--yes`; `--json` on read commands).

  MCP bridge: three new tools — `save_memory`, `search_memory`,
  `get_relevant_memories` — widening the closed tool enum to seven.

- f1fe1d3: Phase 10 (Team/Cloud — local slice): memory approval workflow.
  `MemoryEntry` gains `approval` (`suggested | approved | rejected`);
  `backfillMemoryEntry` defaults existing rows to `approved` (backward
  compat). Agent `save_memory` writes default to `suggested`, human
  `mega memory create` to `approved`. `suggested`/`rejected` memory is
  gated out of connector sync, memory search / relevant-memories /
  context packs, and the MCP `get_project_context` / `mega_recall` tools —
  only approved memory is shared with agents/teammates. New: `mega memory
approve|reject`, `--all` review, the `approve_memory` MCP tool (24 → 25),
  `buildPrMemoryComment` + `mega github pr-comment`. Team-shared memory =
  a shared `--store` path + the approval gate. Hosted cloud sync, auth,
  private deployment, org rules, hosted audit, and a web approval UI are
  explicitly deferred.
- 12c8e9e: Phase 4 — MCP Server full surface. Adds two first-class core entities
  (ProjectRule, FailedAttempt) with schemas, branded ids, JSONL storage, and
  registry CRUD, plus four MCP tools: `get_project_context`,
  `record_failed_attempt`, `save_project_rule`, `get_project_rules`. The bridge
  now exposes 15 tools. Additive only — no existing schema, store, or tool
  changes shape.
- 27960fb: Phase 5 — FORGE failed-run learning. Adds failure-similarity search,
  convert-failure-to-rule (caller-supplied insight; engine does linkage,
  evidence seeding, and the convertedToRule flip atomically), and scored
  applicable-rule retrieval. New: 2 pure ranking modules + 3 CoreRegistry
  methods (updateFailedAttempt, searchFailedAttempts, convertFailureToRule),
  3 MCP tools (convert_failure_to_rule, find_similar_failures,
  get_applicable_rules; bridge now 18 tools), and CLI (mega fail, mega rules,
  mega learn from-failure). No LLM, no embeddings — reuses rankBm25.
- f7bb136: Phase 6 — Task Engine. Adds a deterministic task state machine: TaskPlan
  with embedded typed TaskSteps (scan/retrieve_context/plan/edit/test/debug/
  document/save_memory), dependency-aware status rollup, and selective retry
  (reset only the failed step + its transitive dependents, never the whole
  plan). The engine is a state tracker, not an executor — the calling agent
  runs each step and reports the outcome. New: branded TaskPlanId/TaskStepId,
  1 pure transition module, 5 CoreRegistry methods (createTaskPlan, getTaskPlan,
  listTaskPlans, recordTaskStep, retryTaskStep), 6 error codes, 4 MCP tools
  (build_task_plan, get_task_status, record_task_step, retry_failed_step;
  bridge now 22 tools), and CLI (mega task plan/status/step/retry/explain).
  Phase 5 (FailedAttempt) and Phase 1 (MemoryEntry) reuse is opt-in. No LLM,
  no embeddings.
- ed46198: Phase 7 — Tool Router. Adds a deterministic, per-project tool router. New
  first-class ToolDefinition entity (name/description, category enum
  [filesystem/search/git/test/package/database/deploy/browser/dangerous],
  risk enum [safe/medium/dangerous], normalized keywords, opaque
  z.unknown() inputSchema/outputSchema — descriptive only, never executed),
  stored as per-project JSONL. New pure routeToolsForTask(tools, query)
  reusing rankBm25: a security gate runs BEFORE relevance — a tool is
  blocked (never routed to a plain task) when risk=dangerous OR category in
  {dangerous, deploy, database}; among the rest, score>0 tools are allowed
  (descending score, id tiebreak), irrelevant tools are omitted. Returns
  { allowedTools, blockedTools, reason }. New branded ToolDefinitionId,
  4 CoreRegistry methods (createToolDefinition, getToolDefinition,
  listToolDefinitions, routeToolsForTask), 2 error codes
  (tool_definition_already_exists, tool_definition_not_found), 1 MCP tool
  route_tools_for_task (bridge now 23 tools), and CLI mega tools
  add/list/route/explain. Registration is CLI-only; the router only advises
  (no execution, no enforcement at a call site). No LLM, no embeddings.
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
- f46ce66: Reliable save: approve_memory now runs a deterministic validator (schema,
  evidence-for-non-human, safe related files, bounded content, advisory
  heuristics) plus a conflict checker (duplicate/supersession/contradiction)
  before flipping a suggested memory to approved. Hard failures and conflicts
  leave the row suggested with reasons; an exact duplicate of an approved memory
  is rejected (never a second approved row); nothing auto-approves. Adds a
  regression test locking that agent-facing retrieval returns approved-only memory.

  Plan 3b (evidence-ports): the secret gate is now ACTIVE. approve_memory resolves
  evidenceIds to real EvidenceRecord objects via @megasaver/evidence-ledger; it
  rejects approval when any referenced evidence has unresolvedHighRisk (unresolved
  secret finding), is revoked/tombstoned, or belongs to a different canonical
  workspace (cross-workspace leak prevention, spec §6). The unresolvedSecret input
  to validateSave is derived from the real redactionReport, not a false default.

- 4fe5749: runOutputPipeline now records a TokenSaverEvent per file read
  (RunOutputResult widens with store_write_failed), core re-exports the
  stats read/append surface, and `mega session saver stats` reads the
  real stats store (text totals + eventStats in --json; BB6 stub retired).

### Patch Changes

- 0a3256b: Fix three bugs surfaced by a full feature-test pass.

  - `rules apply --files` now matches `appliesTo` glob patterns. Matching
    used a plain `startsWith` prefix check, so globs like `*.ts` /
    `**/*.ts` never matched any path — the `--files` filter silently
    returned nothing. It now compiles globs through the policy
    `compileGlob` engine (newly exported from `@megasaver/policy`) while
    keeping the literal directory-prefix behaviour (`src/db/`).
  - `mega output file|filter|exec` now surface the secret-redaction
    warning (`redacted N secret(s) before processing`) in text mode. The
    warning was produced and stored in the result but only visible via
    `--json`, hiding a security-relevant signal from CLI users.
  - `mega index show <project> <bad-id>` now reports
    `invalid block id "<value>"` for a malformed block id instead of the
    misleading `name must be non-empty`.

- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [7fcd881]
- Updated dependencies [66ac31e]
- Updated dependencies [62b3c65]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [09912d9]
- Updated dependencies [0a3256b]
- Updated dependencies [7c916db]
- Updated dependencies [da9d3a7]
- Updated dependencies [42207dd]
- Updated dependencies [b2e39cd]
- Updated dependencies [da6e687]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [97ccb98]
- Updated dependencies [aa42dbd]
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
- Updated dependencies [3e678e3]
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
  - @megasaver/embeddings@0.2.0
  - @megasaver/policy@1.2.0
  - @megasaver/retrieval@1.0.1

## 1.0.2

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [bb3d179]
- Updated dependencies [bb3d179]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0
  - @megasaver/context-gate@0.2.0
  - @megasaver/policy@1.1.0
  - @megasaver/content-store@1.0.1
  - @megasaver/stats@1.0.1

## 1.0.1

### Patch Changes

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
- Updated dependencies [a2526d3]
  - @megasaver/context-gate@0.1.0

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

- 084123d: Extract the context-gate output orchestrator into `@megasaver/core`. The
  redact/gate/read/filter/persist pipeline and chunk lookup now live in
  `packages/core/src/context-gate/` behind the `context-gate.ts` barrel,
  exposing `runOutputPipeline`, `fetchChunk`, and `locateChunkSet` plus the
  supporting helpers. The `mega output {file,filter,chunk}` CLI commands
  become thin adapters that call the core orchestrator instead of owning the
  pipeline locally; behavior is preserved. This gives BB8 a single
  package the MCP bridge can import (§2a/§8d). A dependency-direction test
  enforces the §3c cycle guard: core depends only on shared, policy,
  output-filter, and content-store, and never on mcp-bridge or apps.
- 751df6c: Add `mega output exec` — the first user-visible child-process spawn in
  Mega Saver. A new core orchestrator `runOutputExecCommand`
  (`packages/core/src/context-gate/run-command.ts`, re-exported from the
  `context-gate.ts` barrel) spawns a policy-gated child process and runs
  its combined stdout+stderr through the redact -> filter -> store ->
  stats pipeline; the `mega output exec` CLI command is a thin adapter
  that calls it, and BB8's MCP `mega_run_command` will reuse the same
  entry point.

  Security invariants enforced and tested: `policy.evaluateCommand` runs
  BEFORE spawn (deny-before-spawn, with a spawn-never-called assertion on
  every denial branch — `command_not_allowed`, `dangerous_pattern`,
  `recursive_megasaver`); `MEGASAVER_ORIGIN_PID` is set on the spawned
  child env and checked on entry so a descendant re-entering Mega Saver is
  denied `recursive_megasaver`; redaction runs before persistence (the
  raw unredacted output is never stored). The child's exit code is
  mirrored on a clean run; `--timeout`/`--max-bytes` bounds (defaults 300s
  / 20MB) force-terminate but still persist the partial output as exit 1.

  `@megasaver/core` now depends on `@megasaver/stats` for the stats step;
  this is acyclic (stats never imports core) and the dependency-direction
  allow-list is widened accordingly. `@megasaver/cli` gains no direct
  stats dependency — it consumes the orchestrator through
  `@megasaver/core` only.

- 522fad4: Add `initStore(rootDir)` — idempotent helper that creates the JSON
  directory store layout (`projects.json`, `sessions.json`) without
  overwriting existing files. Used by `@megasaver/cli` for first-run
  auto-init.
- 367d325: feat: add session CRUD CLI commands and core endSession method

  `@megasaver/core` gains `CoreRegistry.endSession(id, { endedAt })`
  on both registry implementations and a new `session_already_ended`
  error code. `@megasaver/cli` gains four `mega session` subcommands
  (`create`, `list`, `show`, `end`) plus the supporting CLI error
  helpers.

- a0f0c94: Initial release of `@megasaver/core` with neutral `Project`, `Session`, and `MemoryEntry` schemas plus `createInMemoryCoreRegistry()`.
- 256eb34: Add JSON directory-backed CoreRegistry persistence.
- 04987a8: Add `mega session update <sessionId> [--title …] [--risk …] [--agent …]`
  for partial mutation of an open session. Empty `--title ""` clears
  to `null`; ended sessions are rejected (`session_already_ended`);
  `mega session update <id>` with no flags emits `error: nothing to
update`. `@megasaver/core` exports `sessionUpdatePatchSchema` and a
  new `CoreRegistry.updateSession(id, patch)` method on both the
  in-memory and JSON-directory implementations. `apps/cli`'s
  `commands/session.ts` is split into a `commands/session/`
  directory closing v0.1 backlog item I5.

### Patch Changes

- d0003b5: Two cohesive correctness fixes:

  - M3: stale-lock detection. `withDirLock` writes the holding PID
    into `.projects.lock` and uses `process.kill(pid, 0)` to detect
    dead holders. Crashed-process recovery now happens immediately
    rather than waiting the full 5s acquire timeout.
  - M4: Unicode NFC normalization. `Project.name` and `Session.title`
    Zod schemas now normalize to NFC at parse time. NFD inputs are
    observably equal to their NFC equivalents post-parse. Migration
    is lazy: existing on-disk NFD entries are returned as NFC on
    read; subsequent writes persist NFC.

  Public API output type is unchanged (`string` stays `string`),
  but a literal NFD input no longer round-trips byte-equal — it
  becomes its NFC equivalent. Callers comparing literal byte-strings
  against parser output should normalize their fixtures to NFC.

- Updated dependencies [93840ac]
- Updated dependencies [61efb28]
- Updated dependencies [a8b6531]
- Updated dependencies [ae41534]
- Updated dependencies [6078dc9]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/policy@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/output-filter@1.0.0
  - @megasaver/stats@1.0.0
