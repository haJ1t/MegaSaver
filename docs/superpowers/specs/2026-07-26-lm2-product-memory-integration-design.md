---
topic: lm2-product-memory-integration
status: approved by explicit user autonomy directive 2026-07-26; design review pending
risk: HIGH
date: 2026-07-26
sources:
  - docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md
  - packages/mcp-bridge/src/tools/get-relevant-memories.ts
  - packages/mcp-bridge/src/tools/recall.ts
  - packages/core/src/embed-memory.ts
  - user objective 2026-07-26
---

# LM2 Product Memory Integration

## Goal

Make LM2's hybrid retrieval a real, local-first product capability for every
task-driven Mega Saver memory recall surface, without creating a second source
of truth or relaxing the existing approval, temporal-validity, archival,
staleness, supersession, and code-truth gates.

## Decision

Use the existing `MemoryEntry` registry and its existing
`<storeRoot>/memory/<projectId>.embeddings.jsonl` sidecar as the sole product
memory corpus and vector index. Add a new agent-neutral
`@megasaver/memory-recall` package that maps eligible entries to LM2 candidates
and calls the LM2 ranker. It is not an LM1 capture store: no duplicate writes,
synthetic user memory, benchmark transport, or LM2 catalog/index sidecar is
created for product recall.

This chooses a shared adapter over two rejected alternatives:

1. **LM2-only store/capture:** rejected because it would fork memory truth from
   `MemoryEntry` and duplicate approval/evidence lifecycle state.
2. **MCP-only integration:** rejected because CLI and daemon recall would drift.
3. **Shared adapter (selected):** one canonical conversion and rank result,
   consumed by MCP, CLI, and daemon boundaries.

## Architecture

`@megasaver/memory-recall` depends on `@megasaver/core`,
`@megasaver/long-memory`, and `@megasaver/embeddings`; neither Core nor
Long Memory imports it. The package exposes:

- `projectWorkspaceKey(projectId)`: deterministic SHA-256-derived 16-hex key;
  it never exposes a project id to a vector path.
- `memoryCandidate(entry, workspaceKey)`: an LM2 `memory_entry` candidate
  whose text is `title + content + keywords` and whose source digest binds the
  exact ranking projection.
- `rankProjectMemories(input)`: filters through Core's existing search/gates,
  bounds candidates at LM2's 1,000-item ceiling, selects Safe or Adaptive
  mode, and returns entries in LM2 RRF order plus a receipt.

LM2 accepts the additive `memory_entry` candidate kind. The benchmark continues
to use only `state_snapshot` and `state_transition`; no benchmark request,
artifact, or leaderboard contract changes.

The package reads the existing atomic memory sidecar with `readVectors`.
Adaptive uses Mega Saver's existing local lazy `embed()` implementation and a
fixed descriptor for `Xenova/all-MiniLM-L6-v2` (384 dimensions). It never
downloads or calls a remote model unless a caller explicitly invokes the
pre-existing local embedding index action. No new remote setting exists.

`auto` selects Adaptive only when at least one current candidate has a stored
vector; otherwise it selects Safe. Adaptive can return a partial-index receipt:
all eligible entries remain in the lexical lane, so absent vectors cannot hide
an approved memory. Any read, vector, model, or timeout failure falls back to
the Safe lexical result and records the receipt reason; it never fails recall.

## Product surfaces

1. `get_relevant_memories` ranks project memories with `auto` and returns an
   additive `hybrid` receipt before the existing code-truth spot-check.
2. `mega_recall` ranks session/project-eligible memories by `intent` before
   the same spot-check and returns the receipt.
3. The daemon `/recall-registry` handler uses the same adapter and returns the
   same additive receipt.
4. `search_memory` and `mega memory search <project> <query>` use the adapter
   only for non-empty text queries; field-only/no-text searches keep their
   existing deterministic newest-first semantics.

Connector context and static warm-start construction intentionally remain
unchanged: they have no task query, so hybrid ranking would be arbitrary.
`mega_index_memory` remains the explicit local index build operation; it already
creates the sidecar consumed by Adaptive recall.

## Safety and compatibility

- All eligibility filtering occurs before candidate conversion through existing
  Core filters. `includeUnapproved`, `includeStale`, `includeArchival`, `asOf`,
  type, confidence, and scope keep their exact caller semantics.
- The adapter is read-only. It never mutates `MemoryEntry`, index files, or
  statistics during recall.
- Existing responses retain their existing fields. `hybrid` is optional and
  additive. Existing callers without a text/task keep their former output.
- Candidate conversion, vector reads, and local embedding inputs are bounded.
  Over 1,000 eligible candidates are deterministically capped after Core's
  eligibility filters; the omission count is reported in the LM2 receipt.
- No agent-specific code enters Core. CLI, MCP, and daemon only adapt their
  existing boundary input/output to the shared package.

## Verification requirements

Tests must first prove: approval/temporal/tier/stale gates reach the adapter;
partial vectors retain lexical-only candidates; Safe fallback is deterministic;
Adaptive RRF changes an ambiguous lexical order only when valid local vectors
exist; and changed text no longer matches its old vector projection. Boundary
tests must prove the same ordered ids and receipt semantics for MCP relevant
memory, MCP/daemon recall, and CLI/MCP search. Existing full suites plus
`pnpm verify` must pass. An external reviewer and adversarial reviewer must
approve the final diff before merge.

## Explicit non-goals

LM1 capture ingestion, remote embeddings, automatic background indexing,
benchmark scoring, connector static-context ranking, and a new user-facing
memory store are out of scope. They do not help this product integration and
would weaken the one-authoritative-memory invariant.
