---
title: Evidence Ledger Interface Design
date: 2026-06-16
status: draft
risk: HIGH
risk_note: >
  The ledger is the shared interface between ContextGate token reduction and
  Reliable Save. It owns evidence schema, retention, revocation, digest rules,
  and package boundaries for secret-bearing local data.
branch: codex/context-ledger-architecture
related:
  - docs/superpowers/specs/2026-06-16-contextgate-honest-90-design.md
  - docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md
  - wiki/decisions/content-store-no-core-edge.md
  - wiki/concepts/agent-agnostic-core.md
---

# Evidence Ledger Interface Design

## 1. Problem

ContextGate produces evidence. Reliable Save consumes evidence. If both specs
define their own evidence shape, the implementation will drift at exactly the
boundary that handles secrets, retention, replay, and approval.

This spec owns the canonical ledger interface.

## 2. Package Boundary

Create `@megasaver/evidence-ledger` as a leaf package.

Allowed dependencies:

- `@megasaver/shared`;
- `@megasaver/content-store` only through opaque chunk-set identifiers and
  explicit read/delete ports if the implementation needs chunk persistence;
- standard Node filesystem APIs.

Forbidden dependencies:

- `@megasaver/core`;
- agent connector packages;
- `@megasaver/mcp-bridge`;
- GUI or CLI packages.

Core composes the ledger through interfaces. ContextGate writes evidence.
Reliable Save reads evidence status. Connectors never depend on the ledger
directly.

## 3. Canonical Evidence Schema

Each evidence record has:

- `evidenceId`;
- `workspaceKey`;
- `sessionRef`: durable session id, live session id, or null;
- `sourceKind`: file | command | grep | fetch | hook | manual | agent_request;
- `sourceRef`: structured source label;
- `classification`;
- `redactionReport`;
- `rawDigest`: ledger-computed digest over post-redaction content, or null
  after revocation;
- `returnedDigest`: ledger-computed digest over post-redaction returned
  content, or null after revocation;
- `redactedRawChunkSetId`;
- `returnedChunkRefs`;
- `createdAt`;
- `expiresAt`;
- `retentionClass`: transient | session | pinned | manual_hold;
- `pinnedByMemoryIds`;
- `status`: available | retained_metadata_only | revoked;
- `revokedAt`;
- `revocationReason`: secret_false_negative | user_requested_purge |
  policy_change | null;
- `transitions`: in-record audit trail written atomically with the record;
- `policyVersion`;
- `pipelineVersion`.

`sourceRef` is secret-bearing because it can hold command strings, arguments,
URLs, queries, and paths. It is redacted at append time by the same detector used
for raw chunks. Stored `sourceRef` may never contain an unredacted
secret-bearing argument, URL, query, or path segment.

All digests are computed by the ledger over post-redaction content it persists.
Callers do not supply raw digests. Pre-redaction hashes are forbidden because
they can become equality or presence oracles for secrets.

Schema invariants:

- `retentionClass === "pinned"` requires `status === "available"`;
- `status === "revoked"` requires `rawDigest === null`,
  `returnedDigest === null`, `redactedRawChunkSetId === null`, and a scrubbed
  `sourceRef`;
- `revocationReason` is set only for `status === "revoked"`;
- ordinary retention GC uses a `raw_gc` transition and
  `status: "retained_metadata_only"`, not `revocationReason`.

## 4. Revocation Semantics

The ledger is semantically append-only: every state transition is auditable.
Recoverable raw chunks are not immutable.

Revocation flow:

1. atomically tombstone the evidence record before raw deletion:
   - append an in-record `revoked` transition;
   - mark `status: "revoked"`;
   - set `revokedAt` and `revocationReason`;
   - null `rawDigest` and `returnedDigest`;
   - null `redactedRawChunkSetId`;
   - replace `sourceRef` with a minimal scrubbed form that keeps `sourceKind`
     and a non-reversible label, but drops command, args, URL, query, and path
     strings;
   - clear `pinnedByMemoryIds`;
   - reset `retentionClass` off `pinned`;
