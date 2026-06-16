---
title: Reliable Save Ledger Design
date: 2026-06-16
status: draft
risk: HIGH
risk_note: >
  This design defines the save-reliability half of Context Ledger Architecture.
  It changes the save_memory trust contract, approval reconciliation, memory
  validation, conflict handling, and connector projection safety.
branch: codex/context-ledger-architecture
related:
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
  - docs/superpowers/specs/2026-06-16-evidence-ledger-interface-design.md
  - docs/superpowers/specs/2026-06-16-contextgate-honest-90-design.md
  - wiki/concepts/structured-memory-engine.md
  - wiki/concepts/memory-approval.md
  - wiki/concepts/agent-agnostic-core.md
---

# Reliable Save Ledger Design

## 1. Problem

The most dangerous MegaSaver failure mode is a bad save: false memory, stale
memory, conflicting memory, secret-bearing memory, or memory that renders broken
agent configuration. The existing Phase 10 approval model is the right baseline:
agent `save_memory` creates `approval: "suggested"` memory and human approval is
required before agent-facing context sees it.

This design strengthens that model without replacing it with a parallel
candidate system.

## 2. Goal

Define a save pipeline where:

1. agent `save_memory` preserves the Phase 10 contract by creating a suggested
   `MemoryEntry`;
2. suggested memory is the candidate stage;
3. approval runs validation and conflict checks before flipping to approved;
4. unapproved memory and raw evidence cannot leak through agent-facing MCP
   retrieval;
5. connector projections are validated per connector type before atomic writes;
6. every approved memory can explain its evidence status and policy decision.

## 3. Reconciliation With Phase 10

There is no separate `candidateId` entity in the first implementation.

The candidate stage is:

```text
MemoryEntry.approval === "suggested"
```

`save_memory` continues to create a `MemoryEntry` row with
`approval: "suggested"`. The new behavior is that the row also carries validation
metadata or has a sidecar validation record keyed by `memoryEntryId`.

`approve_memory` continues to promote an existing row to `approval: "approved"`,
but it must first run:

1. schema validation;
2. evidence checks;
3. secret checks;
4. conflict checks;
5. projection safety preflight where possible.

Existing Phase 10 rows reconcile as follows:

- legacy `approved` rows remain approved and may have empty `evidenceIds` with
  `evidenceStatus: legacy_untracked`;
- legacy `suggested` rows remain suggested and require validation before
  approval;
- legacy `rejected` rows remain rejected and are never projected.

This avoids a silent data-model break and keeps the shipped MCP surface stable.

## 4. Suggested Memory Validation Metadata

Each suggested memory has either inline metadata or a sidecar:

- `validationStatus`: unvalidated | valid | needs_approval | quarantined |
  rejected;
- `validationReasons`;
- `evidenceIds`;
- `conflictIds`;
- `projectionPreflight`;
- `policyVersion`;
- `validatedAt`;
- `validatedBy`: system | human;
- `evidenceStatus`: available | retained_metadata_only | revoked |
  legacy_untracked.

The implementation plan decides inline-vs-sidecar after inspecting current
schemas. If a sidecar is used, the memory row and sidecar must commit atomically
or through an explicit pending/rollback state; partial validation metadata must
not make a suggested memory appear approved or review-complete. The contract is
stable: suggested memory is reviewable, explainable, and blocked from projection
until approved.

## 5. Evidence Rules

Non-human memory needs at least one evidence reference unless explicitly marked
`legacy_untracked`. Evidence references must:

- belong to the same canonical workspace;
- be post-redaction;
- not be tombstoned for secret revocation;
- not be policy-denied for the current read;
- be either raw-expandable or metadata-explainable.

Digests are computed over post-redaction content only. Pre-redaction hashes are
not stored because they can become equality or presence oracles for secrets.
The canonical evidence schema and retention/revocation fields are owned by
`docs/superpowers/specs/2026-06-16-evidence-ledger-interface-design.md`.

## 6. Workspace Identity

Validation uses a canonical `workspaceKey` derived from the project root. A
`liveSessionId` may be present for overlay stats, but it is not the workspace
authority. Evidence and memory may share a workspace when their canonical
workspace keys match.

This prevents cross-workspace leaks and avoids false rejects when different live
sessions contribute evidence to the same project.

## 7. Save Validator

The validator is deterministic and fail-closed.

Hard checks:

- schema is valid;
- non-human suggested memory has acceptable evidence;
- no unresolved secret finding exists;
- related files are project-relative and allowed by policy;
- scope is legal;
- bounded title/content length;
- time-sensitive claims have `expiresAt`;
- approval actor is authorized by local policy.

Advisory semantic checks:

- transcript-fragment detection;
- confidence appears higher than evidence supports;
- likely duplicate;
- likely contradiction;
- likely supersession.

Advisory semantic checks use deterministic heuristics such as normalized claim
overlap, shared related files/symbols, opposite-keyword sets, rule type, and
existing active memory proximity. They do not prove truth. A positive advisory
check sends the memory to `needs_approval` or `quarantined`; it never silently
approves or rewrites.

## 8. Conflict Checker

Conflict checks compare suggested memory against approved active memory in the
same workspace.

Outcomes:

