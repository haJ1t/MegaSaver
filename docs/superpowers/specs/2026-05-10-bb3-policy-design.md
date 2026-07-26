---
title: BB3 — @megasaver/policy package design
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB3
---

# BB3 — `@megasaver/policy` package

> Authority: the AA1 epic spec
> (`docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`)
> §9, §2b, §8a, §3, §17 governs this child spec. Where this file
> and the epic disagree, the epic wins. This file LOCKS the
> BB3 ship surface; it does not extend it.

---

## §0 Scope

New `@megasaver/policy` package (HIGH risk — security gate). The
deny-lists ARE the contract. Ships four public symbols and one
closed enum; nothing else:

- `evaluateCommand(input)` — command allow/deny gate with the
  `MEGASAVER_ORIGIN_PID` re-entry guard (epic §9a, F-CRIT-3).
- `evaluatePathRead(input)` — secret-path denylist gate
  (epic §9a, F-CRIT-2).
- `redact(text)` — secret redaction (epic §9a/§9d).
- `policyDenyCodeSchema` / `PolicyDenyCode` — closed alphabetic
  enum, 6 members (epic §9a/§17).

**Explicitly NOT in this package (epic §9a, §9e, F-MED-4):**

- No `loadProjectPermissions`. No `ProjectPermissions` type.
- No `.megasaver/permissions.yaml` parsing, no `null`-returning
  stub. The v0.9 spec that introduces the file owns that export.
- The MCP `policy_load_failed` error code lives in `mcp-bridge`
  (epic §8b), NOT here; it is reserved for v0.9 and out of scope.

This is a leaf package. It is consumed by `output-filter` (BB5),
`mcp-bridge` (BB8), and `mega output exec` (BB7b). BB3 ships the
package only — no consumer wiring (epic §2b, §14 "Blocks").

---

## §1 Dependency allow-list (epic §3c — MANDATORY)

| `@megasaver/policy` | May depend on       | MUST NOT depend on                       |
|---------------------|---------------------|------------------------------------------|
| runtime deps        | `@megasaver/shared`, `zod` | `@megasaver/core`, `@megasaver/output-filter`, `@megasaver/content-store`, `@megasaver/retrieval`, `@megasaver/stats`, `@megasaver/mcp-bridge`, and any other `@megasaver/*` |

`package.json` `dependencies` MUST be exactly
`{ "@megasaver/shared": "workspace:*", "zod": "^3.24.1" }`.
`devDependencies` MUST be
`{ "@types/node": "^22.19.17", "fast-check": "^3.23.2" }`
(`@types/node` is required because `evaluateCommand` reads
`process.pid` / `process.env`).

A `test/dependency-graph.test.ts` reads this package's own
`package.json` `dependencies` keys and asserts they are a subset
of `["@megasaver/shared", "zod"]` — failing if any forbidden
`@megasaver/*` slips in (epic §3c / F-MIN-1). This is the only
structural cycle guard for BB3.

---

## §2 Public surface (LOCKED — mirrors epic §9a verbatim)

```ts
// packages/policy/src/deny-code.ts
// Order: alphabetic per AA3 (epic §17). Closed enum — adding a
// member is a spec change. Pinned in test/deny-code.test-d.ts.
export const policyDenyCodeSchema = z.enum([
  "command_not_allowed",
  "dangerous_pattern",
  "intent_missing",
  "path_denied",
  "recursive_megasaver",
  "secret_path_read",
]);
export type PolicyDenyCode = z.infer<typeof policyDenyCodeSchema>;

// packages/policy/src/evaluate-command.ts
export type EvaluateCommandInput = {
  command: string;
  args: readonly string[];
  project: ProjectId;
  env?: {
    readonly MEGASAVER_ORIGIN_PID?: string;
  };
};
export type EvaluateCommandResult =
  | { allowed: true }
  | { allowed: false; reason: PolicyDenyCode };
export function evaluateCommand(input: EvaluateCommandInput): EvaluateCommandResult;

// packages/policy/src/evaluate-path-read.ts
export type EvaluatePathReadInput = {
  path: string;
  project: ProjectId;
};
export type EvaluatePathReadResult =
  | { allowed: true }
  | { allowed: false; reason: PolicyDenyCode };
export function evaluatePathRead(input: EvaluatePathReadInput): EvaluatePathReadResult;

// packages/policy/src/redact.ts
export type RedactResult = { redacted: string; count: number };
export function redact(text: string): RedactResult;
```

`ProjectId` is imported from `@megasaver/shared` (the branded
`projectIdSchema` type, `packages/shared/src/ids.ts:3`). It is
carried for future per-project override layering (epic §9a v0.9
hook); in v0.5 the value does not alter the decision but is part
of the LOCKED input shape — do not drop it.

`index.ts` re-exports ONLY the symbols above (no internal
constants, no regex tables) per `CLAUDE.md` §8.

### §2a `PolicyDenyCode` member → producer map

| Member                | Produced by                                                  |
|-----------------------|--------------------------------------------------------------|
| `command_not_allowed` | `evaluateCommand` — `command` not in `ALLOWED_COMMANDS`      |
| `dangerous_pattern`   | `evaluateCommand` — rendered line matches `DANGEROUS_PATTERNS` |
| `intent_missing`      | RESERVED — produced by the BB7a/BB8 orchestrator, NOT by BB3 functions. Enum slot lands now (epic §9a) to avoid a second schema bump. |
| `path_denied`         | `evaluatePathRead` — structural denial (see §4 reason policy) |
| `recursive_megasaver` | `evaluateCommand` — `MEGASAVER_ORIGIN_PID` re-entry guard    |
| `secret_path_read`    | `evaluatePathRead` — path matches secret-path denylist       |

`intent_missing` has no producer inside this package in v0.5. It
is a member of the closed enum because downstream callers
(`mega_read_file` / `mega_run_command` in epic §8a) classify a
missing `intent` against this shared code set. BB3 ships the
member and the type-d pin; it writes no code path that emits it.

---

## §3 `evaluateCommand` semantics (epic §9b, §9c, §9a env marker)

Decision order (first match wins, deny-biased):

1. **Re-entry guard (epic §9a, F-CRIT-3).** If
   `input.env?.MEGASAVER_ORIGIN_PID` is present and non-empty:
   - `MEGASAVER_ORIGIN_PID === String(process.pid)` → this IS the
     root MegaSaver process; no re-entry; continue to step 2.
   - `MEGASAVER_ORIGIN_PID !== String(process.pid)` → caller is
     downstream of a MegaSaver-orchestrated parent →
     `{ allowed: false, reason: "recursive_megasaver" }`.
   The guard is stateless: it inspects the inherited marker only,
   maintains no cross-call counter. Absent / empty marker → skip
   to step 2.
