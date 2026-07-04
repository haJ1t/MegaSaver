---
title: ContextOps Roadmap — Phases 0–10 (reconciled)
tags: [roadmap, strategy, dimmem, lamr, forge]
sources:
  - sources/roadmap-phases-v2.md
  - syntheses/post-v1.1-roadmap.md
  - syntheses/mega-saver-product.md
  - decisions/bootstrap-matrix.md
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
  - docs/superpowers/plans/2026-06-12-phase10-team-cloud.md
status: complete
created: 2026-06-11
updated: 2026-06-12
---

# ContextOps Roadmap — Phases 0–10 (reconciled)

The strategic product roadmap for Mega Saver as an **AI Coding Agent
Memory & Context Operating Layer**, reconciled against the shipped
v1.1.0 codebase as of main commit `0db235b` (this roadmap itself lives
on branch `docs/contextops-roadmap-phases`). Source: the Phase 0–10 roadmap
ingested at [[sources/roadmap-phases-v2]] (Desktop
`MegaSaver_Roadmap.txt`, 2026-06-11).

**Phase-count reconciliation (11 vs 10):** [[sources/roadmap-phases-v2]]
describes an **11-phase arc** because it counts **Phase 0 (Foundation)** as a
phase (Phase 0 → Phase 10 inclusive = 11). This synthesis counts the **ten
numbered delivery phases (1–10)**; Phase 0 is pre-existing foundation
groundwork, not a numbered feature delivery. Same arc, different base. The one
genuinely **future / out-of-scope** slice is the **Team/Cloud SaaS** portion of
Phase 10 (hosted sync, auth service, org rules, web approval UI): only the
local-deterministic approval slice shipped; all cloud SaaS items are explicitly
deferred (see Phase 10 detail below).

**All ten phases are now shipped on `main`** (PRs #114–#123,
2026-06-12). The table below shows two columns: the **shipped** status
(every phase `done`) and the original **pre-build audit** status — the
`partial` / `gap` framing from a 22-agent code audit (map + adversarial
verify, 2026-06-11), kept for the historical record. That audit framed
each phase against the *new roadmap vision*, not the locked v0.1/v1.0
specs; the per-phase "Reconciliation" prose below preserves the
"done-against-old-spec but gap-against-vision" distinction that drove
the build order.

## Positioning

> Mega Saver is a self-improving context layer for AI coding agents.
> It remembers project decisions, prunes irrelevant code, learns from
> failed runs, and gives agents only the context and tools they need.

This is the same ContextOps thesis as [[concepts/contextops]], now
extended with three borrowed patterns:

- **DIMMEM** — structured, typed engineering memory (Phase 1).
  See [[concepts/structured-memory-engine]].
- **LAMR** — task-aware context pruning (Phase 3).
  See [[concepts/context-pruning-engine]].
- **FORGE** — failed-run → reusable-rule learning (Phase 5).

## Reconciled phase status

| Phase | Title | Shipped | PR | Pre-build audit status | Concept |
|-------|-------|---------|----|------------------------|---------|
| 0 | Foundation | done | — | partial (`mega init`, SQLite deferred-by-design) | — |
| 1 | Structured Memory (DIMMEM) | done | #114 | partial | [[concepts/structured-memory-engine]] |
| 2 | Semantic Repo Index | done | #115 | gap | [[concepts/semantic-repo-index]] |
| 3 | Context Pruning (LAMR) | done | #116 | partial | [[concepts/context-pruning-engine]] |
| 4 | MCP Server | done | #117 | partial | — (see [[entities/mcp-bridge]]) |
| 5 | Failed Run Learning (FORGE) | done | #118 | gap | [[concepts/failed-run-learning]] |
| 6 | Task Decomposition | done | #119 | gap | [[concepts/task-engine]] |
| 7 | Tool Router | done | #120 | gap | [[concepts/tool-router]] |
| 8 | Audit Dashboard | done | #121 | partial | [[concepts/audit-dashboard]] |
| 9 | Multi-Agent Connectors | done (vscode/jetbrains deferred) | #122 | done | — (see [[entities/connectors-generic-cli]]) |
| 10 | Team/Cloud | done (local slice; cloud SaaS deferred) | #123 | — | [[concepts/structured-memory-engine#approval-gate]] |

**Roadmap complete through all 10 phases** (2026-06-12). Phase 10 shipped the
local-deterministic slice: memory approval workflow + team-shared store pattern.
Cloud SaaS items are explicitly deferred (see Phase 10 detail below).

## Phase detail

### Phase 0 — Foundation · done (was partial)
Done: pnpm monorepo (15 buildable units), JSON store
(`JsonDirectoryCoreRegistry`, fsync-durable, Windows-safe), `mega
doctor`, `mega project create/list`. Gap: `mega init` (deferred
per `2026-05-06-cli-project-crud-design.md` §11) and the SQLite
backend (deferred per `2026-05-05-core-persistence-design.md` §4).
Both are intentional backlog, not bugs. See [[entities/core]],
[[entities/cli]].

