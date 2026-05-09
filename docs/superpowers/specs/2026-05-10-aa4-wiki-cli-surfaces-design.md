---
title: AA4 — wiki/entities/cli.md schema-derived surface table
date: 2026-05-10
risk: LOW
status: approved
---

# AA4 — Wiki CLI schema-derived surface table

## Problem

`wiki/entities/cli.md` mentions PRs #22, #23, and #25 in the Risk
section but does not document WHICH closed-set surfaces are now
schema-derived vs hand-mirrored. A future agent reading the wiki
cannot answer: "which CLI help strings auto-update when I add a
member to `agentIdSchema`?" without reading the source code.

## Decision

**D1 — Single combined section with a table (not one subsection per
closed-set).**
The 4 closed-sets follow an identical pattern; a table communicates
parallelism at a glance. A short narrative beneath covers the shared
"why" once. Separate subsections would repeat the same framing 4×
without adding information.

**D2 — Placement: between "Boundary rules" and "Risk".**
The new section is operational knowledge (how closed-sets behave,
what auto-updates), which fits after structural rules and before
the PR audit trail.

**D3 — Only `wiki/entities/cli.md` is touched.**
No code change. No other wiki page needs updating (the table is
specific to the CLI entity).

## New section content (draft)

### Closed-set surface derivation

| Closed enum / set | Source schema | Derived surfaces |
|---|---|---|
| `agentIdSchema` | `@megasaver/shared` | `invalidAgentMessage` error text (PR #22); `--agent` description on `session create` / `session update` (PR #23) |
| `riskLevelSchema` | `@megasaver/shared` | `invalidRiskMessage` error text (PR #22); `--risk` description on `session create` / `session update` (PR #23) |
| `memoryScopeSchema` | `@megasaver/shared` | `invalidScopeMessage` error text (PR #22); `--scope` description on `memory create` (PR #23) |
| `KNOWN_TARGETS` (registry) | `apps/cli/src/known-targets.ts` | `KNOWN_TARGET_IDS` derivation; `invalidTargetMessage` error text (PR #22); `--target` description on `connector sync` / `connector status` (PR #25) |

**Why it matters:** adding a member to any source schema or registry
auto-updates ALL derived surfaces (error messages and `--help` text)
without manual mirroring. The "Keep in sync with X in Y" comments
that previously annotated these sites were removed across PRs #22,
#23, and #25.

**Drift-guard test pattern:** each derived string is locked with a
`toBe` pinned-format assertion (not `toContain`) that catches both
member drift and format drift. Introduced in PR #23; extended to
`KNOWN_TARGET_IDS` in PR #25.

## Definition of Done

- New "Closed-set surface derivation" section present in
  `wiki/entities/cli.md` between "Boundary rules" and "Risk".
- Table lists all 4 closed-sets with correct PR references.
- Narrative covers: auto-update promise, comment removal, `toBe`
  drift-guard pattern.
- `pnpm verify` GREEN (no code changes; lint passes on markdown).
- Manual check: section renders cleanly in the file; no broken links.