2. **Dangerous-pattern check (epic §9c).** Render the full line
   `[command, ...args].join(" ")` and test against every
   `DANGEROUS_PATTERNS` regex. Any match →
   `{ allowed: false, reason: "dangerous_pattern" }`. Checked
   BEFORE the allow-list so a dangerous invocation of an
   allow-listed binary (e.g. `node` piping to `sh`) is still
   denied.
3. **Allow-list check (epic §9b).** If `input.command` (exact
   string, no path normalisation, no basename stripping) is not a
   member of `ALLOWED_COMMANDS` →
   `{ allowed: false, reason: "command_not_allowed" }`.
4. Otherwise `{ allowed: true }`.

`process.pid` is read via the Node global; no DI seam in v0.5
(`CLAUDE.md` §13 — no premature abstraction). Tests exercise the
mismatch branch by passing a `MEGASAVER_ORIGIN_PID` value that is
deterministically not equal to `String(process.pid)` (e.g.
`String(process.pid + 1)`) and the match branch with
`String(process.pid)`.

### §3a `ALLOWED_COMMANDS` (epic §9b — LOCKED, alphabetic)

```
bun, bunx, cargo, cat, deno, find, go, grep, jest, ls, make,
node, npm, npx, pnpm, pnpx, pwd, pytest, tail, ts-node, tsc,
tsx, vitest, wc, whoami, yarn
```

25 members. `git` is intentionally absent (epic §9b — diff-aware
ranking in BB6 uses a separate in-process path). Stored as a
`readonly` alphabetically-sorted tuple/array; membership is an
exact-string set check.

### §3b `DANGEROUS_PATTERNS` (epic §9c — LOCKED)

```
/rm\s+-rf\s+\//
/sudo/
/mkfs/
/shutdown/
/curl.+\|\s*sh/
/wget.+\|\s*sh/
/dd\s+if=/
/>\s*\/dev\/sd/
```

8 patterns, matched against the full rendered command-line
string (epic §9c), not individual args, to catch
`bash -c "rm -rf /"`. Patterns are a `readonly RegExp[]`.

---

## §4 `evaluatePathRead` semantics (epic §9a, §8a path-gate ordering)

`evaluatePathRead` is gate **1 of 2** in the epic §8a
`mega_read_file` flow. It owns ONLY the secret-path denylist.
The structural sandbox check (`resolveSafeReadPath`) is gate 2,
lives in `output-filter` (BB5), and is OUT OF SCOPE for BB3
(epic §3c forbids policy depending on output-filter).

Decision:

- Normalise the input `path` for matching: lower-case (the epic
  denylist is case-insensitive) and treat both `/` and `\` as
  separators so a Windows-style path cannot bypass a `**/.ssh/**`
  rule. No filesystem access, no symlink resolution (that is gate
  2's job).
- Test the normalised path against the secret-path glob denylist
  (§4a). On match → `{ allowed: false, reason: "secret_path_read" }`.
- No match → `{ allowed: true }`.

### §4a Secret-path denylist (epic §9a — LOCKED, case-insensitive)

```
**/.env
**/.env.*
**/.ssh/**
**/.aws/credentials
**/.aws/config
**/.gcp/**
**/.azure/**
**/private_keys/**
**/secrets/**
**/id_rsa
**/id_ed25519
**/*.pem
**/*.key
**/credentials.json
**/service-account*.json
```

15 patterns. Compiled once at module load into anchored regexes.
The glob → regex compilation is an internal helper (NOT
exported): `*` → `[^/]*`, `**` → `.*`, `?` → `[^/]`, `.` literal,
case-insensitive flag, full-string anchored.

### §4b `secret_path_read` vs `path_denied` reason policy (LOCKED)

Per epic §9a ("BB3 spec picks the more precise reason"):

- A match against a denylist pattern in §4a is a **secret-path**
  denial → `secret_path_read`. This is the only `false` reason
  `evaluatePathRead` emits in v0.5.
- `path_denied` is the **structural / sandbox** code (epic §8a
  step 2 maps it from gate-2 failures, and the wider MCP enum
  reuses it). `evaluatePathRead` in BB3 does NOT perform
  structural checks and therefore does NOT emit `path_denied`.
  The enum member exists (epic §9a 6-member tuple) and is pinned;
  its producer is the BB8 orchestrator mapping gate-2 throws, not
  BB3 code.

This split keeps the precise reason at the secret-path layer and
leaves `path_denied` for the structural layer, exactly as epic
§8a step 1 vs step 2 prescribes.

---

## §5 `redact` semantics (epic §9d) — BB3 scope boundary

**Locked division of labour (epic §2b, §9d).** The full
`REDACTION_PATTERNS` table, the fast-check property test, and the
fixture corpus are owned by BB5 (`output-filter`), per epic §9d
("BB5 lands the exact regexes" and "BB5 test strategy"). BUT
`redact` is a LOCKED public export of `@megasaver/policy` (epic
§9a) and `output-filter` depends on `policy` (epic §3c), so the
function and its baseline pattern set MUST live in BB3.

BB3 ships `redact` with the epic §9d baseline table (all 10
named patterns) so the public surface is complete and BB5 can
import it. BB5 then adds the corpus + property tests and may
extend the pattern list via changeset (epic §9d — new patterns
are LOW-risk follow-ups). BB3's own test obligation:

- A fast-check property test (`redact.property.test.ts`) asserting
  no recognised secret pattern survives `redact()` for generated
  secret-shaped inputs (epic §9d point 1, brought forward so the
  HIGH-risk function ships verified).
- One example-based test per named pattern (positive: redacts;
  plus three negatives that look secret-shaped but must not
  redact — e.g. the word "bearer" in prose).
- `count` equals the number of substitutions performed;
  `{ redacted: "", count: 0 }` for input with no secrets.

### §5a `REDACTION_PATTERNS` — the BB3 baseline ten (epic §9d — LOCKED for BB3)

`readonly` array of `{ name: string; pattern: RegExp; replacement: string }`,
validated at module load by a Zod schema (input-at-boundary;
`CLAUDE.md` §8). Names form a closed set but are NOT a
tuple-pinned enum in BB3 (the epic §17 table lists no
`RedactionPatternName` pin — only `PolicyDenyCode` for BB3).

**Scope of this section — read before amending anything.** The lock covers the
**ten rows below and only those ten**. The shipped table is much larger: as of
2026-07-26, `REDACTION_PATTERNS` holds **39** entries plus **one**
`OBSERVED_PATTERNS` observer (`email`). The other 30 are **post-lock
additions**, enumerated in **§5b** with the spec that owns each one. Neither
list is a subset of the other by accident — §5b exists so that "which rows are
locked" has an answer a reader can check.

What the boundary does and does not mean is decided in
[[docs/superpowers/specs/2026-07-26-redaction-lock-scope-adr]]. In short:
the amendment tier is keyed to **what a change does**, not to which of the two
tables a row lives in. Editing any existing row's `pattern`/`flags`/
`replacement`/`validate`, moving any row, or inserting a row before
`jwk_private_key` or `jwt` is **CRITICAL** whether or not the row is one of the
ten; appending a detector that preserves the ordering constraint is **HIGH**.
Every change, either way, needs a `.source` pin, a `.flags` pin and behavioural
floor/ceiling fixtures. What the ten additionally carry is the footnote record
below — measured timings, rejected bound values, disclosed losses — which a
CRITICAL amendment must update **in the same commit** and a reviewer is expected
to check the new bytes against.

Do not read the ten as "the pinned ones". Measured 2026-07-26, exact
`RegExp.source` pins exist for 5 of these 10 and for 21 of the 31 in §5b;
`anthropic_key`, `openai_key`, `bearer_token` and `env_value` have neither a
byte nor a flags pin, and `jwt` has a `startsWith` prefix pin only. That gap is
ADR follow-up F2, not a property of the lock.

The 10 baseline entries:

| Name              | Pattern (epic §9d)                                     | Replacement                |
|-------------------|--------------------------------------------------------|----------------------------|
| github_token ◆    | `(?:gh[pousr]_[A-Za-z0-9]{36,}\|github_pat_[A-Za-z0-9_]{40,})` | `gh*_[REDACTED]`   |
| openai_key        | `sk-[A-Za-z0-9]{20,}`                                  | `sk-[REDACTED]`            |
| anthropic_key     | `sk-ant-[A-Za-z0-9-_]{20,}`                            | `sk-ant-[REDACTED]`        |
| aws_access_key ◆  | `A(?:KIA\|SIA)[0-9A-Z]{16}`                             | `AKIA[REDACTED]`           |
| aws_secret_key ◆  | `(?=[A-Za-z0-9/+])(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}` | `[REDACTED]`  |
| bearer_token      | `(?i:bearer\s+)[A-Za-z0-9\-._~+/=]{20,}`               | `Bearer [REDACTED]`        |
| jwt †‡◇           | `(?:(?<![A-Za-z0-9_-])\|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` (see ‡ for exact bytes) | `eyJ[REDACTED]` |
| private_key_block ◆ | grouped label + `(?:PRIVATE\|SECRET) KEY(?: BLOCK)?` (see ◆ for exact bytes — the cell cannot render them) | `[REDACTED PRIVATE KEY]` |
| env_value         | `(?<=^[A-Z_]+=)["'].+?["']`                            | `"[REDACTED]"`             |
| db_url ◆          | `(?:postgres\|postgresql\|mysql\|mongodb):\/\/[^\s/]{1,256}:[^\s@]{1,8192}@\S+` (see ◆ for exact bytes) | `[scheme]://[REDACTED]@[host]` |

† `jwt` amended 2026-07-20 by
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]] — a leading
lookbehind was added to remove a quadratic ReDoS (8.4 s at 313 KiB). The
behavior difference is intended and scoped by that spec §5: a JWT preceded
directly by a base64url character, including `-` and `_`, no longer redacts.
The lock otherwise stands; amend this row, never rewrite it silently.

