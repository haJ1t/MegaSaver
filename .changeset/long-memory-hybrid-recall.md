---
"@megasaver/long-memory": minor
---

New `@megasaver/long-memory` package: the evidence-backed long-memory
runtime, in three layers.

LM0 contracts — the `megasaver-long-memory` stdio RPC boundary
(`dispatchRpcLine`), an in-memory store, and the shared error/model
schemas.

LM1 observations — typed observation capture (`prepareCapture`) with
evidence binding and eligibility checks, path-security-guarded record and
state stores, a fused selector, and a token-budgeted recall request
contract.

LM2 hybrid recall — a lexical + semantic ranker over a per-model vector
sidecar store, with a locked model catalog (admission fences and V1
bootstrap), a quota ledger with recovery, canonical embedding identity
(`canonicalFloat32`, `embeddingInputDigest`,
`modelDescriptorFingerprint`), an embedding egress/approval port for
remote models, and receipts (`hybridReceiptSchema`,
`lm2IndexReceiptSchema`) that record why each candidate ranked where it
did. Ships a `megasaver-long-memory-lm2-benchmark` binary and the
LongMemEval-V2 harness under `benchmarks/longmemeval-v2/`.

Adds `fs-ext` (advisory file locking) and its `allowBuilds` entry.
