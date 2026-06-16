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
- `rawDigest`;
- `returnedDigest`;
- `redactedRawChunkSetId`;
- `returnedChunkRefs`;
- `createdAt`;
- `expiresAt`;
- `retentionClass`: transient | session | pinned | manual_hold;
- `pinnedByMemoryIds`;
- `status`: available | retained_metadata_only | revoked;
- `revokedAt`;
- `revocationReason`: secret_false_negative | user_requested_purge |
  retention_gc | policy_change | null;
- `policyVersion`;
- `pipelineVersion`.

All digests are computed over post-redaction content only. Pre-redaction hashes
are forbidden because they can become equality or presence oracles for secrets.

## 4. Revocation Semantics

The ledger is semantically append-only: every state transition is auditable.
Recoverable raw chunks are not immutable.

Revocation flow:

1. append a revocation event with reason;
2. mark the evidence record `status: "revoked"`;
3. delete associated recoverable raw chunk material on a best-effort filesystem
   basis;
4. block future expansion and human raw inspection;
5. retain metadata needed to explain that evidence existed and was revoked.

Current content-store chunks are plaintext JSON files. Therefore revocation is
**not** guaranteed forensic erasure. The product must call it "best-effort local
delete plus logical tombstone" unless a future encrypted-at-rest content store is
implemented. Only then may key deletion be described as crypto-shredding.

## 5. Retention Semantics

Ordinary retention may delete recoverable raw chunks when evidence expires or
size budgets require GC. It must leave metadata sufficient for audit.

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
- digest tests proving pre-redaction bytes are never hashed;
- revocation tombstones metadata and blocks expansion;
- revocation performs best-effort raw chunk delete;
- retention GC leaves metadata-only records;
- pinned evidence survives ordinary GC;
- secret/user revocation overrides pins;
- dependency graph test forbids `evidence-ledger -> core` and connector edges.
