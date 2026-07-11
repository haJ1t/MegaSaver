# @megasaver/evidence-ledger

## 0.2.2

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0

## 0.2.0

### Minor Changes

- 9fc766e: Add @megasaver/evidence-ledger: canonical evidence schema with revoke/pin
  invariants, append-only store with in-record audit transitions, ledger-computed
  post-redaction digests, pin/unpin session round-trip, best-effort revocation
  (tombstone-before-delete: null digests + null chunk ref + scrubbed sourceRef +
  cleared pins, then ChunkDeletePort delete), and retention GC that degrades to
  metadata-only while exempting pinned + manual_hold. No @megasaver/core or
  content-store dependency.

### Patch Changes

- da9d3a7: Defense-in-depth security hardening (PR #146 follow-up)

  **evidence-ledger / context-gate**: `appendEvidence` now requires a `redactSourceRef`
  port (compile-time fail-closed: every caller must wire it). The port is applied to
  `sourceRef` before schema parse, so the stored record can never contain an
  unredacted secret-bearing field. `context-gate/record-output` wires
  `policyRedactSourceRef` which runs `@megasaver/policy` redact over
  command/args/url/query/path/label (hookTool left as-is — it's a tool name, not
  secret-bearing).

  **mcp-bridge**: The server-owned expansion-guard `Set<string>` is replaced with a
  FIFO-bounded `BoundedSet(EXPANSION_GUARD_CAP)` (cap = 4096). A long-lived server
  process can no longer grow the allowed-chunkSet set without bound. Per-session
  keying is deferred: `mega_fetch_chunk` args carry no `sessionId`, so keying by
  session would require a breaking wire-protocol change; stdio MCP is single-session-
  per-process in practice.

- f46ce66: Reliable save: approve_memory now runs a deterministic validator (schema,
  evidence-for-non-human, safe related files, bounded content, advisory
  heuristics) plus a conflict checker (duplicate/supersession/contradiction)
  before flipping a suggested memory to approved. Hard failures and conflicts
  leave the row suggested with reasons; an exact duplicate of an approved memory
  is rejected (never a second approved row); nothing auto-approves. Adds a
  regression test locking that agent-facing retrieval returns approved-only memory.

  Plan 3b (evidence-ports): the secret gate is now ACTIVE. approve_memory resolves
  evidenceIds to real EvidenceRecord objects via @megasaver/evidence-ledger; it
  rejects approval when any referenced evidence has unresolvedHighRisk (unresolved
  secret finding), is revoked/tombstoned, or belongs to a different canonical
  workspace (cross-workspace leak prevention, spec §6). The unresolvedSecret input
  to validateSave is derived from the real redactionReport, not a false default.

- Updated dependencies [7fcd881]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