### Phase 1 — Structured Memory Engine (DIMMEM) · done (was partial)
Done-against-v0.1-spec: `MemoryEntry` (id, projectId, sessionId,
scope, content, createdAt), append-only CRUD, `mega memory
create/list/show`, `mega_recall` MCP retrieval. The v0.1 spec
(`2026-05-09-memory-entry-cli-design.md` §2) explicitly deferred the
rich schema — so the verifier marks it "done" against that spec. But
the **roadmap vision** wants typed engineering memory: a 10-member
`MemoryType` union, `confidence`/`source`/`keywords`/`relatedFiles`/
`stale`/`expiresAt`, plus `search`/`delete`/`update`/`explain` CLI and
`save_memory`/`search_memory`/`get_relevant_memories` MCP tools. None
of that exists → **partial** against the vision. This is the #1
priority and the first full spec+plan
(`docs/superpowers/specs/2026-06-11-phase1-structured-memory-engine-design.md`).
Concept: [[concepts/structured-memory-engine]]. See [[entities/core]].

### Phase 2 — Semantic Repo Index · done (was gap)
No code-block / AST indexing exists. Primitives available:
`@megasaver/retrieval` (BM25 ranking, `deriveIntent`) and
`@megasaver/content-store` (ChunkSet persistence). Net-new:
`CodeBlock` schema (function/class/component/route/test/config/
schema/docs), AST extraction (TS/JS/Markdown/JSON), `mega scan`,
`mega index build/status/search/show`. Priority #2; full spec+plan at
`docs/superpowers/specs/2026-06-11-phase2-semantic-repo-index-design.md`.
Concept: [[concepts/semantic-repo-index]]. See [[entities/retrieval]],
[[entities/content-store]].

