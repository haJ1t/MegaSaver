---
topic: long-memory-runtime
status: user-approved design; written-spec review pending
risk: HIGH
date: 2026-07-19
sources:
  - https://github.com/xiaowu0162/LongMemEval-V2
  - packages/core/src/memory-entry.ts
  - packages/evidence-ledger/src/schema.ts
  - docs/superpowers/specs/2026-07-19-agent-continuity-platform-design.md
---

# Evidence-Backed Long Memory Runtime — Design

## Decision

Mega Saver will build one evidence-backed long-memory runtime for the developer
product and LongMemEval-V2, not a benchmark-only AgentRunbook clone and not a
replacement for `MemoryEntry`. “World-best” is a measured outcome: it may be
claimed only after a reproducible official LAFS result exceeds the published
frontier.

LongMemEval-V2 evaluates static state, dynamic state, workflow knowledge,
environment gotchas, and premise awareness over long multimodal histories; it
measures answer accuracy and memory-query latency. Its backend ingests with
`insert(trajectory)` and returns budgeted text/image evidence from
`query(query, query_image)`. (source:
https://github.com/xiaowu0162/LongMemEval-V2)

| Benchmark ability | Product capability |
|---|---|
| Static state | Time- and environment-bound code/config/tool evidence |
| Dynamic state | Cited before/action/after transitions |
| Workflow | Approved runbook with preconditions and verified outcome |
| Gotcha | Trigger, failed attempt, mitigation, verification |
| Premise | Applicability constraint plus counter-evidence |

Existing `MemoryEntry` remains the approved engineering-knowledge layer. The
runtime adds observations; it never mutates legacy memories or injects an
unapproved generated claim.

## Scope and delivery boundaries

This parent design locks the architecture. It preserves Hot Handoff's existing
scope and splits implementation into separate HIGH-risk specs/plans:

1. **LM0: benchmark boundary and contracts.** Public-data adapter, fixtures,
   latency telemetry, and read/write interfaces; no product-store migration.
2. **LM1: evidence-backed observations.** Durable state/transition records,
   deterministic capture, lifecycle, exact deduplication.
3. **LM2: hybrid recall.** Query lanes, candidate fusion, evidence selector,
   Safe and Adaptive profiles.
4. **LM3: knowledge/media/product.** Approved runbooks/gotchas/premises,
   opt-in media, product surfaces, Context Contracts.

LM0 is the next implementation-plan candidate after the written spec is
reviewed. Each slice gets its own worktree, TDD, architect/critic review, and
`pnpm verify` result.

## Constraints

- Core and the runtime are agent-agnostic; connectors submit normalized input
  through a port and benchmark code stays outside production packages.
- Every recallable assertion has available, same-workspace evidence ids. Missing
  or revoked evidence makes the assertion ineligible for normal recall.
- Local-first is the default. Remote models, local model downloads, and media
  analysis are explicit opt-ins; Safe sends no network request.
- Writes are append-first. Corrections supersede or contradict records; history
  is never rewritten and evidence is not deleted by rollback.
- Selection can only choose existing evidence; it cannot author a new claim.
- Benchmark artifacts use public benchmark data only, never user data, keys,
  telemetry, or local paths.

## Architecture

```
connector / benchmark adapter
          │ normalized observation
          ▼
LongMemoryCapturePort ──► Evidence Ledger + Content Store
          │                         │
          ▼                         ▼
Long Memory Store ◄──── immutable evidence ids
   snapshots · transitions · knowledge candidates
          │
          ▼
hybrid recall → evidence selector → RecallBundle + RecallReceipt
          ├─ CLI / MCP / Context Contracts
          └─ LongMemEval-V2 query adapter
```

Create `@megasaver/long-memory` as an agent-neutral leaf package. It owns
schemas, atomic append storage, deterministic indexes, query policy, and
receipts. `EvidencePort`, `EmbedPort`, `PlannerPort`, `RerankerPort`, and
`Clock` are structural ports; no vendor or benchmark type crosses its boundary.
The package reuses `@megasaver/retrieval` and `@megasaver/embeddings` rather
than loading models on the normal import path.

`benchmarks/longmemeval-v2/` is dev-only. Its Python `Memory` implementation
keeps one local Node JSONL process alive, amortizing index loading and making
measured query latency honest. It returns an image only after containment and
existence checks under the configured public dataset root.

## Data contract and capture

All records carry `id`, `workspaceKey`, `observedAt`, `sourceDigest`,
`environment`, `evidenceIds`, `status`, and bounded text. `sourceDigest` is a
SHA-256 of canonical source identity plus normalized payload; equal digests are
idempotent.

- `StateSnapshot`: observed labels, values, absence, code, or configuration.
- `StateTransition`: pre-state id, normalized action, post-state id, outcome,
  and ordered event time.
- `KnowledgeCandidate`: `procedure`, `gotcha`, or `premise`; required
  applicability constraint, claim, evidence ids, and lifecycle
  `suggested|approved|rejected|contradicted`.

Connectors and the benchmark adapter submit the same Zod-validated input. The
capture boundary resolves every evidence id and rejects unknown, revoked,
cross-workspace, or unavailable evidence. Deterministic capture creates
snapshots/transitions. An optional model may propose a candidate only if it
validates against the strict schema, cites evidence, and has an applicability
constraint. It is stored as `suggested`; only approved knowledge is reusable
agent guidance. Contradicted items remain historical and feed the premise lane
but are excluded from normal recall.

## Retrieval

`RecallRequest` has task, workspace, optional image, profile, token budget,
time/environment constraints, and latency budget. The planner creates
`state`, `transition`, `procedure`, `gotcha`, and `premise` lanes. Safe uses
deterministic rules. Adaptive and Benchmark may refine lanes through an
explicitly configured planner; invalid/failed output falls back to Safe.

Each lane gathers lexical BM25, complete semantic vectors, temporal and
environment matches, entity links, and direct evidence candidates. Reciprocal
rank fusion combines these lists. A deterministic coverage selector or opt-in
reranker then chooses the smallest existing cited set that covers the requested
facts, workflow steps, and contradictory premise inside budget.

`RecallBundle` contains only compact text/image items. Its mandatory
`RecallReceipt` gives record ids, evidence ids, lane, score signals,
time/environment match, token estimate, and selected/omitted reason. An item
without expandable evidence cannot be decisive.

| Profile | Computation | Failure behaviour |
|---|---|---|
| Safe | deterministic lanes, BM25, filters, graph, coverage | cited local subset; no model/network |
| Adaptive | Safe plus explicit local/approved embedding and reranking | remove failed enhancement, use Safe |
| Benchmark | configured planner/reranker and public-data images | fail the run with a typed benchmark error |

Profiles never change truth, storage, approval, or evidence rules.

## Acceptance and measurement

LM0 first reproduces the official no-retrieval and indexed-retrieval reference
invocations on the unmodified public small tier. Mega Saver runs then cover both
`web` and `enterprise`, preserving per-question outputs, aggregate metrics,
config, source revision, model names, hardware summary, and latency samples.

A leaderboard-ready package must account for every released question; validate
with official tooling; report overall accuracy, static/dynamic/procedure/gotcha
metrics, and `memory_query_avg_seconds`; archive fast/balanced/accurate points;
and not hide an ability regression behind aggregate score. “Best” requires a
reproducible, archived official LAFS result above the relevant frontier.

Context Contracts are local fixtures containing a task, a fixture store,
required evidence ids, forbidden stale/contradicted ids, and a token ceiling.
They pass only when all required evidence and a receipt are returned with no
forbidden item. A missing/stale fact must fail with its repair target, then pass
after an evidence-backed repair.

Release gates also prove duplicate capture idempotence, revocation removal,
Safe's absence of network traffic, same-workspace evidence enforcement, and
profile-specific fallback/error behaviour.

## Risks, rollback, and targets

This is HIGH risk: durable user-derived state, optional media, and a new agent
injection path. Writes are append-only and feature-flagged. Disable stops
capture/recall but leaves records inert; explicit retention/revocation controls
govern evidence deletion. Removing benchmark artifacts cannot affect user data.

Future files:

- Create `packages/long-memory/src/{model,ports,store,capture,query-plan,retrieve,select,receipt,index}.ts`
- Create `packages/long-memory/test/{model,store,capture,retrieve,receipt}.test.ts`
- Create `benchmarks/longmemeval-v2/{megasaver_memory.py,README.md}`
- Modify `pnpm-workspace.yaml`, `turbo.json`, and benchmark scripts only in LM0
- Create one execution spec and plan for each LM0–LM3

This parent design authorizes no production-code change. Its next artifact is
the LM0 implementation plan after the user reviews this written spec.
