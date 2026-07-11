# @megasaver/mcp-bridge

## 1.2.2

### Patch Changes

- Updated dependencies [64a5300]
- Updated dependencies [815445a]
- Updated dependencies [b91c052]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/core@1.3.0
  - @megasaver/output-filter@1.5.0
  - @megasaver/daemon@0.1.3
  - @megasaver/shared@1.3.0
  - @megasaver/content-store@1.1.3
  - @megasaver/context-pruner@0.2.2
  - @megasaver/evidence-ledger@0.2.2
  - @megasaver/indexer@0.2.2
  - @megasaver/policy@1.2.2
  - @megasaver/retrieval@1.0.3

## 1.2.1

### Patch Changes

- Updated dependencies [20977aa]
  - @megasaver/output-filter@1.4.0
  - @megasaver/content-store@1.1.2
  - @megasaver/core@1.2.1
  - @megasaver/daemon@0.1.2

## 1.2.0

### Minor Changes

- 326ed5a: Edit impact: surface the blast radius of an edit — impacted callers and the
  tests to run — directly to connected agents, without manual dependency lookup.

  - `@megasaver/mcp-bridge`: new `get_edit_impact` MCP tool. Seeds from
    `changedFiles` (or `git diff --name-only HEAD`, degrading gracefully to an
    empty set on non-git roots), merges per-seed impact packs deduped by block
    id, and returns the impacted callers plus `suggestedTests` — the test-typed
    blocks inside the merged radius.
  - `@megasaver/connectors-shared`: the context-gate block now instructs the
    agent to call `get_edit_impact({ projectId })` after editing files so
    impacted callers and suggested tests surface automatically.

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

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
  - @megasaver/core@1.2.0
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0
  - @megasaver/daemon@0.1.1
  - @megasaver/content-store@1.1.1
  - @megasaver/context-pruner@0.2.1
  - @megasaver/evidence-ledger@0.2.1
  - @megasaver/indexer@0.2.1
  - @megasaver/policy@1.2.1
  - @megasaver/retrieval@1.0.2

## 1.1.0

### Minor Changes

- f62f88f: M3 semantic canonicalization on approve: after the existing exact-duplicate
  hard-reject and validation/conflict gate, the approve gate runs a best-effort
  semantic pass that cosine-compares the approved candidate's embedding to the
  memory-vector sidecar of the other approved+current memories. A near-duplicate
  (cosine >= 0.95) is SURFACED — a `semantic-duplicate` reason plus the matched
  id in the validation sidecar's `conflictIds` — never auto-blocked and never
  auto-mutated; the human canonicalizes by re-approving with `supersedesId` (M1).
  Graceful: no sidecar / no candidate vector / embed failure leaves approval and
  the exact-dup behaviour byte-identical and never throws. `ApproveMemoryEnv`
  gains an optional injectable `embedFn` (defaults to the real `embed`).
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

- b1978fa: feat: outline-first read mode

  `mega_read_file` accepts `outline: true`: for a supported source file it
  returns the file skeleton (imports + top-level signatures + line ranges +
  chunk ids) and persists every body as a fetchable chunk, so an agent expands
  only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
  falls back to a normal read for non-source / unsupported / unparseable files.

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
- a0e05f7: Phase 3 (Context Pruning / LAMR): new `@megasaver/context-pruner`
  package — task-aware selection that scores the Phase 2 `CodeBlock` index
  with an 8-factor model (semantic BM25, userMention, testFailure,
  recentEdit, memory, dependency; stale/noise penalties), selects a
  6–8-block context pack under a token budget with dependency closure
  (never silently dropping a named/failing-test block), and emits per-block
  reasons + a savings audit. CLI gains `mega context
build/explain/audit/export`; the MCP bridge gains `get_relevant_context`,
  `get_relevant_code_blocks`, `explain_context_selection`, and
  `get_context_budget_report`. Memory relevance is passed in as data
  (no `@megasaver/core` edge); leaf package depends only on indexer +
  retrieval + shared.
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
- 39e5eb6: Add the `proxy_search_code` MCP tool (Proxy Mode v1.2, Deliverable 5).

  Task-aware code search backed by policy-gated `grep` over the live filesystem.
  Live grep results are the source of truth: matches are grouped by file, the raw
  output is stored in the content-store for expansion (`chunkSetId`), and token
  savings metrics are returned. Best-effort BM25 enrichment may reorder the
  grouped files (`index_enrichment: "applied"`) but never adds or removes live
  matches; when enrichment cannot run it reports `"unavailable"` and the live
  grep order is kept. The tool is a new proxy-only name with no `mega_*` twin and
  is exposed in both proxy and legacy naming modes.

- 39e5eb6: Proxy Mode v1.2 tool naming mode. `MEGASAVER_TOOL_NAMING=proxy|legacy`
  (default proxy) controls the MCP `tools/list` surface: proxy mode
  exposes `proxy_read_file` / `proxy_run_command` / `proxy_expand_chunk`,
  legacy mode keeps the `mega_*` names — never both at once, so no
  duplicate tool schemas. Both modes dispatch to the same
  implementation. `mega_recall` is unchanged. The Context Gate connector
  block now emits the proxy default names.
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

- 3290664: Add reverse call-graph blast-radius selection (`buildImpactPack` /
  `selectImpact`) and expose it as the `mega_impact` MCP tool. Given an edited
  symbol, the reverse BFS over `calledBy` returns the symbol plus every
  transitive caller affected by changing it, under the existing context-pruner
  token budget + reasons machinery. The closure is exhaustive within budget — a
  caller cut by budget is reported in `excluded`, never silently dropped — and an
  unknown symbol yields an empty pack. Tool-resident, so it works over MCP on
  Claude Desktop.
