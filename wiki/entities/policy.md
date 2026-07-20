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

Fix: a two-branch leading lookbehind. Branch 1, `(?<![A-Za-z0-9_-])`, is the
performance guard — inside a dotless run every `eyJ` after the first is preceded
by a class character and is rejected before any scanning, collapsing O(n)
useless starts to O(1). 313 KiB: 8,374 ms → 0.45 ms.

Branch 2, `(?<=%[0-9A-Fa-f][0-9A-Fa-f])`, was added by amendment 2026-07-20b.
Branch 1 alone silently lost every percent-escaped carrier, because every hex
digit is itself a base64url character — so URL query strings and fragments, among
the most common places a JWT appears in agent output, stopped redacting. All 512
`%XY` forms were verified: 0/512 redact under branch 1 alone, 512/512 with
branch 2. The recovery is nearly free precisely because `%` sits OUTSIDE the run
class, so it terminates the dotless run and each admitted start costs O(its own
token): 0.32 ms per 313 KiB, ~2.0x per doubling to 1 MiB+. The original
rejection of a hybrid alternation at 49.7 ms does not transfer — that
measurement was for a branch after `-`/`_`, which are INSIDE the class and
therefore still scan.

**Corrected severity (2026-07-20b): ordinarily reachable.** An earlier revision
of this page classified the blowup as "adversarially reachable, not ordinarily
reachable". Measurement refutes that, and the reasoning behind it used the wrong
population: base64 of *JSON* is not random. JSON objects begin `{"`, which
encodes to `eyJ`, so every encoded JSON value contributes an `eyJ` at a
predictable alignment, and encoded-JSON payloads are routine in agent output.

What decides the cost is whether the text forms one long dotless run of
`[A-Za-z0-9_-]`. Measured at 320 KiB against the pre-fix pattern:

| shape | longest run | pre-fix | fixed |
|---|---|---|---|
| base64 (`+/`), newline-separated | 94 | 0.8 ms | 0.45 ms |
| base64 (`+/`), no separator | 11,866 | 5.6 ms | 0.46 ms |
| base64url (`-_`), newline-separated | 94 | 0.4 ms | 0.45 ms |
| **base64url (`-_`), no separator** | 327,680 | **575.9 ms** | **0.31 ms** |

The vector is **base64url with no separator**, and it scales cleanly
quadratically: 85 / 171 / 341 / 683 KiB costs 40.6 / 165.6 / 637.6 / 2,555.5 ms.
This is an ordinary shape, not a crafted one — `Buffer.toString("base64url")` of
any JSON payload produces it, and a single-line log record carrying one long
base64url field is exactly this. Standard base64 and any newline wrapping are
both benign, which is the honest boundary of the claim.

**Two examples that do NOT hold**, recorded so they are not cited again:
Kubernetes Secrets and Docker `config.json` auth blobs. Both use *standard*
base64, whose `+` and `/` break the run, and both are newline-wrapped in
practice; at ~320 KiB they measure 1.0 ms and 2.1 ms under the pre-fix pattern.

No effective size cap sits in front of redaction: the high-volume sinks redact
the full raw capture before any truncation, and the caps that do exist (20 MB
capture ceiling, 16 MB daemon body limit) sit far above the 683 KiB that already
costs 2.5 s. Still CRITICAL-tier for the original reason too: the redactor
processes untrusted agent output, tool results, and Hot Handoff packets authored
elsewhere.

Accepted trade-off, corrected scope: a JWT glued to a **raw** base64url
character no longer redacts — exactly those 64 bytes, confirmed by a 256-byte
predecessor sweep in which the other 192 admit. The concrete shapes are
`session-<jwt>`, `id_token_<jwt>`, `Bearer<jwt>` with no space,
`ghs_<body>_<jwt>`, base64-run glue, and the escaped-equals forms `\x3d` /
`\u003d` (whose predecessor byte is `d`). **No other detector covers any of
them** — run through the full sequential-replacement pipeline, every one leaves
the complete signature in cleartext. `ghs_` is the sharpest: `github_token`
fires, so findings are non-empty and the leak is easy to miss, but it redacts
only the prefix. `&#61;` is NOT in this class — its predecessor is `;`, a
preserved delimiter — and an earlier grouping of it with the percent forms was
wrong.

The `-` and `_` must stay in branch 1's class: narrowing to `(?<![A-Za-z0-9])`
recovers `session-` and `id_token_` and restores the quadratic with them
(7,728 ms / 7,416 ms at 313 KiB). Two rejected alternatives were measured, not
assumed: segment-length bounds are 40x slower *and* drop a 3 KB x5c header and a
16 KB ID token entirely; atomic-group emulation is byte-identical but does not
fix the performance (5,870 ms), because the cost is scanning at every start, not
the backtracking.

The BB3 §5a lock table was amended with a footnote naming the spec, since that
table is where the lock is declared and it records the pattern verbatim; a
second footnote records amendment 2026-07-20b.

`test/redact-jwt.test.ts` was rebuilt after mutation testing showed the shipped
suite killed all five structural mutants through ONE assertion — a
`pattern.source` prefix string match, which tests no behaviour and breaks on the
amended pattern. Root cause of the blindness: the corpus held only 47 of the 64
base64url characters and no `-` or `_` in ANY segment, so narrowing a segment
class to `[A-Za-z0-9]` was invisible. The suite now carries a two-branch
structural gate, a `.flags === "g"` gate, a fixture whose every segment contains
`-` and `_`, an `alg:none` token, a two-JWT input, four percent-carrier cases, a
313 KiB timing gate across four seeds (`eyJaA0`, `-eyJaA`, `_eyJaA`, `%3DeyJaA`
— the middle two catch the narrowing edit; the last guards branch 2 and does NOT
discriminate the narrowing), six non-match assertions, and 21 frozen equivalence
cases. All six mutants (drop `/g`, narrow each of the three segment classes,
length-bound the segments, narrow the lookbehind) were verified to turn the
suite red, each behaviourally rather than via the source-prefix check.

Released as **minor**, not patch: the public API is unchanged, but redaction
coverage was reduced and that must be visible at release. policy@1.3.0.

Sources: [[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]],
[[docs/superpowers/specs/2026-05-10-bb3-policy-design]].
