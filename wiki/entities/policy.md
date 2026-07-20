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

## v1.1 / post-v1.0 (2026-06-03)

**PR #96 — Project permissions (HIGH/security):**

`.megasaver/permissions.yaml` support shipped. Four invariants enforced
by `parseProjectPermissions` (pure, Zod-validated):

1. **Tighten-only** — project rules may only deny, never allow beyond
   the base policy.
2. **Deny-precedence** — a project deny overrides any allow.
3. **Fail-closed** — parse failure is a deny (not a pass-through).
4. **Path-glob** — path rules are glob-matched against resolved paths.

New public exports (in `packages/policy/src/index.ts`):
- `parseProjectPermissions(raw: unknown): ProjectPermissions` — pure
  Zod parse of the YAML-deserialized object; throws on invalid shape.
- `ProjectPermissions` type + `projectPermissionsSchema`.
- `policy_load_failed` added to `PolicyDenyCode` (closes the reserved
  slot documented in v0.5; `policyDenyCodeSchema` now 7 members).

I/O is the caller's responsibility: `context-gate.loadProjectPermissions`
reads the YAML file and calls `parseProjectPermissions` (yaml@^2).
Adversarially security-reviewed before merge. policy@1.1.0.

## jwt detector ReDoS fix (2026-07-20)

The LOCKED §9d `jwt` detector was quadratic. Root cause, established by
measurement rather than reading: every `eyJ` occurrence is a candidate start,
`[A-Za-z0-9_-]+` greedily consumes to the end of the class run, the mandatory
`\.` fails, and the engine backtracks one character at a time — so each start
costs O(remaining length) and there are O(n) starts. Isolating the variables
confirms it: 39 KiB with 6,800 starts costs 204 ms; the same 39 KiB with one
start costs 0.0 ms. The driver is start count, not run length.

An earlier note blamed "the separator is not excluded from the character
class". That is wrong — `[A-Za-z0-9_-]` does not match `.`, so excluding the
dot is a no-op.

Fix: one leading `(?<![A-Za-z0-9_-])`. Inside a dotless run every `eyJ` after
the first is preceded by a class character and is rejected before any scanning,
collapsing O(n) useless starts to O(1). 313 KiB: 8,374 ms → 0.45 ms.

**Corrected severity: adversarially reachable, not ordinarily reachable.** The
original follow-up claimed the blowup was reachable from ordinary base64-heavy
logs, citing 9.93 ms for a 24.6 KiB base64 run. Re-measured: 0.00 ms. Random
base64url contains `eyJ` with probability ≈ (1/64)³ ≈ 1/262,144 per position,
so a 24 KiB blob holds ~0.1 occurrences. Text full of *real* JWTs is also fast —
the dots satisfy `\.` immediately. The blowup needs many `eyJ` occurrences in
text containing no dots, which is a crafted payload. Still CRITICAL-tier: the
redactor processes untrusted agent output, tool results, and Hot Handoff
packets authored elsewhere, and a crafted payload stalls every sink.

Accepted trade-off: a JWT glued to `[A-Za-z0-9_-]` no longer redacts, so
`session-<jwt>` and `id_token_<jwt>` stay in cleartext. The `-` and `_` must
stay in the class — narrowing to `(?<![A-Za-z0-9])` recovers both and restores
the quadratic (7,494 ms / 7,561 ms at 313 KiB). Two rejected alternatives were
measured, not assumed: segment-length bounds are 40x slower *and* drop a 3 KB
x5c header and a 16 KB ID token entirely; atomic-group emulation is
byte-identical but does not fix the performance (5,870 ms), because the cost is
scanning at every start, not the backtracking.

The BB3 §5a lock table was amended in the same commit with a footnote naming
the spec, since that table is where the lock is declared and it records the
pattern verbatim. `test/redact-jwt.test.ts` carries a structural gate on
`pattern.source`, a 313 KiB timing gate across three seeds (`eyJaA0`, `-eyJaA`,
`_eyJaA` — the last two catch the narrowing edit), explicit non-match
assertions for the §5 shapes, and 14 frozen equivalence cases. policy@1.2.3.

Sources: [[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]],
[[docs/superpowers/specs/2026-05-10-bb3-policy-design]].
