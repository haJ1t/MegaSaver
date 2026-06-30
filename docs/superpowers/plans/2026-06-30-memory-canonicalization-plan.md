---
title: M3 — Semantic canonicalization on approve (plan)
spec: docs/superpowers/specs/2026-06-30-memory-superset-design.md (sub-spec 5)
risk: HIGH
status: in-progress
created: 2026-06-30
---

## Goal

At the approve gate, detect near-duplicate memories via embeddings and SURFACE
them (a `semantic-duplicate` reason + matched id in `conflictIds`) for the human.
Never auto-block, never auto-mutate. Best-effort, deterministic threshold,
CI model-free.

## Where it sits

`packages/mcp-bridge/src/tools/approve-memory.ts`, on the SUCCESS path only —
after the exact-dup hard-reject + validation/conflict gate pass and the memory
has flipped to `approved` (so the approval succeeds; the dup is surfaced). The
semantic reasons/conflictIds are folded into the final success `writeSidecar`.

## Steps

1. RED: extend `test/approve-memory.test.ts`.
   - candidate cosine-near an approved+current memory (injected sidecar +
     injected `embedFn`) → approval SUCCEEDS, validation record carries reason
     `semantic-duplicate` + matched id in `conflictIds`. verify: read sidecar via
     `registry.getMemoryValidation`.
   - candidate NOT near anything → approval succeeds, NO semantic reason. verify.
   - no sidecar present → semantic pass skipped, approval + exact-dup unchanged.
   - archival/closed/unapproved memories are NOT targets (only `isRecallable`).
   - `embedFn` throws → approval still succeeds, no semantic reason, no throw.
   - real-embed E2E gated `it.skipIf(!process.env.MEGA_EMBED_E2E)`. Time pinned.
   → verify: `pnpm --filter @megasaver/mcp-bridge test` RED.

2. GREEN: implement in `approve-memory.ts`.
   - add `embedFn?: EmbedFn` to `ApproveMemoryEnv` (default real `embed`).
   - `const NEAR_DUP_THRESHOLD = 0.95;`
   - new best-effort helper `semanticDuplicates(env, existing)` → `{ reasons,
     conflictIds }`, returns empty on any failure (mirror get-relevant-memories
     try/catch-returns-null shape). Reads `readVectors(memoryEmbeddingsSidecarPath
     (storeRoot, projectId))`; candidates = `listMemoryEntries` filtered by
     `isRecallable(e, now) && !e.stale && e.id !== existing.id`; embed candidate
     `memoryEmbedText`; cosine ≥ threshold ⇒ collect id.
   - fold result into the success-path `writeSidecar` (status stays `valid`).
   - thread the surfaced reasons/conflictIds into the returned
     `ApproveMemoryResult.validation`/`.conflict` so the human sees them.
   → verify: per-package GREEN, existing tests intact.

3. Verify: per-package (mcp-bridge, core) + FULL `pnpm verify` (turbo build),
   model-free. Changeset (minor). Spec DONE + wiki/log.md. Commit.

## Anti-goals (M3)

- No auto-block / auto-mutate at approve. SURFACE only.
- No new vector field on `MemoryEntry` (sidecar only).
- No model in CI (injected vectors; real embed E2E-gated).
- No change to exact-dup hard-reject or the M1 supersede gate.
