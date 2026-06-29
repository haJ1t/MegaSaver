---
topic: semantic-retrieval
risk: HIGH
status: approved
workstream: WS1
---

# Semantic Retrieval (WS1) — hybrid BM25 + embeddings

## Goal

Add an embeddings-based relevance signal **alongside** BM25 (never
replacing it), with graceful fallback to BM25-only when vectors or the
model are absent. Built on the `@megasaver/embeddings` substrate (WS0).

## Non-negotiables

- Default builds download nothing. Embedding is opt-in.
- `scoreBlocks` stays **synchronous**. Async embedding happens at the
  boundary (`buildContextPack` / the MCP tool), never inside the scorer.
- BM25 (`semanticRelevance`) is unchanged. The new factor is additive.
- Missing sidecar / missing model / `embeddings:false` ⇒ behavior
  identical to today (factor 0, BM25-only). Never throw.

## Design

### 1. Embedding at build (opt-in)

`buildIndex` / `buildWorkspaceIndex` gain optional `embeddings?: boolean`
(default `false`). Only when `true`:

- For each persisted block, embed the text
  `name + " " + summary + " " + keywords.join(" ")` (trimmed; falls back
  to the block id when all three are empty so we never embed "").
- Reuse the incremental `contentHash` skip: a block whose `contentHash`
  already has a vector in the prior `embeddings.jsonl` carries that vector
  forward instead of re-embedding (keyed by `contentHash`, since block
  `id` is freshly minted on re-extraction).
- Write the surviving vectors to `embeddings.jsonl` **next to**
  `blocks.jsonl`, keyed by block `id`, via the embeddings store helpers
  (`writeVectors`). Use a single batched `embed()` call for the blocks
  that actually need embedding.

`embeddings:false` (the default) touches no embeddings code path and
loads no model.

### 2. The factor (sync, pre-computed vectors)

`scoreBlocks` gains two optional params:

- `taskVector?: Float32Array`
- `blockVectors?: Map<string, Float32Array>` (block id → vector)

New factor `embeddingRelevance` = normalized `cosine(taskVector,
blockVector)` per block, `0` when either vector is missing. Normalized to
`0..1` by `(cos + 1) / 2`-style clamp into `[0,1]` (cosine of normalized
embeddings is already in `[-1,1]`; we clamp negatives to 0 so it never
fights the positive factors). Weight `embedding: 0.8` in `WEIGHTS`.

The async work (embedding the task query + loading the sidecar) lives at
the boundary, not in the scorer.

### 3. Hybrid `searchBlocks` (library)

`searchBlocks` keeps BM25 first. New optional params
`{ taskVector?, blockVectors? }`. When both are present, cosine-rerank
the top-N BM25 hits (stable, additive blend). Absent ⇒ pure BM25,
identical to today. Existing signature still works.

### 4. Boundary wiring (MCP context-pruning)

In the context-pruning tool: if an `embeddings.jsonl` sidecar exists for
the project, load block vectors (`readVectors`) and embed the task
(async), then pass both into `buildContextPack` → `scoreBlocks`.
Best-effort: any failure (no sidecar, embed throws) falls back to
BM25-only silently. `searchBlocks` has no MCP caller today (the
search-code tool is grep-based), so its hybrid path is library-only.

## CI safety

Real `embed()` only runs behind `it.skipIf(!process.env.MEGA_EMBED_E2E)`.
All factor/ranking/hybrid tests use **injected** hand-written vectors and
a hand-written `embeddings.jsonl` fixture — no model download in CI.

## Risk

HIGH (context packer / retrieval core path). Additive, BM25 preserved,
graceful fallback everywhere.