‡ **Exact pattern bytes** — the table cell above escapes the alternation
`|` as `\|` so the markdown row renders as a single cell; that backslash
is NOT part of the regex. Transcribe from here, not from the table:

```
/(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f][0-9A-Fa-f]))eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
```

`jwt` was amended again 2026-07-20b by the same spec (see its §0), after
three review passes found the first amendment's scope statement
understated. The pattern gained a second lookbehind branch,
`(?<=%[0-9A-Fa-f][0-9A-Fa-f])`, so a JWT preceded by a percent-escape
redacts again — all 512 `%XY` forms were verified. The remaining,
disclosed loss is narrower and is stated in that spec's corrected §5:
a JWT preceded by a **raw** base64url character still does not redact
(`session-<jwt>`, `id_token_<jwt>`, `Bearer<jwt>`, `ghs_<appid>_<jwt>`,
base64-run glue), and **no other detector covers those bytes**. Cost of
the added branch: 0.32 ms per 313 KiB, linear (~2.0x per doubling to
1 MiB+). The `-` and `_` must stay in the first branch's class —
narrowing it to `(?<![A-Za-z0-9])` restores the 7.4-7.7 s quadratic.
Released as a **minor**, not a patch, because coverage was reduced.
Both footnotes stand; amend this row, never rewrite it silently.

◇ **Third amendment, 2026-07-26 — pure reorder, the pattern bytes are
unchanged.** `jwt` was moved from just after `bearer_token` to just before
`github_token`, i.e. ahead of every prefix detector, for the reason
`jwk_private_key` was moved to the front of the table: JWT segments are
base64url, so `sk-`, `ghp_`, `npm_`, `pypi-` and `hvs.` occur inside real
token bytes. A prefix detector firing inside a segment replaces those bytes
with a span containing `[`, the segment run can no longer reach its
terminating `.`, `jwt` fails to match at all, and the token passes through
with only the prefix detector's span redacted — under a finding named
`openai_key`, which reads as benign.

Measured over 400,000 crypto-random JWTs
(`JWT_ORDER_N=400000 pnpm --filter @megasaver/policy test redact-jwt-order`):

| order | losses per 250,000 | per 100,000 | attribution |
|---|---|---|---|
| `jwt` after `bearer_token` (before) | 367 | 146.8 | `openai_key` 282, `jwt` 165, `sendgrid_key` 63, `github_token` 13, `npm_token` 7, `slack_token` 1, `gitlab_token` 1 |
| `jwt` before `github_token` (shipped) | **0** | 0 | — |

Most of the 367 also fired `jwt` on a surviving fragment, so a finding named
`jwt` was not by itself proof that a token had been redacted whole.
This figure is a function of the CURRENT table and moves whenever a prefix
detector is added — an earlier revision omitted `sendgrid_key` and understated
the rate as 120 per 100,000.

`vault_token` and `sendgrid_key` reach a JWT by spanning a segment separator: a payload ending
`hvs` plus the `.` before a 20-character signature.

