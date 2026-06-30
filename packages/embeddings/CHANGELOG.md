# @megasaver/embeddings

## 0.2.0

### Minor Changes

- 09912d9: feat: new @megasaver/embeddings substrate (WS0)

  Local, lazy-loaded text embeddings + cosine similarity + a JSONL vector
  sidecar store, reused later by retrieval (WS1) and memory (WS3).

  - `embed(texts)` lazy-loads a cached `Xenova/all-MiniLM-L6-v2` model via
    `@huggingface/transformers` (an optionalDependency, loaded only inside
    `embed()` via a runtime dynamic import — never on package import).
  - `cosine(a, b)` pure float math (zero-norm → 0, no NaN).
  - `writeVectors` / `readVectors` atomic temp+fsync+rename JSONL store.

  No network or model load on import or in the core test suite; the actual
  model run is a separate test gated on `MEGA_EMBED_E2E`, so cross-platform
  CI never downloads the model or builds native onnxruntime.