2. best-effort delete associated recoverable raw chunk material;
3. block future expansion and human raw inspection;
4. retain metadata needed to explain that evidence existed and was revoked.

The record is tombstoned before best-effort raw deletion. A crash may leave a
revoked record with a still-lingering raw chunk, which is fail-closed toward
read/expansion APIs. It must not leave an available record pointing at deleted or
secret-bearing material.

The audit trail is the in-record `transitions[]` array. It is written atomically
with the record. There is no separate plaintext `events.jsonl` sidecar because a
sidecar cannot be transactionally consistent with the record and would create a
second copy of secret-adjacent audit data.

Current content-store chunks are plaintext JSON files. Therefore revocation is
**not** guaranteed forensic erasure. The product must call it "best-effort local
delete plus logical tombstone" unless a future encrypted-at-rest content store is
implemented. Only then may key deletion be described as a stronger purge mode.

## 5. Retention Semantics

Ordinary retention may delete recoverable raw chunks when evidence expires or
size budgets require GC. It must leave metadata sufficient for audit.

Ordinary retention GC:

- skips `retentionClass: "pinned"`;
- skips `retentionClass: "manual_hold"`;
- may degrade only `transient` or `session` records with `status: "available"`
  to `status: "retained_metadata_only"`;
- records that degradation as a `raw_gc` transition, not a revocation.

`manual_hold` means an explicit human hold beyond ordinary retention. It is not
removed by expiry/size GC.

Pinning is legal only from `retentionClass: "session"`. `unpinEvidence` returns
the record to `retentionClass: "session"`. This makes pin/unpin a clean
round-trip and avoids silently rewriting `transient` or `manual_hold` records.

Evidence referenced by approved memory is pinned against ordinary retention GC.
Secret/user revocation overrides pins. After revocation, any memory that cites
the evidence explains it as `evidenceStatus: "revoked"` and does not offer raw
expansion.

## 6. API Contract

The package exposes pure schemas and narrow IO functions:

- `appendEvidence(recordInput)`;
- `getEvidenceStatus(evidenceId)`;
- `listEvidenceByWorkspace(workspaceKey, filters)`;
- `pinEvidence(evidenceId, memoryId)`;
- `unpinEvidence(evidenceId, memoryId)`;
- `revokeEvidence(evidenceId, reason)`;
- `gcEvidence(workspaceKey, policy)`;
- `explainEvidence(evidenceId)`.

IO boundary rules:

- `workspaceKey` parameters are plain strings, matching content-store call
  patterns, and are parsed at every IO entry with `workspaceKeySchema.parse`;
- reads assert the loaded record's `workspaceKey` equals the requested
  `workspaceKey`;
- store/path parameters remain plain strings and are validated at the boundary,
  not branded in public function signatures.

Agent-facing MCP tools do not receive arbitrary `listEvidenceByWorkspace` or raw
inspection capabilities. Human CLI/GUI review surfaces may call review APIs with
explicit intent.

## 7. Atomicity

Ledger writes are atomic per evidence record. If an operation spans evidence and
another store, the caller must use a two-step protocol with an explicit pending
state or rollback marker. The implementation plan must define this before
writing sidecars or approving memory from evidence.

## 8. Testing

Required tests:

- schema pins for status, retention class, source kind, and revocation reason;
- digest tests proving pre-redaction bytes are never hashed and caller-supplied
  digests are not accepted;
- append-time `sourceRef` redaction;
- revocation tombstones metadata and blocks expansion;
- revocation of planted secrets removes them from `sourceRef` and nulls
  `rawDigest` / `returnedDigest`;
- revocation performs best-effort raw chunk delete;
- retention GC leaves metadata-only records;
- pinned evidence survives ordinary GC;
- manual_hold evidence survives ordinary GC;
- secret/user revocation overrides pins;
- pin/unpin round-trip is `session -> pinned -> session`;
- revocation of pinned evidence resets retention class off `pinned`;
- dependency graph test forbids `evidence-ledger -> core` and connector edges.