- 14868ee: WS1 hybrid BM25 + embeddings retrieval, additive over BM25 with graceful
  BM25-only fallback when vectors/model are absent.

  - indexer: `buildIndex`/`buildWorkspaceIndex` gain an opt-in `embeddings?`
    flag (default false) and now return `Promise<BuildResult>`; when true they
    write an `embeddings.jsonl` sidecar next to `blocks.jsonl`, carrying
    unchanged-block vectors forward via the incremental contentHash skip.
    `searchBlocks` accepts optional pre-computed `{ taskVector, blockVectors }`
    and cosine-reranks the BM25 hits when present.
  - context-pruner: `scoreBlocks` stays synchronous and gains an
    `embeddingRelevance` factor consuming pre-computed `taskVector` /
    `blockVectors` (0 when absent); new `embedding` weight; the factor is added
    to `scoreFactorsSchema`.
  - mcp-bridge: the context-pruning tool best-effort loads the sidecar and
    embeds the task at the boundary, passing vectors into the pack; its handlers
    are now async. Default builds download no model — the embed path is opt-in
    and gated.

### Patch Changes

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

- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [7fcd881]
- Updated dependencies [a3306ec]
- Updated dependencies [66ac31e]
- Updated dependencies [5250357]
- Updated dependencies [f10c761]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [09912d9]
- Updated dependencies [9fc766e]
- Updated dependencies [0a3256b]
- Updated dependencies [da9d3a7]
- Updated dependencies [42207dd]
- Updated dependencies [b2e39cd]
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
- Updated dependencies [900ce56]
- Updated dependencies [900ce56]
- Updated dependencies [f1fe1d3]
- Updated dependencies [f7cbc28]
- Updated dependencies [a0e05f7]
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
- Updated dependencies [f46ce66]
- Updated dependencies [3290664]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [14868ee]
- Updated dependencies [4fe5749]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0
  - @megasaver/content-store@1.1.0
  - @megasaver/indexer@0.2.0
  - @megasaver/context-pruner@0.2.0
  - @megasaver/daemon@0.1.0
  - @megasaver/embeddings@0.2.0
  - @megasaver/evidence-ledger@0.2.0
  - @megasaver/policy@1.2.0
  - @megasaver/core@1.1.0
  - @megasaver/retrieval@1.0.1

## 1.0.2

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [bb3d179]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0
  - @megasaver/policy@1.1.0
  - @megasaver/content-store@1.0.1
  - @megasaver/core@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [a2526d3]
  - @megasaver/core@1.0.1

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

- 0c30651: Ship the final AA1 epic surface (BB11): GUI AgentSetupDoctor + connector
  CONTEXT_GATE block.

  `@megasaver/connectors-shared` gains `renderContextGateBlock` (rendered only
  when `session.tokenSaver?.enabled === true`) plus the `MEGA SAVER:CONTEXT_GATE`
  sentinel constants. `parseBlock(content, sentinels?)` is now parameterised by
  sentinel pair (defaulting to the legacy pair, so every existing caller is
  byte-unaffected) and `upsertBlock` manages the legacy + CONTEXT_GATE blocks in
  one pass.

  `@megasaver/mcp-bridge` hoists `DEFAULT_MCP_COMMAND` / `DEFAULT_MCP_ARGS`
  (`mega` + `["mcp","serve"]`) and threads an optional `args` through
  `buildMcpSetupOps` so the written MCP config is a runnable launch command.

  `@megasaver/gui` adds the Agent setup view (`agent-setup-doctor` +
  `agent-setup-row`), four zod-validated bridge routes under `/api/mcp/*`
  (status/install/repair/uninstall) consuming BB8's `McpSetupOps`, the
  `mcp_setup_failed` bridge error code, api-client methods, and the
  `agent-setup` nav tab. The GUI bridge now writes a runnable `mega mcp serve`
  launch command on install.

  `@megasaver/cli` connector-sync now seeds a brand-new agent file via
  `upsertBlock` (so it also receives the CONTEXT_GATE block when the session has
  Mega Saver Mode enabled); output stays byte-identical for tokenSaver-off
  sessions.

- 0e9be7a: BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
  mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
  widened to 16 members, McpToolName closed enum, the
  `mega mcp install/repair/serve/status/uninstall` CLI, and the
  `McpSetupOps` facade (with `aggregateMcpStatus` reporting
  `mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
  per agent) wired into the GUI bridge as the production `mcpOps`.
  Replaces the v0.3 not_implemented placeholder. createBridge API
  preserved (AA1 §2c).

  `mega mcp serve` is the long-running stdio launch entry an agent
  spawns to reach the bridge: it resolves the store + a
  JsonDirectoryCoreRegistry (as `mega output exec` does), starts the
  bridge over stdio, and shuts down cleanly on stdin-EOF / SIGINT /
  SIGTERM. To make the installed config runnable, `installMcp` now
  writes `{ command, args }` (idempotency compares both) and
  `mega mcp install`/`repair` default to `command: "mega"`,
  `args: ["mcp", "serve"]` instead of the unlaunchable `"mega-mcp"`
  literal (gap found by the AA1 §16 live smoke).

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [61efb28]
- Updated dependencies [a8b6531]
- Updated dependencies [ae41534]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/policy@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/output-filter@1.0.0
  - @megasaver/core@1.0.0
