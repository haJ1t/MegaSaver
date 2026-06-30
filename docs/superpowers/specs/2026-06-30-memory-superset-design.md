---
topic: memory-superset
status: approved
risk: HIGH
workstream: WS3
increment: 1
date: 2026-06-30
---

# Memory Superset — Design

## Mission

Deepen Mega Saver's memory into a **superset** that meets-or-exceeds every
capability of the leading agent-memory tools, built **on** our existing stack
(`@megasaver/core` memory + `@megasaver/memory-graph` + `llm-wiki`), reusing the
`@megasaver/embeddings` substrate. We do not rebuild memory; every layer is
additive and reuses code already on `main`.

The bar: any feature mem0 / Letta / Zep / Cognee / Memori / claude-mem ships, we
ship — plus our moat they lack.

## Feature matrix — the field vs Mega Saver

| Capability                                   | mem0 | Letta/MemGPT | Zep/Graphiti | Cognee | Memori | claude-mem | **Mega Saver (target)** |
|----------------------------------------------|:----:|:------------:|:------------:|:------:|:------:|:----------:|:-----------------------:|
| LLM fact extraction / store                  |  ✓   |      ✓       |      ✓       |   ✓    |   ✓    |     ✓      | ✓ (deterministic-first, LLM opt-in) |
| Vector / semantic recall                     |  ✓   |      ✓       |      ✓       |   ✓    |   ~    |     ✓      | **✓ (increment 1)** |
| Entity graph (entities + relations)          |  ✓   |      ~       |      ✓       |   ✓    |   ✓    |     ~      | **✓ (increment 1)** |
| Temporal / bi-temporal validity             |  ~   |      ~       |    **✓**     |   ✓    |   ~    |     ✗      | **✓ (M1)** |
| Tiered memory (working/recall/archival)      |  ~   |    **✓**     |      ~       |   ~    |   ~    |     ✗      | **✓ (M2, sub-spec 4)** |
| Self-editing / decay / forgetting            |  ~   |      ✓       |      ~       |   ✓    |   ✗    |     ✗      | ◑ (deferred — sub-spec 4) |
| Canonicalization / dedup on write            |  ✓   |      ~       |      ✓       |   ✓    |   ~    |     ~      | **✓ (M3, sub-spec 5)** |
| Transcript → memory summarization            |  ~   |      ~       |      ~       |   ~    |   ~    |   **✓**    | ◑ (deferred — sub-spec 6) |
| **Evidence ledger (provenance per memory)**  |  ✗   |      ✗       |      ~       |   ✗    |   ✗    |     ✗      | **✓ (already shipped — moat)** |
| **Human approval gate before share**         |  ✗   |      ✗       |      ✗       |   ✗    |   ✗    |     ✗      | **✓ (already shipped — moat)** |
| **Agent-agnostic SHARED memory**             |  ✗   |      ✗       |      ✗       |   ✗    |   ✗    |     ✗      | **✓ (already shipped — moat)** |
| **Lossless (no LLM-blinding)**               |  ✗   |      ✗       |      ~       |   ~    |   ✗    |     ✗      | **✓ (already shipped — moat)** |
| **Local / no-proxy by default**              |  ~   |      ~       |      ✗       |   ~    |   ~    |     ✓      | **✓ (already shipped — moat)** |

Legend: ✓ first-class · ~ partial/library-dependent · ◑ planned · ✗ absent.

### Why this is a superset, not a clone

The competitors are a **union of point features over a managed/cloud store**. Our
moat is the four properties none of them combine: an **evidence ledger** (every
memory cites its provenance), a **human approval gate** (no memory is shared with
agents until a human promotes it), **agent-agnostic shared memory** (the same
`memory-graph` + `llm-wiki` is read by Claude Code, Codex, Cursor, Aider), and
**lossless local-first** operation (no proxy, nothing stripped the model needs).
Adding their retrieval/graph features on top of that base — rather than bolting
our gate onto their store — is what makes the result a strict superset.

## Existing stack we build ON (do not rebuild)

- `packages/core/src/memory-entry.ts` — `MemoryEntry`: 10 types, confidence,
  source, scope, approval, `relatedFiles`, `relatedSymbols`, evidence, stale,
  expiresAt.
- `packages/core/src/memory-search.ts` — BM25 ranker over title+content+keywords.
- `packages/memory-graph/src/{model.ts, build-graph.ts, inputs.ts}` — node/edge
  kinds, deterministic graph build, first-writer-wins dedup.