**Behaviour change to `findings[].name`, deliberate and singular.**
`bearer_token` used to run first and claim `Bearer <jwt>`; that input now
reports `jwt` and redacts to `Bearer eyJ[REDACTED]` instead of
`Bearer [REDACTED]`. Both forms redact the whole token — the change is the
name, which is public surface (`packages/pro-analytics/src/firewall-report.ts`
groups on it). `bearer_token` was deliberately NOT moved along with `jwt`:
moving it would relabel `Bearer sk-…`, `Bearer ghp_…` and every other
`Bearer <prefixed-secret>` as `bearer_token` too, a strictly wider rename for
no coverage gain. No other input changes name.

**The reorder is NOT a strict superset, and an earlier revision of this footnote
said it was.** `jwt`'s third segment `[A-Za-z0-9_-]+` is greedy and unbounded, so
it swallows any following base64url run — including a later detector's INDICATOR
when the two are joined by zero or more `[A-Za-z0-9_-]` characters. Measured
through `redactWithFindings`:

| glued input | before | after |
|---|---|---|
| `<jwt>aws_secret_access_key = <40>` | `[aws_secret_key, jwt]` | `[jwt]`, the 40-char secret in cleartext |
| `<jwt>bearer <24>` | `[bearer_token, jwt]` | `[jwt]`, the value in cleartext |
| `<jwt>SG.<22>.<43>` | `[sendgrid_key, jwt]` | `[jwt]`, the key in cleartext |
| `<jwt>hvs.<24>` | `[vault_token, jwt]` | `[jwt]`, the token in cleartext |

The loss occurs **iff** the separator is zero or more `[A-Za-z0-9_-]` characters.
Space, newline, tab, comma, semicolon, quote, `/`, `.`, `=`, `&` and `|` are all
safe, which is why no realistic tool-output shape triggers it — every JSON, URL,
env-file and log line supplies one. This is the mirror image of the left-side cost
`‡` already discloses (`session-<jwt>` staying in cleartext).

Both directions are pinned in `packages/policy/test/redact-jwt-order.test.ts`:
the four losses above, and eleven separators that must stay safe so nobody
"fixes" the loss by widening the segment class. Per the
[[docs/superpowers/specs/2026-07-26-redaction-lock-scope-adr]] tier table a
coverage reduction is CRITICAL, which this reorder therefore is — recorded here
rather than left implied by a superset claim that was never checked.

Ordering is pinned in `packages/policy/test/redact-superlinear.test.ts`
(`jwk_private_key` and `jwt` before all seven prefix detectors), the mechanism
and the `Bearer` rename in `packages/policy/test/redact-jwt.test.ts`, and the
rate in `packages/policy/test/redact-jwt-order.test.ts` — which also asserts
the pre-reorder order still loses tokens, so a generator that stopped emitting
realistic JWTs fails the suite instead of reporting a vacuous zero. Released
as a **patch**: no pattern bytes changed and coverage only grows.
All three footnotes stand; amend this row, never rewrite it silently.

◆ **Amended 2026-07-25** by
[[docs/superpowers/specs/2026-07-25-redaction-superlinear-patterns-design]] —
all three were super-linear on long runs, reachable from arbitrary tool output
under the 4 MB capture cap. Amend these rows, never rewrite them silently.

- `aws_secret_key` gained a leading **lookahead guard**, and later the **`i`
  flag** (2026-07-25, fourth amendment). The flag is a coverage fix, not a
  style choice: `AWS_SECRET_ACCESS_KEY=<40 chars>` unquoted — the form a `.env`,
  `printenv` or CI log actually contains, and the most common one an agent sees
  — matched **nothing**, because this lookbehind literal is lowercase (the ini
  form) and `env_value` requires quotes. The body class already spans both
  cases, so the flag widens only the indicator. Pattern bytes are unchanged;
  `pattern.flags` is now `gi` and is pinned by the flags test. It is semantically
  inert: its class is exactly the set of first characters the body can match,
  so it is strictly implied and cannot drop a match. It exists to reject a
  non-matching start position in O(1) before the variable-length `\s*`
  lookbehind is walked — 10,287 ms per 100 KB of whitespace down to 0.36 ms.
  **The guard must stay in FRONT of the lookbehind**; moving it after produces
  identical output and restores the full quadratic, so the position is pinned
  by `packages/policy/test/redact-superlinear.test.ts` rather than by any
  behavioural assertion. No coverage change.
- `db_url` bounded both userinfo runs. Both bounds are load-bearing; either
  alone leaves a super-linear seed. The password bound went through two
  rejected values: **256** leaves `postgres://user:<JWT>@host` in cleartext,
  and **2048** leaves a ~2.5 KB JWE-shaped token and a ~2.2 KB AWS RDS IAM auth
  token in cleartext. It ships at **8192**, which costs nothing (3.6 ms per
  200 KB at either 2048 or 8192, growth x1.00). Disclosed loss: userinfo user
  over 256, or password over 8192. The user bound is partly mitigated —
  `url_basic_auth` catches an over-long username as a fallback.
