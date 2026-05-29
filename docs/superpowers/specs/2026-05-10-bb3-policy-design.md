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

### §5a `REDACTION_PATTERNS` baseline (epic §9d — LOCKED for BB3)

`readonly` array of `{ name: string; pattern: RegExp; replacement: string }`,
validated at module load by a Zod schema (input-at-boundary;
`CLAUDE.md` §8). Names form a closed set but are NOT a
tuple-pinned enum in BB3 (the epic §17 table lists no
`RedactionPatternName` pin — only `PolicyDenyCode` for BB3). The
10 baseline entries:

| Name              | Pattern (epic §9d)                                     | Replacement                |
|-------------------|--------------------------------------------------------|----------------------------|
| github_token      | `gh[pousr]_[A-Za-z0-9]{36,}`                           | `gh*_[REDACTED]`           |
| openai_key        | `sk-[A-Za-z0-9]{20,}`                                  | `sk-[REDACTED]`            |
| anthropic_key     | `sk-ant-[A-Za-z0-9-_]{20,}`                            | `sk-ant-[REDACTED]`        |
| aws_access_key    | `AKIA[0-9A-Z]{16}`                                     | `AKIA[REDACTED]`           |
| aws_secret_key    | `(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}`   | `[REDACTED]`               |
| bearer_token      | `(?i:bearer\s+)[A-Za-z0-9\-._~+/=]{20,}`               | `Bearer [REDACTED]`        |
| jwt               | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | `eyJ[REDACTED]`            |
| private_key_block | `-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END`   | `[REDACTED PRIVATE KEY]`   |
| env_value         | `(?<=^[A-Z_]+=)["'].+?["']`                            | `"[REDACTED]"`             |
| db_url            | `(?:postgres|postgresql|mysql|mongodb)://[^\s/]+:[^\s@]+@\S+` | `[scheme]://[REDACTED]@[host]` |

Order is application order (longest/most-specific guards run such
that `anthropic_key` is attempted before `openai_key` since
`sk-ant-` is a prefix of the `sk-` shape — anthropic MUST run
first). This ordering is locked here; BB5's corpus test pins
exact outputs. Patterns needing the `g` flag are compiled with it
so `count` reflects every occurrence.

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