### Phase 3 — Context Pruning (LAMR) · done (was partial)
Done: the [[concepts/context-gate-pipeline]] (redact→chunk→rank→fit→
summarize) in `@megasaver/output-filter` (9 rank features) +
`@megasaver/context-gate` orchestrator + BM25. But it is
**output-centric** (compresses one tool's stdout), not **task-aware
repo pruning**. Net-new: the LAMR scoring model (semanticRelevance +
dependencyRelevance + testFailureRelevance + recentEditRelevance +
memoryRelevance + userMentionRelevance − stalePenalty − noisePenalty),
`mega context build --task / explain / audit / export`, and structured
6–8-block output with per-block reasons. Priority #3; depends on
Phase 2 (needs CodeBlocks to score). Full spec+plan at
`docs/superpowers/specs/2026-06-11-phase3-context-pruning-lamr-design.md`.
Concept: [[concepts/context-pruning-engine]]. See [[entities/output-filter]],
[[entities/context-gate]].

### Phase 4 — MCP Server · done (was partial)
Done: real stdio bridge, 16-code error taxonomy, 4 locked tools
(`mega_fetch_chunk`, `mega_read_file`, `mega_recall`,
`mega_run_command`), `mega mcp serve/install/repair/status/uninstall`.
The 4-tool surface is locked by AA1 (`2026-05-10-aa1-context-gate-epic.md`
§8a) — verifier calls it "done" there. The roadmap's wider surface
(`get_project_context`, `search_memory`, `save_memory`,
`get_relevant_memories`, `get_relevant_code_blocks`,
`record_failed_attempt`, `save_project_rule`, `get_project_rules`)
rides on Phases 1/2/5 and was **gap**. Sequence: ship the engines
first, then expose them as MCP tools. **Shipped** (PR #117): the full
roadmap surface landed incrementally across Phases 4–10, growing the
closed `McpToolName` enum from 4 → **25** tools (Phase 4 took it 11 →
15; 5 → 18; 6 → 22; 7 → 23; 8 → 24; 10 → 25). See [[entities/mcp-bridge]].

### Phase 5 — Failed Run Learning (FORGE) · done (was gap)
Nothing exists. Primitives: `@megasaver/policy` (command/path gating),
core error taxonomy, `@megasaver/stats`. Net-new: `FailedAttempt` and
`ProjectRule` schemas, `mega fail record`, `mega learn from-failure`,
`mega rules list/add/apply`, failure-similarity search, and warning
injection into the context pack. Self-improving differentiator;
depends on Phase 1 (rules are a `MemoryType`) and Phase 3 (warnings go
in the pack). Risk: HIGH (new failure data model, stores error
output → privacy). **Shipped** (PR #118): Phase 4 added the
`FailedAttempt` / `ProjectRule` entities + CRUD; Phase 5 added the
learning loop — `find_similar_failures`, `convert_failure_to_rule`,
`get_applicable_rules` (tools 15 → 18), `mega fail`, `mega rules`,
`mega learn from-failure`. All ranking is `rankBm25` + path overlap;
**no LLM, no embeddings** — the calling agent authors rule prose.
Concept: [[concepts/failed-run-learning]]. See [[entities/policy]],
[[entities/core]].

### Phase 6 — Task Decomposition · done (was gap)
Nothing exists. Net-new: `TaskPlan`/`TaskStep` schemas (step types
scan/retrieve_context/plan/edit/test/debug/document/save_memory,
`dependsOn`), `mega task plan/run/status/retry/explain`, a step
executor, dependency resolver, and the key behavior — **retry only
the failed step + its debug step, not the whole workflow**. Depends on
Phases 1–3 (steps call memory/index/context) and 5 (failed steps
become `FailedAttempt`s). **Shipped** (PR #119): a deterministic
`TaskPlan` state machine in core — typed `TaskStep`s with `dependsOn`,
lifecycle `pending → running → completed | failed` rolled up to plan
status, and **selective retry** (reset only the failed step + its
dependents). 4 MCP tools (18 → 22), `mega task plan/status/step/retry/
explain`. **No executor** — the engine tracks state; the agent runs the
steps. Concept: [[concepts/task-engine]]. See [[entities/core]].

### Phase 7 — Tool Router · done (was gap)
Nothing exists. Primitives: `@megasaver/policy` (dangerous-pattern
deny), `RiskLevel` enum, skill-pack capabilities. Net-new:
`ToolDefinition` schema (category + risk), `mega tools
index/list/route/explain`, and `route_tools_for_task(task)` returning
`{allowedTools, blockedTools, reason}`. Dual win: fewer tool schemas
in context (tokens) + dangerous tools blocked (safety). **Shipped**
(PR #120): a `ToolDefinition` entity (category + risk + keywords),
`routeToolsForTask` (`rankBm25`-ranked allow-list; dangerous/deploy/
database tools blocked unconditionally), 1 MCP tool (22 → 23), `mega
tools add/list/route/explain`. **Advisor, not enforcer** — Core never
invokes a tool. Concept: [[concepts/tool-router]]. See [[entities/core]],
[[entities/policy]].

### Phase 8 — Audit Dashboard · done (was partial)
Done: `@megasaver/stats` (TokenSaverEvent byte metrics:
rawBytes/returnedBytes/bytesSaved/savingRatio, secrets redacted, chunks
stored), `mega session saver stats`, GUI `TokenSaverStats`. The
verifier marks the *Audit Dashboard* itself a gap — the shipped stats
are token-byte only. Net-new metrics: filesConsidered/Included/
Excluded, blocksConsidered/Included/Excluded, repeatedFailuresAvoided,
rulesApplied, memoriesRetrieved, toolSchemasReduced, retryCostSaved;
plus `mega audit / audit last / session / export / report` and a
dashboard view. This is the "prove the savings" surface — depends on
Phases 1/2/3/5/7 emitting their counts. **Shipped** (PR #121): extends
`@megasaver/stats` with an additive `AuditEvent` family (sibling
`*.audit.jsonl` log), a pure `summarizeAudit` (window `session | week |
all`), a store reader, 4 core re-exports, 1 MCP tool (23 → 24), and the
`mega audit report/last/session/export` group. The existing
`TokenSaverEvent` byte-log is untouched. Concept:
[[concepts/audit-dashboard]]. See [[entities/stats]], [[entities/gui]].

### Phase 9 — Multi-Agent Connectors · done (vscode/jetbrains deferred)
Done (Phase 9, branch `feat/phase9-connectors`, 2026-06-12): three new
flat-file targets `geminiTarget` (`GEMINI.md`), `windsurfTarget`
(`.windsurfrules`), `continueTarget` (`.continue/rules/megasaver.md`)
shipped in `@megasaver/connector-generic-cli` (`builtinTargets` 3→6);
`agentIdSchema` widened 5→8; CLI `KNOWN_TARGETS` now 7 entries;
`mega connector list` (known targets + present/absent, exit 0) and
`mega connector doctor` (exists/writable/in-sync diagnostic, 6 status
words, exit 1 on stale/not-writable/error) added. Cross-agent shared
memory proven by integration test (project memory lands byte-identically
in CLAUDE.md + GEMINI.md). GUI bridge/badges/session-forms updated.
Deferred: `vscode`/`jetbrains` (native IDE plugins), `mega connect`
alias. The four shipped targets (`claude-code`/`codex`/`cursor`/`aider`)
are byte-identical.
See [[entities/connectors-generic-cli]], [[entities/connectors-claude-code]],
[[entities/cli]].

### Phase 10 — Team/Cloud · done (local slice; cloud SaaS deferred)

**Shipped (branch `feat/phase10-team-cloud`, 2026-06-12):**

`MemoryEntry.approval` — closed enum `suggested | approved | rejected` (default
`approved`). `backfillMemoryEntry` adds an independent approval-defaulting branch
(all Phase 1–9 rows → `approved` on first read; backward compat, no migration
script). Agent `save_memory` defaults to `suggested`; human `mega memory create`
defaults to `approved`.

**Approval gate (total — no leak points):**

- Gate point 1: `searchMemoryEntries` gains `includeUnapproved: boolean` (default
  `false`). Single chokepoint for `search_memory` / `get_relevant_memories` /
  context pack (`loadPack`).
- Gate point 2 — four explicit `approval === "approved"` filters on list-consumers:
  `filterMemoryEntriesForSession` (CLI connector sync), GUI mirror
  `connector-context.ts`, `get_project_context` (`keyMemories`), `mega_recall`.

**New surfaces:**
- `mega memory approve|reject` (CLI) — idempotent; `updateMemoryEntry` reuse.
- `mega memory search --all` — `includeUnapproved: true` opt-in for human review.
- `mega memory list` / `explain` — `approval` column added.
- `approve_memory` MCP tool — 25th tool (added first; `approval` defaults
  `"approved"`). `McpToolName` 24 → 25 members, pins updated.
- `buildPrMemoryComment` — pure Markdown builder in `@megasaver/core`; unit-tested.
- `mega github pr-comment` — print-only core; optional off-by-default `gh` wrapper.

**Team = shared store + approval gate.** Multiple agents share one
`--store` path; only approved memory reaches agents' config files.

**Explicitly deferred (cloud SaaS — no infra built):**
hosted sync, auth service, private deployment, org-level rules, hosted
audit service, web approval UI, `visibility` field. Spec §8, plan §SCOPE.

Spec: `docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md`
Plan: `docs/superpowers/plans/2026-06-12-phase10-team-cloud.md`
See [[entities/core]], [[entities/mcp-bridge]], [[entities/cli]].

## Build order (followed, now complete)

The roadmap's stated order (1 Memory → 2 Index → 3 Pruning → 4 MCP →
5 FORGE → 6 Task → 7 Router → 8 Audit → 9 Connectors → 10 Team) held
after reconciliation and was the order the phases shipped in (PRs
#114–#123). The dependency notes that drove it:

1. **Phase 1 (DIMMEM)** — unblocks 4, 5, 6, 8. Started here.
2. **Phase 2 (Repo Index)** — unblocks 3, 4, 8.
3. **Phase 3 (LAMR)** — needs 2; unblocks 6, 8.
4. **Phase 4 (MCP tools)** — thin layer once 1/2 land.
5. **Phase 5 (FORGE)** — needs 1; unblocks 6, 8.
6. **Phase 6 (Task)** — needs 1/2/3/5.
7. **Phase 7 (Router)** — independent; can slot anytime after 4.
8. **Phase 8 (Audit)** — needs 1/2/3/5/7 to emit counts; do last of MVP.
9. **Phase 9 (Connectors)** — independent; incremental.
10. **Phase 10 (Team/Cloud)** — after local product proven.

**MVP demo loop** (Phases 1–4 + basic 8): "fix the login bug" → search
memory → scan blocks → build compact context → save fix as memory →
show token saving. All ten phases now ship on `main`.

## Planning artifacts

Every phase shipped through the [[concepts/superpowers-discipline]]
chain with its own spec + plan under `docs/superpowers/`:

- Phase 1: `…/specs/2026-06-11-phase1-structured-memory-engine-design.md`
- Phase 2: `…/specs/2026-06-11-phase2-semantic-repo-index-design.md`
- Phase 3: `…/specs/2026-06-11-phase3-context-pruning-lamr-design.md`
- Phase 4: `…/specs/2026-06-11-phase4-mcp-server-design.md`
- Phase 5: `…/specs/2026-06-12-phase5-forge-failed-run-learning-design.md`
- Phase 6: `…/specs/2026-06-12-phase6-task-engine-design.md`
- Phase 7: `…/specs/2026-06-12-phase7-tool-router-design.md`
- Phase 8: `…/specs/2026-06-12-phase8-audit-dashboard-design.md`
- Phase 9: `…/specs/2026-06-12-phase9-connectors-design.md`
- Phase 10: `…/specs/2026-06-12-phase10-team-cloud-design.md`

Each has a matching plan in `docs/superpowers/plans/`.

## Relationship to the existing backlog

This roadmap **supersedes the framing** of
[[syntheses/post-v1.1-roadmap]] for product direction (that page
remains the source of truth for v1.1 cleanup: npm publish, GUI
packaging, i18n). The fikri §16 "Repo Scanner / Memory Vault / Token
Audit" backlog items map onto Phases 2 / 1 / 8 respectively.