- `packages/embeddings/src` — `embed` / `cosine` / `writeVectors` / `readVectors`,
  all lazy: importing the package does **not** load the model.
- WS1 reference pattern: `packages/indexer/src/embed-blocks.ts` (incremental
  sidecar, injectable `EmbedFn`, content-hash carry-forward) and
  `packages/mcp-bridge/src/tools/context-pruning.ts` `embeddingSignalFor`
  (best-effort boundary embed, graceful fallback, never throws).

## Layered roadmap

1. **Semantic recall** — vector recall over memories. **THIS INCREMENT.**
2. **Entity graph** — entity nodes + mention edges over memories. **THIS INCREMENT.**
   Plus: wire `memoryRelevance` so approved memory actually influences context
   packs. **THIS INCREMENT.**
3. **Temporal / bi-temporal validity** — **DONE (M1, 2026-06-30).**
4. **Tiered + decay** — **DONE (M2, 2026-06-30).**
5. **Canonicalization** — **DONE (M3, 2026-06-30).**
6. **Transcript → memory** — **DONE (M4, 2026-06-30, deterministic / no-LLM).**
   See [2026-06-30-memory-from-session-design.md](./2026-06-30-memory-from-session-design.md).

---

## Increment 1 — scope (this work)

All three layers are additive, reuse the existing substrate, and keep CI
model-free (a default `pnpm verify` loads no embedding model).

### 1A. Semantic memory recall (matches mem0 / Zep vector recall)

- **Sidecar.** Memory vectors live in a per-project sidecar
  `<storeRoot>/memory/<projectId>.embeddings.jsonl`, keyed by memory id, using
  `writeVectors` / `readVectors` from `@megasaver/embeddings`. We do **not** add a
  vector field to `MemoryEntry` — the schema stays lean; the sidecar is the only
  new on-disk artifact. Mirrors `embeddingsSidecarPath` in the indexer.
- **Build path (opt-in, incremental).** A new `embedMemoryEntries(entries,
  priorHashById, embedFn = embed)` builds/refreshes the sidecar. Incremental: a
  memory whose id + content hash (hash of `title + "\n" + content`) is unchanged
  carries its prior vector forward (no re-embed); only new/changed memories are
  embedded in one batched `embed()` call. Computing vectors is **opt-in** — no
  write path embeds by default; the caller chooses to call `embedMemoryEntries`.
  Exact mirror of `embedBlocks`.
- **Semantic search alongside BM25 (keep BM25).** A new
  `searchMemoryEntriesSemantic(entries, { queryVector, memoryVectors, limit,
  ...filters })` applies the same field filters as `searchMemoryEntries` then
  ranks the survivors by `cosine(queryVector, memoryVector)` descending. BM25
  `searchMemoryEntries` is untouched and remains the default.
- **Boundary embed, graceful fallback.** The async query-embed happens at the
  MCP boundary (`get-relevant-memories.ts`), best-effort: read the sidecar; if
  empty → fall back to BM25. Embed the query; if the model is absent or `embed`
  throws → fall back to BM25. **Never throws.** Mirrors `embeddingSignalFor`.
- **Full-coverage guard (no silent recall loss).** Semantic ranking drops any
  candidate memory whose vector is missing from the sidecar. Because no
  production path embeds on write, a memory created/approved after the last
  manual sidecar build is un-vectored — partial coverage is the default steady
  state, and ranking it would silently omit a true approved memory. So the
  boundary first checks that EVERY approved non-stale candidate has a vector; if
  any is missing it falls back to BM25 (which returns all matches). Results are
  therefore either full-coverage semantic OR BM25, never a silently-truncated
  mix.

### 1B. Wire `memoryRelevance` (closes a real gap)

The `memoryRelevance` factor already exists in
`packages/context-pruner/src/score.ts` (it fires when `memoryFiles` is passed).
Today the CLI (`apps/cli/src/commands/context/shared.ts`) and MCP
(`mcp-bridge/src/tools/context-pruning.ts`) both pass `memoryFiles`, but they
derive it from `searchMemoryEntries({ text: task })` — a BM25 text search that
**drops every approved memory whose title/content does not lexically overlap the
task** (zero-overlap docs are filtered, and a limit is applied). So an approved
memory whose `relatedFiles` are exactly the files in play is silently excluded
from the memory signal whenever its prose does not match the task wording.

