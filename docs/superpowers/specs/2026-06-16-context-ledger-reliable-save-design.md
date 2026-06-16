---
title: Context Ledger Reliable Save Architecture
date: 2026-06-16
status: superseded-by-split-specs
risk: HIGH
risk_note: >
  This design changes the trust boundary for saving project memory and for
  building compact context. It touches memory correctness, secret handling,
  evidence retention, agent-facing projections, and token-saver metrics.
branch: codex/context-ledger-architecture
related:
  - wiki/concepts/agent-agnostic-core.md
  - wiki/concepts/context-gate-pipeline.md
  - wiki/concepts/proxy-mode.md
  - wiki/concepts/structured-memory-engine.md
  - wiki/concepts/memory-approval.md
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
---

# Context Ledger Reliable Save Architecture

## 0. Status

This draft is retained as the original umbrella architecture discussion. It is
**not** the implementation source of truth after external review. The design is
split into two narrower specs:

- `docs/superpowers/specs/2026-06-16-contextgate-honest-90-design.md`
  covers ContextGate token reduction, honest metrics, sufficiency counters,
  adoption metrics, retention, and evidence revocation.
- `docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md`
  covers reliable save, Phase 10 approval reconciliation, validation, conflict
  checks, MCP leak prevention, and connector projection safety.

Do not write an implementation plan from this umbrella file. Plan from the split
specs after they pass review.

## 1. Problem

MegaSaver can reduce tokens only when raw material passes through a
MegaSaver-controlled path before the model ingests it. Proxy Mode already proves
the right direction: proxy tools and saver hooks can return summaries, excerpts,
and expansion handles while the full output remains local.

That is not enough for the next product bar. The main risk is **bad saves**:

- a false fact is written as project memory;
- old memory is overwritten or contradicted silently;
- secrets or sensitive output are saved;
- agent connector files are rendered from bad state;
- token savings are claimed from the wrong path, such as native truncation.

The user-facing target is: **save reliably while keeping average model context
near one tenth of the raw eligible context**. The architecture must make `save`
a validated commit pipeline, not a direct write.

## 2. Goal

Design a local-first, agent-agnostic Context Ledger that:

1. keeps full evidence locally and immutably;
2. reduces proxy-mediated eligible context to about 10% of raw tokens on
   average, with honest metrics;
3. prevents agents from directly committing memory;
4. allows commit only after evidence, secret, conflict, and projection gates
   pass;
5. quarantines uncertain saves as suggestions instead of exposing them to
   agents;
6. renders agent config files only from approved projections;
7. supports replay, audit, and rollback for every committed memory.

## 3. Non-goals

- Building a hosted sync service, auth service, or cloud team product.
- Replacing the current TypeScript monorepo or rewriting the CLI in another
  language.
- Making MegaSaver a model proxy.
- Depending on an LLM to decide whether a save is true. Agents may propose
  candidate memory; MegaSaver validates and gates it deterministically.
- Claiming 90% savings for native agent truncation, tiny passthrough outputs, or
  paths that did not use MegaSaver mediation.

## 4. Product Claim

MegaSaver should be able to say:

> "MegaSaver keeps coding agents near one tenth of the raw context by returning
> compact, evidence-linked context, and it only saves memory after evidence,
> secret, conflict, and projection checks pass."

This intentionally differs from a pure output proxy. DFMT-style replacement
shows the hot-path lesson, but MegaSaver's differentiator is the save ledger:
memory is committed from verifiable evidence, not from agent confidence.

## 5. Architecture

```text
Read / Search / Command / Agent Save Request
  -> Context Gateway
  -> Redact + classify + compress
  -> Evidence Ledger append
  -> Candidate Memory Builder
  -> Save Validator
  -> Conflict Checker
  -> Approval Policy
  -> Committed Memory Store
  -> Agent Projection Builder
```

The **Context Gateway** is the hot path. It should prefer `proxy_*` MCP tools
and treat hooks as fallback/telemetry. The **Evidence Ledger** is the durable
source for all facts that might later become memory. The **Committed Memory
Store** is the small trusted view consumed by agents.

Agent-facing connector files (`CLAUDE.md`, `AGENTS.md`, Cursor rules, Aider
conventions) are projections. They are never the source of truth.

## 6. Components

### 6.1 Context Gateway

Purpose: make raw tool output pass through MegaSaver before it reaches the
model.

Inputs:

- file reads;
- code search;
- shell command output;
- existing PostToolUse fallback output;
- explicit save requests from agents.

Behavior:

- applies command/path policy before executing reads or commands where
  MegaSaver controls execution;
- redacts secrets before persistence or returned text;
- classifies output as test, typecheck, search, diff, generic shell, or
  unknown;
- chooses passthrough, light summary, or compressed result based on size and
  confidence;
- returns compact text plus expansion handles;
- records metrics only for paths MegaSaver actually mediated.

The default contract is:

- small output: passthrough, no fake savings;
- eligible large output: returned token budget is about 10% of raw tokens on
  average;
- omitted evidence remains locally expandable.

### 6.2 Evidence Ledger