- exact duplicate: keep existing approved memory; mark suggested row as rejected
  with duplicate reason or link it to existing memory;
- supersession: require explicit `supersedes` relation before approval;
- likely contradiction: quarantine for human review;
- unrelated fact: continue.

No semantic update overwrites an existing memory row in place. Meaning changes
create a revision/supersession relation.

Approval is serialized per workspace or protected by compare-and-swap over the
memory/revision set. Two conflicting suggested memories cannot both approve from
stale conflict checks.

## 9. Approval Policy

Default policy:

- human `mega memory create`: approved after hard validation;
- agent `save_memory`: suggested by default;
- agent suggested memory with hard-check failure: rejected or quarantined;
- agent suggested memory with advisory conflict: needs human approval;
- auto-approval is off by default.

If a future workspace policy enables auto-approval for low-risk memories, it
still cannot bypass:

- secret checks;
- hard evidence checks;
- conflict checks;
- projection safety rules.

## 10. MCP Leak Rules

Agent-facing MCP retrieval must never return:

- unapproved candidate/suggested memory claims;
- rejected memory claims;
- quarantined memory claims;
- raw evidence for suggested/rejected/quarantined memory;
- arbitrary ledger evidence by id.

Agent-facing retrieval returns approved active memory only. Human review surfaces
are CLI or GUI review surfaces with explicit `includeUnapproved` behavior.

This rule applies to `get_project_context`, `mega_recall`,
`search_memory`, `get_relevant_memories`, context packs, connector sync, and any
future evidence-aware tool.

## 11. Projection Validation Matrix

Projection validation is connector-specific:

| Target | File shape | Validation |
|--------|------------|------------|
| Claude Code | `CLAUDE.md` sentinel block | parse sentinel before/after render; preserve outside text |
| Codex | `AGENTS.md` sentinel block | parse sentinel before/after render; preserve outside text |
| Cursor | `.cursor/rules/*.mdc` frontmatter + sentinel | preserve frontmatter; parse sentinel block |
| Aider | `CONVENTIONS.md` full generated file | validate whole-file render; no sentinel assumption |
| Gemini | `GEMINI.md` full or block target per connector manifest | validate against target manifest, not hard-coded sentinel rules |
| Windsurf | `.windsurfrules` target | validate against target manifest |
| Continue | `.continue/rules/megasaver.md` target | validate against target manifest |

All targets render from the same approved semantic memory. A projection failure
aborts only that connector write; it does not corrupt the store.

Projection validation lives in `@megasaver/connectors-shared` and the
agent-specific connector packages. Core remains agent-agnostic: it stores
approved semantic memory and validation status, but it does not know
`CLAUDE.md`, `AGENTS.md`, Cursor, Aider, Gemini, Windsurf, or Continue file
formats.

## 12. Evidence Retention And Replay

Approved memory explanations support three evidence states:

- `available`: evidence metadata and expandable redacted chunks exist;
- `retained_metadata_only`: raw chunks were GC'd, but metadata explains source,
  digest, policy, and retention reason;
- `revoked`: evidence was tombstoned for secret/user purge and raw chunks are
  unavailable.

Evidence referenced by approved memory is pinned against ordinary retention GC.
Secret revocation can still remove raw chunks. In that case replay becomes
metadata-only and must say so explicitly.

The invariant is not "every memory can always replay raw evidence." The invariant
is: every approved memory can explain its evidence status and policy trail.

## 13. CLI And MCP Surface

Changed behavior:

- `save_memory`: creates suggested `MemoryEntry`, never approved memory.
- `approve_memory`: validates, conflict-checks, then approves or returns reasons.
- `reject_memory`: rejects suggested memory with a reason.
- `mega memory explain <id>`: shows approval, validation, evidence status,
  conflicts, projection status, and policy version.
- `mega memory review`: lists suggested/quarantined/rejected rows for humans.

Agent-facing search remains approved-memory-first. Human review commands can opt
into unapproved rows.

## 14. Error Handling

Errors fail closed:

- missing evidence: cannot approve non-human memory;
- redaction uncertainty: quarantine or reject;
- conflict: needs human approval;
- projection preflight failure: memory may remain suggested; connector write
  aborts;
- evidence revoked: memory is not automatically deleted, but future retrieval
  includes evidence status and may lower confidence.

No silent retry. First failure reason is recorded.

## 15. Testing

Required tests:

- `save_memory` creates suggested memory, never approved;
- `approve_memory` rejects missing evidence for non-human memory;
- legacy approved rows with no evidence remain readable as `legacy_untracked`;
- unapproved memory is excluded from all agent-facing MCP tools;
- unapproved memory is excluded from all connector targets;
- secret-revoked evidence blocks approval and expansion;
- deterministic duplicate/conflict heuristics quarantine;
- projection validation covers Claude, Codex, Cursor, Aider, Gemini, Windsurf,
  and Continue target shapes;
- approved memory explain works for available, metadata-only, revoked, and
  legacy evidence states.

Acceptance evidence:

- `pnpm verify`;
- adversarial save fixture: false/conflicting/secret candidate never reaches
  agent context;
- connector projection fixture across every target shape;
- manual smoke: proxy command -> evidence -> `save_memory` suggested ->
  `approve_memory` -> approved retrieval -> connector sync.