- `private_key_block` bounded its lazy body. 32768 clears a Classic McEliece
  private key (~18.6 KB base64, ~19.1 KB wrapped) with ~1.7x margin. `[A-Z ]+`
  is left unbounded — measured a non-driver.

  On bound **size**, the effect reverses with input size and both halves must be
  stated together. Below ~1–2 MB a larger bound is *slower* than none, because
  V8's counted lazy loop costs ~2x per step while the bound prunes nothing
  ({1,100000}: 708 ms per 200 KB against 114 unbounded). At the 4 MB capture cap
  the ordering flips and the bound is what saves you: unbounded 42,394 ms,
  {1,100000} 19,896 ms, {1,32768} 6,304 ms. Raising this bound is therefore
  **not** categorically unsafe; it trades small-input constant for large-input
  asymptote. An earlier revision of this footnote stated only the first half.

  Disclosed loss: a PEM body over 32768 **characters between the markers —
  newlines count**. Real 64-column wrapping costs ~1 character in 65, so the
  effective ceiling is ~32,262 base64 characters with LF (~23.6 KiB of raw key)
  and ~31,772 with CRLF (~23.3 KiB), not 32 KB.

  **Second amendment, same date — header coverage.** The label run became `*`
  rather than `+` and ` BLOCK` became optional, because `+` required at least one
  character between `BEGIN ` and `PRIVATE KEY`. Two real formats therefore never
  matched at all, in this baseline as originally locked:

  - **unlabelled PKCS#8**, `-----BEGIN PRIVATE KEY-----` — what `openssl genpkey`
    emits, and what GCP service-account JSON keys and Kubernetes TLS secrets
    carry. Arguably the most common modern form. A 2,400-character key passed
    `redactWithFindings` with `findings: []` and landed verbatim in the firewall
    ledger.
  - **PGP**, `-----BEGIN PGP PRIVATE KEY BLOCK-----` — the trailing ` BLOCK`
    broke the `-----` anchor.
  - **PGP SECRET**, `-----BEGIN PGP SECRET KEY BLOCK-----` — GnuPG's armour
    table carries three key-block headers, not two (PRIVATE, PUBLIC, SECRET);
    `strings $(which gpg) | grep 'KEY BLOCK'`. Found by the `security-reviewer`
    pass on the first attempt at this amendment, which had only widened the
    label and the ` BLOCK` suffix. Hence `(?:PRIVATE|SECRET)`.

  Found by the security review of the 2026-07-25 super-linear fix; **pre-existing
  in this baseline, not introduced by it**.

  Accepted cost. Both shapes were previously non-matching and therefore free;
  each marker is now a real start position scanning to the bound. Measured on an
  idle box at the 4 MB cap, isolated pattern, min-of-3:

  | seed | before | after |
  |---|---|---|
  | labelled (pre-existing worst) | 5,760 ms | 6,227 ms |
  | PKCS#8 (new) | 3.3 ms | 6,976 ms |
  | PGP (new) | 3.6 ms | 4,818 ms |

  The availability-relevant number is the **ceiling**, not the seed count — an
  attacker picks the best seed, and the labelled one already sat at it. The
  ceiling moves **5,760 → ~7,000 ms, roughly +21%**, and the delta is explained
  by start-position density (the PKCS#8 marker is 27 bytes against 29).

  **Revised after the 2026-07-25 detector additions.** There are now *four*
  anchors in the same ~7–9 s band at the 4 MB cap, not one: the labelled PEM
  marker, `-----BEGIN PRIVATE KEY-----` (27 B), `-----BEGIN SECRET KEY-----`
  (26 B — denser than any seed originally measured), and
  `PuTTY-User-Key-File-1:` (22 B). No new asymptote; all linear. `age_secret_key`
  and `jwk_private_key` are immaterial (single-digit to low-hundreds ms).
  Absolute figures in this band vary 25–35% with machine load — two reviewers
  measured the same seed at 6.2 s and 9.4 s — so treat the band, not the digits,
  as the disclosure. All growth
  x1.97–2.10, i.e. linear. An earlier revision of this footnote said "three seeds
  reach the residual instead of one", which invites reading exposure as tripled;
  it is not. What genuinely rises is the chance of *accidentally* hitting the
  residual on benign input carrying PKCS#8 or PGP markers.

  ` BLOCK` is tied to `PRIVATE`/`SECRET KEY`, not floating: `PGP PUBLIC KEY
  BLOCK` differs by one word and must not redact.

  Which negative fixtures are load-bearing was measured against the mutant family
  rather than assumed. `PUBLIC KEY` and `PGP PUBLIC KEY BLOCK` do the work, and
  the latter uniquely catches a mutant that floats ` BLOCK` off the noun.
  `CERTIFICATE` and `PGP MESSAGE` kill nothing here and are kept as documentation
  of intent. The all-lowercase row constrains the label class not at all — the
  literal `BEGIN`/`END` are uppercase, so even widening the label to `[\s\S]*?`
  leaves it unmatched; it pins the absence of the `i` flag, already covered. An
  earlier revision claimed a `[A-Z ]*KEY` mutant "fails three of those
  assertions"; measured, it fails two, the third failure being the §5a byte pin.

  Six further mutants initially survived the whole suite, each failing only that
  byte pin: dropping the body's lazy `?`; loosening only the **END** label (every
  fixture paired matching labels, so the END marker was never consulted); label
  → `[A-Za-z ]*`; ` BLOCK` → `(?: [A-Z]+)?` or `\s?BLOCK`; and folding the space
  after `BEGIN` into the class. All are now killed behaviourally.

  **BEGIN and END labels may differ, and ` BLOCK` is independently optional on
  each.** Deliberate: a backreference tying them would stop redacting
  concatenated, hand-edited and mislabelled exports — turning a robustness case
  into the leak class this amendment exists to close — and every PEM fixture is
  symmetric by construction, so such an edit would otherwise pass the whole
  behavioural suite. Now pinned both ways.

  **Accepted over-redaction:** text quoting BOTH markers is consumed — a PEM
  parse error, or prose describing the format. Requiring a newline after the
  BEGIN marker would avoid it and was rejected: GCP service-account JSON carries
  the key with literal `\n` escapes, not real newlines.

  **Third amendment, same date — the label is now a GROUPED expression, not a
  character class.** The uppercase-and-space class covered **7 of the 32**
  labels ending in `PRIVATE KEY` in OpenSSL 3.6.2's own PEM table
  (`strings libcrypto | grep 'PRIVATE KEY$'`), which is the authoritative list of
  what OpenSSL decodes as a private key. The 25 it missed were the entire NIST
  post-quantum set (`ML-DSA-44/65/87`, `ML-KEM-512/768/1024`, twelve
  `SLH-DSA-*`), every modern curve (`ED25519`, `ED448`, `X25519`, `X448`), `SM2`,
  `RSA-PSS`, and `X9.42 DH` — a **dot**. The `SLH-DSA` labels end in a lowercase
  `f`/`s`, so the group class is `[A-Za-z0-9]`; an all-uppercase label assumption
  is simply wrong.

  Reachability is weaker than for the PKCS#8/PGP amendment and is stated as such:
  no OpenSSL CLI path emits these labels (`genpkey` writes unlabelled PKCS#8 and
  `-traditional` is unsupported for them). They are in the **decoder** table plus
  a `%s PRIVATE KEY` template, so a library caller using the traditional writer
  produces files OpenSSL reads back as private keys. The change was taken on
  error-cost asymmetry, given it is close to free.

  **The grouped form is load-bearing, not stylistic**, and the obvious
  simplification is the dangerous one. Measured on the labelled-BEGIN-run seed:

  | label form | 400 KB | growth | covers |
  |---|---|---|---|
  | `[A-Z ]*` (previous) | 552 ms | x1.93 | 7/32 |
  | `[A-Za-z0-9. -]*` | **1,148 ms at 16 KB** | **x7.13** | 32/32 |
  | `[A-Za-z0-9. -]{0,64}` | 2,187 ms | x1.77 | 32/32 |
  | **grouped (shipped)** | **~600 ms** | x2.16 | **32/32** |

  The unbounded class is catastrophic because it covers **every character** of
  `-----BEGIN A PRIVATE KEY-----`, so the label run swallows the whole input and
  backtracks for `PRIVATE KEY`. Requiring each `.`/`-` to sit BETWEEN
  alphanumerics stops the label crossing a `-----` at all — which is how the
  grouped form costs what the old narrow class did while covering three times as
  many labels.

  It is a nested quantifier, so it was attacked rather than assumed: seven shapes
  built to trigger `(X+)*` backtracking (dash runs, `A `/`A-1 `/`A.9 ` chains, a
  near-miss `PRIVATE KEZ`, dense BEGIN+group runs) all measure x1.81–2.04 and
  sub-1.1 ms at 400 KB. Each group parses deterministically, because `-` and `.`
  are outside `[A-Za-z0-9]`, so there is no ambiguous split to explore.

  Four fixtures pin the structure behaviourally — `A- `, `-A `, `A. ` and `A--B `
  labels must NOT match, and all four DO match either character-class form. They
  kill both class mutants without the timing test, which matters: the unbounded
  mutant makes that test take over ten minutes.

  **Not PEM-armoured, so no label width reaches them:** RFC 4716, PuTTY `.ppk`,
  age and JWK. Each now has its own detector in `REDACTION_PATTERNS`; those are
  post-lock additions and are not §5a rows, but their bytes are pinned by
  `packages/policy/test/redact-superlinear.test.ts` for the same reason these
  are — without a byte pin, eleven bound-edge and character-class mutations
  survived the whole suite.