Purpose: immutable local record of what MegaSaver saw and what it returned.

Shape:

- `evidenceId`;
- `workspaceKey`;
- `liveSessionId` or durable session id;
- `sourceKind`: file | command | grep | fetch | hook | manual | agent_request;
- `sourceRef`: path, command, query, hook tool, or manual label;
- `rawDigest`;
- `redactedRawChunkSetId`;
- `returnedDigest`;
- `returnedChunkRefs`;
- `classification`;
- `redactionReport`;
- `createdAt`;
- `policyVersion`;
- `pipelineVersion`.

Rules:

- append-only;
- redacted before persistence;
- no agent-specific fields in the ledger schema;
- enough metadata to replay the compression decision without storing raw text in
  traces;
- raw evidence is recoverable locally by chunk id, subject to policy.

This can be a new leaf package, `@megasaver/evidence-ledger`, with no dependency
on `@megasaver/core`. `@megasaver/context-gate` writes evidence events; Core
consumes evidence references when committing memory.

### 6.3 Memory Candidate Builder

Purpose: convert an agent request or repeated observed fact into a candidate,
not a committed memory.

Candidate shape:

- `candidateId`;
- `proposedBy`: agent | human | system;
- `type`: decision | architecture | bug | failed_attempt | project_rule |
  user_preference | dependency | test_behavior | todo | code_pattern;
- `claim`;
- `scope`;
- `relatedFiles`;
- `evidenceIds`;
- `confidence`;
- `expiresAt`;
- `keywords`;
- `supersedes`;
- `createdAt`.

Agents may call `save_memory`, but that call creates a candidate. It does not
create approved memory directly.

### 6.4 Save Validator

Purpose: deterministic gate before a candidate can be committed.

Checks:

- schema is valid;
- at least one evidence id exists for non-human candidates;
- every evidence id exists and belongs to the same workspace;
- secret redaction report has no unresolved high-risk finding;
- source path is not denied by policy;
- candidate scope is legal;
- content length and title are bounded;
- claim is self-contained and not just a transcript fragment;
- expiry is present for time-sensitive facts;
- related files are safe project-relative paths;
- confidence is not higher than the evidence supports.

Outcomes:

- `valid`;
- `needs_approval`;
- `quarantined`;
- `rejected`.

The conservative rule: when a check is ambiguous, downgrade to
`needs_approval` or `quarantined`, never auto-approve.

### 6.5 Conflict Checker

Purpose: prevent silent overwrite and contradictory memory.

Checks:

- duplicate claim;
- same file/symbol with different conclusion;
- existing active memory superseded without explicit `supersedes`;
- stale memory still projected to agents;
- incompatible project rules;
- repeated rejected candidate pattern.

Conflict outcomes:

- exact duplicate: link to existing memory, do not commit another copy;
- supersession candidate: require explicit supersedes relation;
- contradiction: quarantine for human review;
- safe independent fact: continue.

Updates are append-only revisions. No memory row is overwritten in place for
meaning changes.

### 6.6 Approval Policy

Purpose: decide whether a valid candidate enters agent context.

Default policy:

- human manual save: `approved`, after validator passes;
- agent save with strong evidence and no conflicts: `suggested` by default in
  v1, optionally auto-approved only behind a workspace policy flag;
- agent save with weak evidence: `quarantined`;
- secret risk: `rejected` or `quarantined`, depending on severity;
- conflict: `suggested` with conflict reasons, not projected.

The existing `approval: suggested | approved | rejected` model is preserved, but
this design adds a stronger pre-approval candidate stage so bad memory does not
even look like normal memory until it passes validation.

### 6.7 Committed Memory Store

Purpose: trusted memory consumed by retrieval and connectors.

Committed memory records:

- carry the accepted claim;
- reference evidence ids;
- carry approval state;
- carry revision chain metadata;
- carry conflict/supersession links;
- carry created/approved timestamps and actor type;
- are never hard-deleted by ordinary flows.

Reads used by agents only return approved, active memory. Review/audit commands
may opt into candidates, rejected entries, and superseded revisions.

### 6.8 Agent Projection Builder

Purpose: safely render connector files from committed memory.

Rules:

- projection reads only approved active memory;
- projection output is generated from structured entries, not freeform raw
  transcript;
- sentinel block writes are parsed before and after render;
- malformed projection aborts the write;
- writes are atomic;
- connector-specific formatting stays outside Core;
- all connector targets receive the same semantic memory.

This addresses config corruption separately from memory correctness. A memory
can be valid but still fail projection; in that case the store remains intact
and the connector write is rejected.

## 7. Token Reduction Target

The 90% target applies to **eligible MegaSaver-mediated context**, not to every
byte printed by every tool.

Definition:

- eligible: proxy or saver path, text output, raw tokens above the configured
  threshold;
- savings: `1 - returnedTokens / rawTokens`;
- target: rolling average `returnedTokens <= 0.10 * rawTokens` for eligible
  large outputs, while preserving enough evidence to act correctly;
- passthrough: small outputs are counted separately and do not create fake
  positive savings.

