# @megasaver/core

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