The fix is the root-cause fix at the shared boundary: feed the factor from **all
approved, non-stale project memories' `relatedFiles`**, not the BM25-narrowed
subset. A single shared helper `approvedMemoryFiles(memories)` (and its stale
counterpart) lists `relatedFiles` of approved/non-stale entries; both the CLI and
MCP context paths call it. No scorer change — the factor already exists; this only
changes what is fed in. Additive and surgical.

**Known imprecision (v1, accepted).** Feeding ALL approved memory means every
approved memory's `relatedFiles` get the `memoryRelevance` bump regardless of the
task — a deliberately broad signal. It is bounded (binary per file, weight 0.7,
below the force-include factors), so it cannot flood a pack on its own. A
follow-up may re-scope this to task-relevant memories (e.g. semantic/BM25-ranked)
once the memory-vector sidecar has full coverage; deferred.

The GUI workspace-context route (`apps/gui/bridge/routes/workspace-context.ts`)
stays out of scope: it addresses workspaces by a one-way hash with no project-id
reverse-lookup, so there is no approved-memory source to read there yet. That is
the documented Phase-4 cwd-scoped-memory blocker, unchanged.

### 1C. Entity layer (matches mem0 / Cognee / Memori entity store)

- **Model.** Add `entity` to `nodeKindSchema` and `entity-mention` to
  `edgeKindSchema` in `packages/memory-graph/src/model.ts`. Add an
  `entities: EntityInput[]` input (id + label) — or derive entities inside
  `buildGraph` — and emit `entity-mention` edges `memory → entity`.
- **Deterministic extraction (NO LLM).** Inside `buildGraph`, derive entities
  from each memory's `relatedSymbols` and `relatedFiles`: a symbol `foo` becomes
  entity `entity:symbol:foo`, a file `a/b.ts` becomes entity `entity:file:a/b.ts`.
  For every memory mentioning an entity, emit `entity-mention` (memory → entity).
  Entity nodes dedup first-writer-wins exactly like the existing file/symbol
  nodes. This enables "what do we know about entity X?" by aggregating all
  `entity-mention` edges into X across memories. Fully deterministic, no model.
- **Reuse.** Entity ids are kind-prefixed (`entity:symbol:` / `entity:file:`) to
  stay disjoint from the existing `file:` / `symbol:` id spaces, mirroring the
  existing prefixing discipline in `build-graph.ts`.

---

## Deferred sub-specs (do NOT build now)

Each plugs into a named existing file; each gets its own spec → plan → TDD cycle.

3. **Temporal / bi-temporal validity** (matches Zep/Graphiti). **DONE — M1,
   2026-06-30.** Shipped: optional `validFrom` / `validTo` (valid time) +
   `supersedesId` on `MemoryEntry` and the overlay variant (additive,
   backward-compatible — rows without them read as current); `isCurrent(memory,
   asOf)` helper in `memory-entry.ts`; current-by-default filtering plus an
   optional `asOf` time-travel parameter in `memory-search.ts` and
   `memory-search-semantic.ts`, threaded through MCP `recall` /
   `get_relevant_memories` (and `supersedesId` accepted by `save_memory`).
   Approving a memory that supersedes an older one closes the old one's
   `validTo` (lossless — kept for time-travel) in `approve-memory.ts`. The
   pre-existing `supersede` edge kind in `memory-graph/model.ts` is now emitted
   from the recorded `supersedesId` by the CLI and GUI graph builders.

