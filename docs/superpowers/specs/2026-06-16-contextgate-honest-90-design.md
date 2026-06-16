---
title: ContextGate Honest 90% Reduction Design
date: 2026-06-16
status: draft
risk: HIGH
risk_note: >
  This design defines the token-reduction half of Context Ledger Architecture.
  It changes the public savings claim, ContextGate metrics, evidence retention
  contract, and replay criteria. It must not blind the model to evidence.
branch: codex/context-ledger-architecture
related:
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
  - docs/superpowers/specs/2026-06-15-realized-saver-hook-design.md
  - docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md
  - wiki/concepts/context-gate-pipeline.md
  - wiki/concepts/proxy-mode.md
---

# ContextGate Honest 90% Reduction Design

## 1. Problem

MegaSaver should target roughly 90% reduction on large eligible context, but the
claim is unsafe unless it is measured honestly and paired with an evidence
sufficiency counter-metric. Optimizing only for `returnedTokens <= 10%` creates
the wrong incentive: the system can win the token number by omitting evidence
the agent needed.

This spec isolates the **ContextGate/token** half of the architecture. The
save/memory half is in
`docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md`.

## 2. Goal

Define a ContextGate path that:

1. returns about one tenth of raw tokens on eligible large outputs;
2. reports token savings with token-weighted math, not gameable averages;
3. reports how much total observed context was eligible;
4. reports proxy/hook adoption separately from savings;
5. co-gates token reduction with evidence-sufficiency metrics;
6. stores evidence in a revocable, retention-bounded ledger interface.

## 3. Naming

Use the shipped architecture name **ContextGate** for the orchestrator and code
surface. "Context Gateway" is not introduced as a new subsystem name. User-facing
copy remains "Mega Saver Mode" where existing docs use that term.

## 4. Eligibility

The 90% target applies only to **eligible MegaSaver-mediated large text output**.

An output is eligible when all are true:

- it was mediated by `proxy_*` tools or the realized saver hook;
- it is text output;
- it is above the configured large-output threshold;
- it is not rejected by policy or redaction;
- the compressor classified it with enough confidence to compress safely, or it
  falls back to the generic evidence-preserving compressor.

Small outputs are passthrough. Passthrough outputs are reported, but they do not
create positive savings.

## 5. Honest Metrics

The public reduction metric is token-weighted:

```text
eligibleReduction = 1 - (sum(returnedTokensEligible) / sum(rawTokensEligible))
```

The report must also include:

```text
eligibleTokenFraction = sum(rawTokensEligible) / sum(rawTokensObserved)
proxiedTokenFraction = sum(rawTokensProxyOrHook) / sum(rawTokensObserved)
passthroughTokenFraction = sum(rawTokensPassthrough) / sum(rawTokensObserved)
```

This prevents the system from raising eligibility thresholds until only the most
compressible giant outputs count.

Per-output ratios may still be shown for debugging, but they are not the headline
metric.

## 6. Evidence Sufficiency Counter-Metrics

The 90% target is not allowed to stand alone. A release must also report:

- `expandRate`: how often agents/users expand omitted chunks after a compressed
  response;
- `firstExpansionSuccessRate`: whether the first expansion retrieves useful
  evidence instead of requiring repeated probing;
- `failureEvidenceRecall`: fixture-based percentage of known failure essentials
  retained in the compressed output;
- `actionabilityFixturePassRate`: benchmark tasks where the compressed output
  still contains enough evidence to identify the next action;
- `secretBlockRate`: outputs blocked or downgraded because redaction/policy was
  not confident.

GA should require both:

```text
eligibleReduction >= 0.90
actionabilityFixturePassRate >= configured threshold
```

The exact threshold is set in the implementation plan after fixtures exist. The
design requirement is that sufficiency is measured and release-gated.

## 7. Adoption Metrics

Savings are meaningful only when MegaSaver is in the path. ContextGate reports:

- proxy calls by tool;
- saver-hook calls by native tool;
- native eligible calls observed by telemetry but not mediated;
- `mediatedEligibleFraction`;
- setup hints when adoption is low.

The product may say "90% reduction" only for mediated eligible context. It may
not imply whole-session savings unless the mediated eligible fraction is high
and reported beside the claim.

## 8. Evidence Ledger Interface

ContextGate writes evidence metadata through a ledger interface shared with the
save architecture:

- digests are computed over **post-redaction** content only;
- raw recoverable chunks are redacted before persistence;
- each evidence row has a retention policy;
- secret revocation can tombstone evidence and purge associated recoverable raw
  chunks;
- evidence referenced by approved memory is pinned against ordinary retention
  GC, but not against explicit secret revocation.

The ledger is semantically append-only for audit. It is not physically
unpurgeable. Raw chunks may be deleted for retention or secret revocation, while
the ledger keeps a tombstone event explaining why evidence is no longer
recoverable.

## 9. Redaction Revocation

Pattern redaction can have false negatives. Therefore the ledger needs an
explicit revocation path:

1. append `evidence_revoked` with reason `secret_false_negative` or
   `user_requested_purge`;
2. tombstone the evidence row for future retrieval;
3. delete or crypto-shred associated raw chunk material;
4. prevent `proxy_expand_chunk` and human evidence inspection from returning
   purged content;
5. preserve metadata needed to explain that evidence existed but was revoked.

This is the exception to physical immutability. Without it, a missed secret would
become unpurgeable local data.

## 10. Retention

Evidence rows carry:

- `createdAt`;
- `expiresAt`;
- `retentionClass`: transient | session | pinned | manual_hold;
- `pinnedByMemoryIds`;
- `revokedAt`;
- `revocationReason`.

Default retention is implementation-defined, but bounded. Large raw evidence
cannot grow without a size/age policy.

Pinned evidence referenced by approved memory is excluded from ordinary GC.
Secret revocation wins over pins; after revocation the memory explanation
degrades to metadata-only with `evidenceStatus: revoked`.

## 11. MCP Expansion Rules

Agent-facing expansion can retrieve chunks returned by the current mediated
ContextGate response, subject to policy and tombstone checks.

Agent-facing MCP tools must not provide arbitrary browsing of raw evidence,
candidate memory evidence, rejected memory evidence, or tombstoned chunks. Human
inspection of ledger metadata is a CLI/review surface, not a general agent tool.

## 12. Testing

Required test classes:

- token-weighted metric math;
- eligible fraction reporting;
- adoption fraction reporting;
- passthrough outputs do not claim savings;
- redaction revocation tombstones evidence and blocks expansion;
- retention GC does not delete pinned evidence;
- secret revocation overrides pins;
- fixture recall tests for test/typecheck/search/diff outputs;
- expansion metrics after compressed outputs.

Acceptance evidence:

- `pnpm verify`;
- synthetic large-output benchmark showing token-weighted
  `eligibleReduction >= 0.90`;
- fixture report showing evidence sufficiency does not regress;
- metric report includes eligible-token fraction and mediated-token fraction.

## 13. Relationship To Reliable Save

ContextGate produces evidence. Reliable Save consumes approved evidence
references. The save pipeline must not assume evidence remains raw-expandable
forever; it must handle `available`, `retained_metadata_only`, and `revoked`
evidence states.