The returned payload should normally contain:

- one compact summary;
- top evidence excerpts;
- failure/test/typecheck essentials;
- paths and line references when available;
- chunk ids for expansion;
- a clear note that more evidence exists locally.

The ledger keeps the full recoverable evidence so the model can expand only what
is needed.

## 8. Save Safety Invariants

These are hard design constraints:

1. No agent can directly create approved memory through the public MCP surface.
2. No non-human candidate can commit without evidence.
3. No candidate with unresolved secret findings can enter agent context.
4. No semantic update overwrites an existing memory row in place.
5. No conflicted candidate is auto-approved.
6. No rejected or quarantined candidate appears in connector projections.
7. No projection write occurs if the rendered agent file fails sentinel/schema
   validation.
8. No token-saving metric is counted unless MegaSaver mediated the path.
9. Every committed memory can answer: why was this saved, from what evidence,
   and by which policy version?

## 9. Package Boundaries

Proposed package shape:

- `@megasaver/evidence-ledger`: schemas, append/read APIs, replay metadata,
  digest helpers. No Core dependency.
- `@megasaver/context-gate`: writes evidence events while filtering output.
- `@megasaver/core`: memory candidates, validation, conflict checks, approval
  transitions, committed memory reads.
- `@megasaver/mcp-bridge`: exposes candidate-based `save_memory` and
  evidence-aware retrieval tools.
- `@megasaver/connectors-shared`: renders approved memory projections.
- agent-specific connector packages: file locations and agent formatting only.

Core remains agent-agnostic. Connectors remain thin adapters.

## 10. CLI And MCP Surface

New or changed conceptual surface:

- `save_memory`: creates a candidate, not approved memory.
- `approve_memory`: promotes a candidate or suggested memory after validation.
- `reject_memory`: rejects a candidate or suggested memory.
- `mega memory candidates`: list pending/quarantined candidates.
- `mega memory explain <id>`: show evidence, policy, conflicts, and projection
  status.
- `mega evidence show <evidenceId>`: inspect redacted evidence metadata and
  expansion handles.
- `mega audit save`: report candidate counts, approvals, rejections, conflicts,
  secret blocks, and projection failures.

Existing memory search/retrieval remains approved-memory-first.

## 11. Error Handling

Errors should fail closed:

- evidence missing: candidate is quarantined;
- validation error: candidate is rejected or quarantined with reason;
- conflict: candidate requires approval;
- projection render error: committed memory remains, connector write aborts;
- ledger append failure: tool output may still return compressed text, but no
  memory candidate can reference that missing evidence;
- redaction failure: passthrough may happen only when no persistence/save occurs;
  persisted evidence and memory save fail closed.

No silent retry. The first failure reason is recorded for audit.

## 12. Testing Strategy

This feature is HIGH risk and requires the full project process before
implementation. Test coverage should be broader than a normal feature.

Required test classes:

- schema/backfill tests for evidence, candidate, and committed memory;
- validator unit tests for every fail-closed rule;
- conflict-checker tests for duplicate, supersession, contradiction, and safe
  independent facts;
- redaction tests proving unresolved secrets cannot be saved or projected;
- approval tests proving agent saves do not become approved by default;
- projection tests proving rejected/quarantined memory never reaches connector
  files;
- atomic projection write tests;
- MCP tests proving `save_memory` returns candidate status and never approved
  memory directly;
- token metrics tests proving passthrough does not claim savings;
- replay tests proving a committed memory can be explained from evidence ids.

Acceptance evidence:

- `pnpm verify`;
- an end-to-end flow: proxy command -> evidence ledger -> candidate -> approval
  -> memory retrieval -> connector projection;
- an adversarial flow: false/conflicting/secret candidate stays out of agent
  context;
- metrics report showing eligible proxy-mediated output near the 10% returned
  target on synthetic large outputs.

## 13. Rollout

Recommended phased build:

1. Evidence Ledger package and event writes from Context Gateway.
2. Candidate Memory Store and `save_memory` candidate behavior.
3. Validator and conflict checker.
4. Approval policy and review CLI.
5. Projection hardening for agent files.
6. Metrics and replay audit.
7. Optional auto-approval policy for low-risk candidates after fixture evidence.

The first GA slice should keep auto-approval off for agent saves. That makes the
system useful immediately without risking the core promise.

## 14. Open Decisions

1. Whether the Evidence Ledger is a new package or an extension of
   `@megasaver/content-store`. Recommendation: new leaf package, because
   evidence events are not just raw chunks.
2. Whether low-risk agent candidates can be auto-approved in v1. Recommendation:
   no; add policy flag later after adversarial fixtures.
3. Whether projection validation should live in `connectors-shared` or each
   connector. Recommendation: shared semantic validator plus per-connector
   formatter tests.

## 15. Approval

The user approved the design direction on 2026-06-16:

> "hepsi ama main focus save olmali ortalama 10 da 1 kadar token tuketmeli yani
> yuzde 90 yakin save"

This spec captures that as: save reliability first, with a measured 90%
reduction target for eligible MegaSaver-mediated context.
