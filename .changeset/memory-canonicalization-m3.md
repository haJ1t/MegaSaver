---
"@megasaver/mcp-bridge": minor
---

M3 semantic canonicalization on approve: after the existing exact-duplicate
hard-reject and validation/conflict gate, the approve gate runs a best-effort
semantic pass that cosine-compares the approved candidate's embedding to the
memory-vector sidecar of the other approved+current memories. A near-duplicate
(cosine >= 0.95) is SURFACED — a `semantic-duplicate` reason plus the matched
id in the validation sidecar's `conflictIds` — never auto-blocked and never
auto-mutated; the human canonicalizes by re-approving with `supersedesId` (M1).
Graceful: no sidecar / no candidate vector / embed failure leaves approval and
the exact-dup behaviour byte-identical and never throws. `ApproveMemoryEnv`
gains an optional injectable `embedFn` (defaults to the real `embed`).
