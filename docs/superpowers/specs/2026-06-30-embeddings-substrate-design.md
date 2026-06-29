---
topic: embeddings-substrate
date: 2026-06-30
risk: MEDIUM
status: approved
roadmap: WS0
---

# Embeddings Substrate (`@megasaver/embeddings`)

## Goal

A local, lazy-loaded text-embedding substrate plus cosine similarity
and a JSONL vector sidecar store. This is WS0 of the retrieval/memory
roadmap; WS1 (retrieval) and WS3 (memory) reuse it. It must NOT touch
the network or load any ML model on import or in the core test suite.

## Public API (`src/index.ts`)

- `embed(texts: readonly string[]): Promise<Float32Array[]>`
  — lazy-loads a cached model singleton; returns one mean-pooled,
  L2-normalized vector per input. Model: `Xenova/all-MiniLM-L6-v2`
  via `@huggingface/transformers` (384-dim).
- `cosine(a: Float32Array, b: Float32Array): number`
  — pure float math, zero deps. Identical→1, orthogonal→0,
  opposite→-1. Zero-norm input → 0 (no NaN).
- `writeVectors(path: string, entries: readonly {id: string; vector: number[]}[]): void`
  — atomic temp+fsync+rename JSONL write (one record per line),
  mirroring `@megasaver/indexer` store.
- `readVectors(path: string): Map<string, Float32Array>`
  — reads JSONL back; missing file → empty map.

## Dependency placement decision (the load-bearing call)

`@huggingface/transformers` pulls `onnxruntime-node` (native,
platform-specific) and downloads ~50MB on first model use. To keep
`pnpm install` and cross-platform (ubuntu + windows) CI green:

1. It goes in **`optionalDependencies`**, never `dependencies`. A
   failed native install of the optional dep cannot break
   `pnpm install` / CI.
2. It is loaded ONLY via a lazy cached `await import(...)` inside
   `embed()` — same pattern as the TS compiler in
   `packages/output-filter/src/parsers/semantic.ts`. No eager /
   top-level import anywhere.
3. The dynamic import is typed with a small LOCAL interface + an `as`
   cast, so `tsc --noEmit` does NOT require the dep's types. The
   package typechecks even when the optional dep is absent.

## Test strategy

CORE vitest suite (always runs, in CI) — no model, no network, no
optional dep:
- `cosine`: identical=1, orthogonal=0, opposite=-1, zero-norm=0.
- sidecar store: round-trip write→read, missing file → empty map,
  ordering/precision preserved.
- lazy-load guard: a plain `import("@megasaver/embeddings")` loads
  zero `onnxruntime` / `transformers` modules (child-process
  `moduleLoadList` check, mirroring
  `packages/output-filter/test/no-eager-typescript.test.ts`).

Integration test (NOT run in CI) — gated with
`it.skipIf(!process.env.MEGA_EMBED_E2E)`: the real `embed()` model
run (vector length 384, normalized, similar texts > dissimilar).

## Risk

MEDIUM. New leaf package, additive only. The cross-platform CI risk
(native onnxruntime build) is contained by the optionalDependencies +
lazy-import + loose-typing decisions above.