4. **Tiered (working / recall / archival) + decay** (matches Letta/MemGPT).
   **DONE — M2, 2026-06-30.** Shipped, deterministic and no background timer:

   - **`tier`** (`working` | `recall` | `archival`) — optional, additive on
     `MemoryEntry` + the overlay variant + the update patch. Absent ⇒ `recall`
     (every legacy/normal row reads as recall, back-compat). The patch carries
     `tier` so the sweep can mutate it.
   - **Tier-aware recall through the centralized predicate.** `isRecallable`
     gains an optional `{ includeArchival }` and a sibling `isArchived(memory)`;
     archival is excluded by default and only an explicit `includeArchival` (or
     the search `includeArchival` flag) returns it. All four `isRecallable`
     surfaces (BM25/semantic search via their own gate, MCP `recall`,
     get_relevant_memories, daemon recall, GUI connector-context) inherit it —
     no per-surface re-implementation.
   - **`effectiveConfidence(memory, now)`** — pure, exported, read-time only
     (never mutates stored confidence): `baseWeight(confidence) ×
     ageDecay(now − (updatedAt | createdAt)) × tierWeight(tier)`. Monotonically
     decreasing with age. Wired into `searchMemoryEntries` ranking ADDITIVELY
     (a tie-aware multiplier on the BM25 hit, working tier a small boost) so an
     aged memory ranks lower but is never dropped.
   - **`mega memory sweep <project>` CLI + `mega_memory_sweep` MCP tool** — the
     ONE mutation. A deterministic, lossless policy: an approved, currently-
     valid memory that is past an inactivity-age threshold AND low base
     confidence (or already closed/superseded) is set `tier = "archival"` via
     `updateMemoryEntry`. Never deletes; archival is reversible. `--json`
     summary `archived=N scanned=M`; idempotent (a second sweep no-ops because
     already-archival rows are skipped). Mirrors the `mega memory index` /
     `mega_index_memory` wiring (project resolution, store env, summary line).

   RECALL-SAFETY: decay only down-ranks; tier only filters `archival`; and only
   an explicit sweep ever sets `archival`. A current working/recall memory is
   therefore never silently dropped by tier or decay.

   Plugged into `packages/core/src/memory-entry.ts` (schema + predicate +
   `effectiveConfidence` + `sweepMemoryTiers` planner) and
   `packages/core/src/memory-search.ts` (decay ranking).

5. **Semantic canonicalization on approve** — **DONE (M3, 2026-06-30).** At the
   approval gate, detect near-duplicate memories by cosine over the memory-vector
   sidecar and SURFACE them for the human — never auto-block, never auto-mutate.
   Implemented in `packages/mcp-bridge/src/tools/approve-memory.ts`:
   - Runs AFTER the existing exact-dup hard-reject + validation/conflict gate, on
     the success path only (the memory has already flipped to `approved`). A
     near-dup therefore SUCCEEDS — it is surfaced, not blocked.
   - Best-effort, mirroring `get-relevant-memories`' semantic pass: no sidecar /
     no candidate vector / `embed` throws ⇒ the pass is skipped and the existing
     behaviour is byte-identical. It never throws and never blocks an approval.
   - Embeds the candidate's `title+content` (`memoryEmbedText`) via an injectable
     `EmbedFn` (default real `embed`, so CI stays model-free with injected
     vectors) and cosine-compares it to the sidecar vectors of the other
     approved+current (`isRecallable`) memories. Archival / closed / unapproved
     memories are NOT canonicalization targets.
   - cosine ≥ `NEAR_DUP_THRESHOLD` (0.95, deterministic const) ⇒ records a
     `semantic-duplicate` reason + the matched memory id in the validation
     sidecar's `conflictIds`. The human then re-approves with `supersedesId` to
     canonicalize, reusing the M1 supersede gate. One threshold, one reason.

6. **Transcript → memory summarizer** (matches claude-mem). Summarize a session
   transcript into candidate `suggested` memories (with evidence) for the human
   gate. LLM opt-in, flagged per spec with cost/privacy notes. Plugs into a new
   summarizer reading the content-store + the existing approval pipeline.

---

## Risk

**HIGH** — touches the memory data model and the shared memory-graph contract.
Mandatory: full superpowers chain + architect design (captured here) + critic
adversarial review + worktree (feature branch, no `main` edits). Evidence-
preserving only; no aggressive compression.

## Anti-goals

- No new vector field on `MemoryEntry` (sidecar only).
- No LLM in extraction or in CI (deterministic entities; injected vectors in
  tests; real `embed()` gated behind `MEGA_EMBED_E2E`).
- No replacement of BM25 — semantic recall is added alongside it.
- No change to the approval gate or evidence ledger in this increment.

## Testing strategy (CI model-free)

- **Semantic recall:** unit tests with an injected memory-vector sidecar and a
  hand-set query vector — assert a semantically near memory ranks above a
  BM25-equal far one; with no sidecar, output is identical to BM25 (graceful).
  The real `embed()` path is gated `it.skipIf(!process.env.MEGA_EMBED_E2E)`.
- **`memoryRelevance` wiring:** a context-pack test where an approved memory's
  `relatedFile` is fed → that file's blocks rank up vs. without; empty memories →
  unchanged (no-op).
- **Entity layer:** two memories with an overlapping `relatedSymbol` → one entity
  node aggregates both memories' mentions; deterministic, no model.
- Existing memory / graph / pruner tests must stay green.