**Exact pattern bytes** — the `db_url` cell above escapes the alternation `|` as
`\|` so the markdown row renders as one cell, and the table renders `/` plainly;
neither matches the compiled `RegExp.source`. Transcribe from here, not from the
table (the `jwt` row carries the same trap, see ‡):

```
/(?:postgres|postgresql|mysql|mongodb):\/\/[^\s/]{1,256}:[^\s@]{1,8192}@\S+/g
/-----BEGIN (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----[\s\S]{1,32768}?-----END (?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*(?:PRIVATE|SECRET) KEY(?: BLOCK)?-----/g
```

All three amended rows are pinned byte-for-byte against `RegExp.source` in
`packages/policy/test/redact-superlinear.test.ts`, so a silent drift between
this record and shipped code fails CI.

**Ledger note.** This change also added a ledger-only userinfo scrub in
`packages/policy/src/redact.ts` (`redactForLedger`). It is not part of this
baseline — the agent-visible path is unchanged by it — but it exists because
bounding `email`'s local part removed an accidental backstop: the previously
unbounded local part had been swallowing whole URL passwords before they could
reach a ledger `sourcePath` label (F-FW-1).

**Fourth amendment, 2026-07-25 — two coverage holes in previously-untouched
rows**, both found by the security-reviewer pass on the carrier detectors:

- `aws_access_key` spelled only `AKIA`. **`ASIA` is the TEMPORARY (STS) prefix**,
  so a complete `aws sts assume-role` credential set — access key, secret key and
  session token — produced `findings: []` and reached the ledger verbatim, the
  same signature this spec cites as the worst case for PKCS#8. Two of the three
  values were also missed by `json_secret_field`, which now carries
  `SecretAccessKey`/`SessionToken`; all three causes had to be fixed together.
- `github_token` could not match **`github_pat_`**, the fine-grained form and
  GitHub's own recommended default, because the character after `gh` is `i`. A
  bare `GH_TOKEN=github_pat_…` leaked; it was caught only incidentally inside
  `.git-credentials` and quoted `.env`.

Both are one-token fixes with no measured false positives (0 across 2,758 files
/ 21 MB of third-party JSON plus every tracked repo file) and no timing change.

Released as a **minor**, not a patch, because `db_url` and
`private_key_block` coverage was reduced.

Order is application order (longest/most-specific guards run such
that `anthropic_key` is attempted before `openai_key` since
`sk-ant-` is a prefix of the `sk-` shape — anthropic MUST run
first). Two later additions extend the same rule: `jwk_private_key`
and `jwt` both carry base64url bodies in which a prefix detector can
fire, disabling them entirely, so both MUST precede every prefix
detector (see ◇ above and the 2026-07-25 non-PEM key detector note).
`bearer_token` consequently no longer precedes `jwt`. This ordering is
locked here; BB5's corpus test pins exact outputs. Patterns needing the `g` flag are compiled with it
so `count` reflects every occurrence.

### §5b Post-lock detectors (NOT §5a lock-table rows)

The 31 rows below ship in the same two tables but are **not** covered by the §5a
lock. They are recorded here so the lock is enumerable: §5a's ten plus these 31
is the whole of `REDACTION_PATTERNS` (40) and `OBSERVED_PATTERNS` (1). Amendment
tier is by change shape, not by table — see §5a's scope paragraph and
[[docs/superpowers/specs/2026-07-26-redaction-lock-scope-adr]].

**No pattern bytes here, deliberately.** Footnotes ‡ and ◆ above exist because a
markdown cell escapes `|` as `\|` and renders `/` plainly, so a table cell never
matches a compiled `RegExp.source`. Twenty-three more escaped-regex cells would
be twenty-three more copies of that trap. The bytes live in the pin tests named
below and in each owning spec.

The **Pin** column is a snapshot read on 2026-07-26 from
`packages/policy/test/redact-superlinear.test.ts` (and `redact-jwt.test.ts` for
`jwt`). Nothing enforces that it stays accurate — that is ADR follow-up F1.
`bytes` = exact `.source` equality; `struct` = a `startsWith`/`toContain`
structural gate only; `flags` = a `.flags` equality pin.

