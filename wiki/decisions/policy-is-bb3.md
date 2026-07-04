---
title: '@megasaver/policy ships at BB3, not the v0.9 roadmap'
tags: [decision, policy, security, aa1, locked]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: locked
created: 2026-05-11
updated: 2026-05-11
---

# Policy is a v0.5 package (BB3), not v0.9 Advanced

**Canonical target version: `@megasaver/policy` ships at BB3 = v0.5.** The
"v0.9" figure in this page refers only to the *rejected* original plan; it is
never a target for policy. Wherever v0.5 and v0.9 both appear, v0.5 is the ship
version and v0.9 is the superseded proposal (source: AA1 §2b).

**Locked (AA1 §2b).** `@megasaver/policy` ships as the third sub-PR of
the AA1 epic (BB3, PR #69, `61efb28`) — a real v0.5 package, NOT the
v0.9 Advanced-roadmap item the source plan (L1180–L1247) filed it
under.

## Why

The original plan tucked ALLOWED_COMMANDS / DANGEROUS_PATTERNS / the
redaction set into v0.9. But two downstream consumers need the policy
surface much earlier:

- `@megasaver/output-filter` (BB5) MUST `redact` secrets BEFORE
  `@megasaver/content-store` persists chunks (plan L1248).
- `mega output exec` (BB7b) and `mega_run_command` (BB8) MUST consult
  `evaluateCommand` BEFORE spawning a child process.

Deferring policy to v0.9 would force those consumers to either import
it via a deferred TODO or hard-code their own copy — both violate
`CLAUDE.md` §13 (no half-implementations, no premature abstraction).

## What this locks in

- Single Zod-validated, tuple-pinned source of truth shared by all
  consumers (see [[entities/policy]]).
- The v0.9 `.megasaver/permissions.yaml` becomes a per-project
  override layered ON TOP of the v0.5 baseline — same API, additional
  ruleset, not a redesign.
- BB3 ships with NO permissions-file stub (F-MED-4): pre-1.0 there is
  no consumer, so a stub returning `null` would only drift.
  `loadProjectPermissions` / `ProjectPermissions` are not exported;
  only the MCP `policy_load_failed` error-code slot is reserved.
- Risk HIGH: the deny-list IS the contract; `architect` + `critic`
  adversarial review mandatory per `CLAUDE.md` §12.

## Related

- [[entities/policy]] — the shipped surface.
- [[concepts/context-gate-pipeline]] — where the gates fire.
- [[concepts/risk-aware-development]] — HIGH-risk gating.
