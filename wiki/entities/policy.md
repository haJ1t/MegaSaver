---
title: '@megasaver/policy'
tags: [entity, package, policy, security, v0.5, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
status: active
created: 2026-05-11
updated: 2026-05-11
---

# `@megasaver/policy`

The security gate for the AA1 Context Gate pipeline. Command
allow/deny, path-read denial, and secret redaction live here so the
three downstream consumers (`output-filter`, `mega output exec`,
`mega_run_command`) share one Zod-validated source of truth.

Promoted to its own v0.5 package — NOT the v0.9 Advanced roadmap.
See [[decisions/policy-is-bb3]] for the rationale. Shipped BB3
(PR #69, `61efb28`). Risk HIGH (deny-list IS the contract).

## Public surface (`packages/policy/src/index.ts`)

- `evaluateCommand(input: EvaluateCommandInput): EvaluateCommandResult`
  — `{ allowed: true } | { allowed: false; reason: PolicyDenyCode }`.
  ALLOWED_COMMANDS allow-list (`src/allowed-commands.ts`) +
  DANGEROUS_PATTERNS deny-list (`src/dangerous-patterns.ts`), matched
  against the full rendered command-line
  (`[command, ...args].join(" ")`). Carries the `MEGASAVER_ORIGIN_PID`
  env-marker re-entry guard (F-CRIT-3): an inherited marker that
  differs from `String(process.pid)` denies with `recursive_megasaver`.
- `evaluatePathRead(input: EvaluatePathReadInput): EvaluatePathReadResult`
  — default-deny secret-path denylist (`src/secret-paths.ts`): `.env`,
  `.env.*`, `.ssh/**`, `.aws/credentials`, `*.pem`, `*.key`, `id_rsa`,
  `id_ed25519`, `service-account*.json`, … Added Revision 2 (F-CRIT-2).
- `redact(text: string): RedactResult` — `{ redacted, count }`
  (`src/redact.ts` + `src/redaction-patterns.ts`).
- `policyDenyCodeSchema` / `PolicyDenyCode` (`src/deny-code.ts`) —
  closed enum, 6 members alphabetic (AA3): `command_not_allowed`,
  `dangerous_pattern`, `intent_missing`, `path_denied`,
  `recursive_megasaver`, `secret_path_read`.

`loadProjectPermissions` / `ProjectPermissions` are deliberately NOT
exported (F-MED-4) — no v0.5 consumer; the v0.9 permissions-file spec
adds them. The MCP `policy_load_failed` error code (mcp-bridge §8b)
is the only slot reserved for that day.

## Boundary rules (§3c cycle guard)

- May depend on: `@megasaver/shared` only (`ProjectId`).
- MUST NOT depend on: `@megasaver/core`, `@megasaver/output-filter`,
  anything else. A `dependency-graph.test.ts` parses `package.json`
  and fails on any extra edge.

## Related

- [[decisions/policy-is-bb3]] — why policy is v0.5, not v0.9.
- [[concepts/context-gate-pipeline]] — where the gates fire in the flow.
- [[entities/output-filter]] — consumes `redact`; owns the regex corpus.
- [[entities/cli]] — `mega output` composes the two read gates.