| Detector | Carrier / kind | Owning spec | Pin (2026-07-26) |
|---|---|---|---|
| `jwk_private_key` | JWK with a private component | 2026-07-25-redaction-superlinear-patterns §3e | bytes + flags |
| `ssh2_private_key_block` | RFC 4716 four-dash armour | 2026-07-25-redaction-superlinear-patterns §3e | bytes + flags |
| `putty_private_key` | PuTTY `.ppk` | 2026-07-25-redaction-superlinear-patterns §3e | bytes + flags |
| `age_secret_key` | age identity | 2026-07-25-redaction-superlinear-patterns §3e | bytes + flags |
| `base64_pem_block` | base64-wrapped PEM (`kubectl get secret -o yaml`) | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `ansible_vault` | `$ANSIBLE_VAULT` blob, formats 1.1 and 1.2 | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `aws_session_token` | `~/.aws/credentials`, env dumps | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `json_secret_field` | gcloud ADC, Azure, docker `auth`, STS fields | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `netrc_password` | `.netrc`, gated on a `machine`/`default` record | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `connection_string_secret` | ADO.NET / ODBC / Azure semicolon strings (`Password=`, `AccountKey=`), including whitespace around the separator and quoted values holding a `;` | 2026-07-26-policy-followups §T2, 2026-07-26-carrier-residual-gaps §3c | bytes + flags |
| `stripe_key` | Stripe secret and restricted keys (`sk_`/`rk_`; `pk_` excluded) | 2026-07-26-policy-followups §T2 | bytes + flags |
| `slack_token` | Slack bot/user/app tokens (`xox[baprs]-`) | 2026-07-26-policy-followups §T2 | bytes + flags |
| `gitlab_token` | GitLab prefixed tokens — the full documented set (`glpat/gloas/glrtr/glrt/gldt/glcbt/glptt/glft/glffct/glimt/glsoat/glagent/glwt`) | 2026-07-26-policy-followups §T2, 2026-07-26-carrier-residual-gaps §3b | bytes + flags |
| `sendgrid_key` | SendGrid API key (`SG.`) | 2026-07-26-policy-followups §T2 | bytes + flags |
| `digitalocean_token` | DigitalOcean PAT (`dop_v1_`) | 2026-07-26-policy-followups §T2 | bytes + flags |
| `twilio_api_key_sid` | Twilio API Key SID (`SK` + 32 hex) | 2026-07-26-policy-followups §T2 | bytes + flags |
| `slack_webhook_url` | Slack incoming-webhook / workflow / trigger URLs — the URL is the credential; runs ahead of every prefix detector | 2026-07-26-carrier-residual-gaps §3a | bytes + flags |
| `npm_token` | `.npmrc` | designed 2026-07-19-redaction-baseline-extension, shipped 2026-07-25 §3f with different bounds | bytes + flags |
| `pypi_token` | `.pypirc` | designed 2026-07-19-redaction-baseline-extension, shipped 2026-07-25 §3f | bytes + flags |
| `vault_token` | HashiCorp Vault | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `bip32_xprv` | BIP32 extended private key | 2026-07-25-redaction-superlinear-patterns §3f | bytes + flags |
| `url_basic_auth` | userinfo on any scheme (`db_url` fallback) | **none** — commit `b2e39cdf`, 2026-06-17 | struct + flags |
| `url_query_secret` | secret-named query / fragment param | **none** — commit `b2e39cdf`, 2026-06-17 | — |
| `cli_secret_flag_eq` | `--flag=value` | **none** — commit `b2e39cdf`, 2026-06-17 | — |
| `cli_secret_flag_spaced` | `--flag "value"`, quoted only | **none** — commit `b2e39cdf`, 2026-06-17 | — |
| `api_key_header` | `X-Api-Key`-style header value | **none** — commit `b2e39cdf`, 2026-06-17 | struct + flags |
| `basic_auth_header` | `Authorization: Basic` | **none** — commit `b2e39cdf`, 2026-06-17 | struct + flags |
| `credit_card` | 13–19 digit run, Luhn-gated | 2026-07-08-context-firewall | — |
| `iban` | ISO 13616 mod-97-gated | 2026-07-08-context-firewall | — |
| `tr_national_id` | TCKN checksum-gated | 2026-07-08-context-firewall | — |
| `email` (`OBSERVED_PATTERNS`) | count-only observer; never rewrites text | 2026-07-08-context-firewall | struct + flags |

