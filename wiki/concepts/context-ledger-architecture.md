---
title: Context Ledger Architecture
tags: [concept, architecture, memory, save, evidence-ledger, token-saver]
sources:
  - docs/superpowers/specs/2026-06-16-context-ledger-reliable-save-design.md
  - docs/superpowers/specs/2026-06-16-contextgate-honest-90-design.md
  - docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md
  - concepts/agent-agnostic-core.md
  - concepts/context-gate-pipeline.md
  - concepts/proxy-mode.md
  - concepts/structured-memory-engine.md
  - concepts/memory-approval.md
status: draft
created: 2026-06-16
updated: 2026-06-16
---

# Context Ledger Architecture

Context Ledger Architecture is the proposed next MegaSaver architecture for
making **save reliability** the product center while still targeting about 90%
reduction on eligible MegaSaver-mediated context. After external review, the
umbrella draft was split into two specs: ContextGate honest reduction and
Reliable Save Ledger.

## Core idea

MegaSaver should not let an agent write trusted project memory directly. Save is
a commit pipeline:

1. ContextGate observes or proxies read/search/command output.
2. Redaction and compression run before evidence is persisted or returned.
3. An Evidence Ledger stores redacted, expandable evidence references, with
   tombstone/revocation and retention rather than unpurgeable raw content.
4. Agent `save_memory` creates suggested memory, not approved memory.
5. Validators check evidence, secrets, scope, schema, expiry, and source policy.
6. Conflict checks catch duplicate, superseding, or contradictory memory.
7. Approval policy decides whether the candidate is suggested, quarantined,
   rejected, or committed.
8. Agent files are projections from approved memory only.

## Why this is different from an output proxy

DFMT-style replacement shows an important hot-path lesson: raw output should not
enter the model before compression. MegaSaver should keep that lesson through
`proxy_*` tools and saver hooks, but its differentiator is broader: evidence,
memory, conflicts, approval, replay, and multi-agent projections.

## Token target

The 90% target applies to eligible MegaSaver-mediated large text outputs and is
reported as token-weighted aggregate math:
`1 - (sum(returnedTokensEligible) / sum(rawTokensEligible))`. Reports must also
show eligible-token fraction, mediated-token fraction, passthrough fraction, and
evidence-sufficiency counters so MegaSaver cannot win by blinding the model.

## Hard invariants

- No agent-created memory enters context without evidence.
- No unresolved secret finding is projected to agents.
- No conflicted candidate is auto-approved.
- No semantic update overwrites an existing memory row in place.
- No connector file write proceeds after projection validation fails.
- No candidate claim or unapproved/raw evidence excerpt is returned by
  agent-facing MCP retrieval.
- Every committed memory can explain its evidence status and policy version.
- Secret revocation can tombstone evidence and purge recoverable raw chunks.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/context-gate-pipeline]]
- [[concepts/proxy-mode]]
- [[concepts/structured-memory-engine]]
- [[concepts/memory-approval]]