Six rows have **no owning spec** — they shipped 2026-06-17 in `b2e39cdf`
("feat(policy): redact contextual no-prefix secrets", PR #150), before the
per-detector spec discipline existed. Recorded as-is rather than back-attributed
to a spec that does not describe them; the later specs only amend them. Under
§5a's scope paragraph the first CRITICAL change to any of the six must give it a
record.

**Disclosed coverage gaps in the 2026-07-26 vendor rows.** Recorded here rather
than left to be rediscovered; each was verified as a no-redaction:

| detector | still missed |
|---|---|
| `stripe_key` | covers `sk_`/`rk_`/`whsec_`; `pk_` is the PUBLISHABLE key and is excluded on purpose |
| `slack_token` | covers `xox[baprse]-` and `xapp-`. Webhook URLs were **closed** on 2026-07-26 by the separate `slack_webhook_url` row — a separate detector rather than a widening of this one, because the URL form shares no prefix with `xox`/`xapp` |
| `gitlab_token` | **closed** 2026-07-26: the alternation now carries the full documented set. Seven prefixes were missing and each measured `fired: (none)` — `glrtr glft glffct glimt glsoat glagent glwt`. Enumerated, not `gl[a-z]{2,6}-`, which would false-positive on `global-<20 chars>` |
| `digitalocean_token` | `do[opr]_v1_` covers PAT, OAuth and refresh |
| `twilio_api_key_sid` | matches the API Key **SID**, which is the HTTP Basic *username* — an identifier, not the secret. Kept for the same reason `aws_access_key` is kept. The actual secrets — Auth Token (32 hex) and API Key Secret (32 alphanumeric) — have **no distinguishing prefix** and are therefore unreachable by a regex at acceptable false-positive cost |
| `connection_string_secret` | `Pwd=` is deliberately absent: it collides with the universal `PWD` shell variable, which appears in every `env`/`printenv`/CI log, and narrowing the separator was not enough because `PWD=` can sit at position 0. The spaced form `Password = value` and the legal ADO.NET quoted form `Password="p;w;d"` were **closed** 2026-07-26 with three bounded `\s{0,8}` gaps and quoted alternatives; the quoted form previously fired *nothing at all*, because the body saw `"pw` — under the 8-char floor — so there was no match to shorten. Still open: a quoted value over 8192 chars **with an interior `;`**, and `Password` followed by nine or more spaces |

**Do not read §5b as the design list.**
[[docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design]]
specifies roughly twenty-eight vendor detectors (`stripe_*`, `google_api_key`,
`slack_*` including `slack_webhook_url`, `gitlab_*`, `huggingface_*`,
`digitalocean_*`, `azure_client_secret`, `sendgrid_api_key`, `datadog_app_key`,
`github_app_token`) that are **designed and not shipped** — they are absent from
`redaction-patterns.ts`. Its status line says so ("user-approved design",
security re-check pending); ADR follow-up F4 tracks reconciling it. §5b lists
what is in the table.

---

## §6 Closed-enum pin (epic §17 — `deny-code.test-d.ts`)

`packages/policy/test/deny-code.test-d.ts` mirrors
`packages/shared/test/token-saver-mode.test-d.ts` (epic §17 owner
= `@megasaver/policy`). It asserts:

1. Each of the 6 members is assignable to `PolicyDenyCode`.
2. A non-member literal is `// @ts-expect-error` rejected.
3. An arbitrary `as string` is not assignable.
4. `policyDenyCodeSchema.options` spreads into `PolicyDenyCode[]`.
5. `policyDenyCodeSchema.options` is the exact readonly tuple
   `["command_not_allowed", "dangerous_pattern", "intent_missing",
   "path_denied", "recursive_megasaver", "secret_path_read"]`
   (alphabetic — AA3 tuple-ordering pin).

A companion runtime test (`deny-code.test.ts`) asserts
`policyDenyCodeSchema.options` equals the same array at
`pnpm verify` time (drift guard, AA3 §59-style).

---

## §7 Package scaffold (mirrors `packages/shared/` exactly)

New files under `packages/policy/`:

- `package.json` — name `@megasaver/policy`, `private: true`,
  `type: module`, `main`/`types`/`exports` → `./dist`, scripts
  `build`/`dev`/`test`/`test:watch`/`typecheck`/`clean` identical
  to shared, `sideEffects: false`, `files: ["dist"]`. Deps:
  `@megasaver/shared: "workspace:*"`, `zod: "^3.24.1"`. DevDeps:
  `@types/node: "^22.19.17"`, `fast-check: "^3.23.2"`.
- `tsconfig.json`, `tsconfig.test.json`, `tsconfig.test-d.json` —
  byte-identical to shared's (extend `../../tsconfig.base.json`).
- `tsup.config.ts`, `vitest.config.ts` — identical to shared's.
- `src/index.ts` — barrel, public surface only.

No `pnpm-workspace.yaml` edit (epic / prompt: glob already covers
`packages/*`). After scaffold, `pnpm install` MUST be re-run in
the worktree so the `workspace:*` link resolves, then build.
Turbo auto-discovers the package via the workspace glob; no root
config edit.

---

## §8 Acceptance criteria (epic §14 BB3)

1. `evaluateCommand` denies every epic §9c `DANGEROUS_PATTERNS`
   entry, including when the binary is allow-listed.
2. `evaluateCommand` with `MEGASAVER_ORIGIN_PID !== String(process.pid)`
   returns `recursive_megasaver`; with `=== String(process.pid)`
   does not.
3. `evaluateCommand` denies a non-allow-listed command with
   `command_not_allowed`; allows a clean allow-listed command.
4. `evaluatePathRead` denies every §4a denylist pattern with
   `secret_path_read`; allows a benign project-relative path.
5. `redact` removes all 10 baseline `REDACTION_PATTERNS`
   (property test + per-pattern examples); leaves the 3 negative
   fixtures untouched; `count` accurate.
6. `policyDenyCodeSchema.options` is the locked 6-member
   alphabetic tuple (runtime + `test-d.ts` pin).
7. `dependency-graph.test.ts`: `dependencies` ⊆
   `["@megasaver/shared", "zod"]` (no `@megasaver/core` etc.).
8. `pnpm verify` (lint + typecheck + test, whole monorepo) green
   from the worktree root with honest passing output.

---

## §9 Out of scope (LOCKED)

- `loadProjectPermissions`, `ProjectPermissions`,
  `.megasaver/permissions.yaml` parsing (epic §9e, F-MED-4).
- `resolveSafeReadPath` / structural sandbox check (BB5,
  `output-filter`; epic §8a gate 2).
- Redaction fixture corpus + property-vs-corpus split (BB5; epic
  §9d).
- Any consumer wiring into `core`, `mcp-bridge`, or the CLI
  (BB5/BB7b/BB8).
- MCP `policy_load_failed` / `command_denied` / `path_denied`
  wire error codes (BB8; epic §8b) — those map FROM
  `PolicyDenyCode`, they are not defined here.
- DI seam for `process.pid` (premature abstraction; `CLAUDE.md`
  §13).

---

## §10 Alternatives considered (ADR)

**Decision.** Ship `redact` + its baseline `REDACTION_PATTERNS`
in BB3 even though the corpus/property-suite is BB5's.

- **Drivers.** (1) `redact` is a LOCKED public export of
  `@megasaver/policy` (epic §9a). (2) `output-filter` (BB5)
  imports it (epic §2b, §3c) and must redact before persisting
  (epic §2b). (3) A package cannot export a function that does
  not exist.
- **Alternatives considered.**
  (a) *Defer `redact` to BB5.* Rejected: violates epic §9a public
  surface and breaks the BB5 import; output-filter would have to
  either inline its own copy (epic §2b explicitly rejects this)
  or import a non-existent symbol.
  (b) *Ship `redact` as a `throw`/stub in BB3, implement in BB5.*
  Rejected: half-implementation (`CLAUDE.md` §13) on a HIGH-risk
  security function; the deny surface ships unverified.
  (c) *Move the whole redaction surface (patterns + corpus) into
  BB3.* Rejected: epic §9d explicitly assigns the corpus + the
  property/corpus split + changeset-driven pattern updates to
  BB5; pulling the corpus forward duplicates BB5's owned test
  strategy.
- **Why chosen.** BB3 owns the function and a complete, verified
  baseline pattern set (property test brought forward because the
  function is HIGH-risk). BB5 owns the durable corpus and the
  changeset extension path. Clean ownership boundary, no stub, no
  duplicate.
- **Consequences.** BB3 carries a fast-check devDep (already in
  the shared scaffold) and a property test. BB5's spec must
  reference `redact` as imported-from-policy, and its corpus
  tests live in `output-filter` against the imported function.
- **Follow-ups.** BB5 adds `redact.property.test.ts` corpus pairs
  + negatives in `output-filter`; any new pattern ships as a
  LOW-risk changeset owned by the BB5 child spec (epic §9d).

**Secondary decision.** `evaluatePathRead` emits only
`secret_path_read`, never `path_denied`.

- **Driver.** Epic §8a separates gate 1 (denylist, policy) from
  gate 2 (structural sandbox, output-filter); `path_denied` is
  the gate-2/structural code.
- **Alternative.** Have `evaluatePathRead` also emit
  `path_denied` for malformed paths. Rejected: structural
  validation is gate 2's responsibility (BB5); duplicating it in
  policy creates two sources of truth for the sandbox and pulls
  an `output-filter` concern into `policy`, which epic §3c
  forbids.
- **Consequence.** `path_denied` has no producer inside the BB3
  package; it is a pinned enum member whose producer is the BB8
  orchestrator. Documented in §2a and §4b.
