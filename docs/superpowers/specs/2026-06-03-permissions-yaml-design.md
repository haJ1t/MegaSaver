---
title: Project permissions — `.megasaver/permissions.yaml` (v0.9)
status: proposed
risk: HIGH
created: 2026-06-03
parent-epic: docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
parent-sections: "§8b (policy_load_failed slot), §8d (orchestrator), §9a/§9e (dropped ProjectPermissions, Rev-2)"
builds-on: docs/superpowers/specs/2026-05-10-bb3-policy-design.md
fills-slot: AA1 Rev-2 v0.9 deferral (epic L1104–1112)
---

# Project permissions — `.megasaver/permissions.yaml`

> Builds the v0.9 feature AA1 Revision 2 deferred (epic L1104–1112):
> `loadProjectPermissions` + `ProjectPermissions`, activating the
> reserved `policy_load_failed` slot. Where this spec and the AA1
> epic disagree on a locked contract (the `PolicyDenyCode` enum, the
> two-gate read order, the single spawn site), the epic wins. This
> spec EXTENDS the gate; it never loosens it. HIGH risk —
> permission/security code (`CLAUDE.md` §12); `security-reviewer` +
> `critic` passes mandatory.

## §0 Problem & scope

`@megasaver/policy` ships a fixed baseline (`ALLOWED_COMMANDS`,
`DANGEROUS_PATTERNS`, `SECRET_PATH_PATTERNS`). A project cannot add
"also never read `creds/**`" or "also never run `make` here". Plan
L1235–1247 reserves `.megasaver/permissions.yaml` for per-project
**additional** denials. This spec locks its schema, loader, and
wiring under a strict tighten-only model.

In scope: the zod schema, the pure `parseProjectPermissions` (policy)
+ the IO `loadProjectPermissions` (context-gate) split (§4.1), an
optional `permissions?` input on `evaluateCommand` /
`evaluatePathRead`, one new `PolicyDenyCode` member, orchestrator +
entry-point wiring, the `yaml` dep. Out of scope (YAGNI): any `allow:`
key (rejected, §3.1); user/global files; hot-reload; per-argument
policies; live write enforcement (§5.4).

## §2 YAML schema

Tighten-only: every key adds denials.

```yaml
deny:
  read:      # extra secret-path globs, additive to SECRET_PATH_PATTERNS
    - "creds/**"
  write:     # extra write-denied globs, exposed only (see §5.4)
    - "creds/**"
  commands:  # extra denied command names, exact-string like ALLOWED_COMMANDS
    - "make"
```

All keys optional; absent ⇒ empty list. `deny.read`/`deny.write`
reuse `secret-paths.ts`'s `compileGlob` over `normalizePath` (same
semantics, no second matcher). `deny.commands` match exactly like
`ALLOWED_COMMANDS.includes(input.command)` — no basename strip, no
normalization (epic §9b).

Zod (`packages/policy/src/project-permissions.ts`):

```ts
const globs = z.array(z.string().min(1)).readonly();
export const projectPermissionsSchema = z
  .object({
    deny: z
      .object({
        read: globs.default([]),
        write: globs.default([]),
        commands: z.array(z.string().min(1)).readonly().default([]),
      })
      .strict()
      .default({ read: [], write: [], commands: [] }),
  })
  .strict(); // unknown key (e.g. a stray `allow:`) → parse error → fail-closed
```

`.strict()` is load-bearing: a typo or an `allow:` attempt is a
parse failure, never a silent ignore. The pure parser (§4.1) returns
the COMPILED form (no per-call regex compilation in the hot path):

```ts
export type ProjectPermissions = {
  denyReadPatterns: readonly RegExp[];   // compiled from deny.read
  denyWritePatterns: readonly RegExp[];  // compiled from deny.write
  denyCommands: readonly string[];       // verbatim deny.commands
};
```

## §3 SECURITY INVARIANTS (locked — the core of this spec)

**I1 — Tighten-only.** A project file can only ADD denials. No
`allow:` key (§3.1), no field that subtracts from a baseline list.
By construction no input can re-allow a `DANGEROUS_PATTERNS` hit,
add to `ALLOWED_COMMANDS`, or remove a `SECRET_PATH_PATTERNS` entry.
No escalation path exists — enforced by the type, not a runtime check.

**I2 — Deny-precedence.** Project denials are additional deny gates
running alongside the baseline. Any match ⇒ `{ allowed: false }`
regardless of baseline allow. The whole gate is an AND-of-denylists:
baseline never overrides a project deny and vice-versa.

**I3 — Fail-closed.** Missing file ⇒ `null` ⇒ baseline only (absence
is not a denial). A PRESENT-but-malformed file (invalid YAML, schema
violation, unknown key, non-ENOENT read error) ⇒ a `PolicyLoadError`
(thrown by the pure parser on bad shape, or by the context-gate
loader wrapping an fs/yaml error); the caller maps it to DENY via
`policy_load_failed` (§4.3). The gate NEVER silently opens or falls
back to "no restrictions" on a broken file.

**I4 — Path-glob safety.** `deny.read` globs are ADDITIVE to
`SECRET_PATH_PATTERNS`, compiled by the same `compileGlob` over
`normalizePath`-lowered, `/`-unified input — so `..`, backslashes,
and case cannot defeat them any more than they defeat the baseline.
Structural defeat (symlink-escape, `..`-traversal) is still caught
by `resolveSafeReadPath` (gate 2, `context-gate/src/read.ts:55`),
which runs regardless. Project globs widen gate 1; gate 2 is untouched.

### §3.1 Why no `allow:` (rejected alternative)

An `allow:` key would let a project re-enable a baseline-denied
command or un-deny a secret path — direct escalation, and the file
lives in a repo an agent can write. Tighten-only removes the whole
escalation class. A wrong baseline default is fixed in
`@megasaver/policy` (reviewed), not via a per-project override.
Non-negotiable for HIGH risk.

## §4 Policy API additions

**§4.1 Pure/IO split (LOCKED — parent decision).** The
security-critical validation stays in `@megasaver/policy` and is
PURE; the filesystem + YAML parsing live in `@megasaver/context-gate`
(the IO/orchestration layer). `@megasaver/policy` gains NO new runtime
deps.

- **`@megasaver/policy` (pure)** —
  `parseProjectPermissions(raw: unknown): ProjectPermissions` in
  `packages/policy/src/parse-project-permissions.ts`. Takes an
  ALREADY-PARSED plain object (no fs, no yaml). Runs
  `projectPermissionsSchema.parse(raw)` → compiles globs via
  `compileGlob` (now exported from `secret-paths.ts`) → returns
  compiled `ProjectPermissions`. On invalid shape ⇒
  `throw new PolicyLoadError(message, { cause })`. The zod schema,
  tighten-only enforcement (I1), and the deny-code all stay here with
  the evaluators, which remain unit-testable with no fs (`CLAUDE.md`
  §8).
- **`@megasaver/context-gate` (IO)** —
  `loadProjectPermissions(projectRoot: string): ProjectPermissions | null`
  in `packages/context-gate/src/load-project-permissions.ts`. Reads
  `<projectRoot>/.megasaver/permissions.yaml` synchronously (runs once
  up front, like `originPid`). ENOENT ⇒ `null`. Else `yaml.parse` (the
  `yaml@^2` dep lives HERE, safe-by-default, §6) → hand the parsed
  object to `policy.parseProjectPermissions`. fs or `yaml.parse`
  errors are wrapped as `PolicyLoadError` so every failure mode is
  one typed signal the caller maps to `policy_load_failed`.

**§4.2 Evaluator inputs (additive, optional).**
`EvaluateCommandInput` and `EvaluatePathReadInput` each gain
`permissions?: ProjectPermissions` (a plain optional field, matching
the existing `env?:` field — no `withProjectPermissions` wrapper).
`evaluateCommand`: after the existing recursive → `DANGEROUS_PATTERNS`
→ `ALLOWED_COMMANDS` chain, if still allowed and
`permissions.denyCommands.includes(input.command)` ⇒
`{ allowed: false, reason: "command_not_allowed" }` (reuse the precise
code; a project-denied command is "not allowed here"). Baseline
denials short-circuit first (I2); the project deny is the last
AND-gate. `evaluatePathRead`: after the `SECRET_PATH_PATTERNS` loop,
if still allowed and any `permissions.denyReadPatterns` matches the
`normalizePath`-normalized input ⇒
`{ allowed: false, reason: "secret_path_read" }`.

**§4.3 `policy_load_failed` deny code.** Add one member to
`policyDenyCodeSchema` (`deny-code.ts`), alphabetic (AA1 §17;
closed-enum tripwire) — it sorts between `path_denied` and
`recursive_megasaver`. 7 members total. `PolicyLoadError` is a typed
error class exported from policy (thrown by `parseProjectPermissions`;
re-thrown by the context-gate loader wrapping fs/yaml errors). The
orchestrator catches it and emits the `policy_load_failed` reason (it
never builds a `PolicyDenyCode` from a raw string). The MCP-side
`policy_load_failed` already exists in `mcpBridgeErrorCodeSchema`
(epic §8b L961) — this activates its policy-side counterpart.

## §5 Where it is wired

The orchestrator was extracted to `@megasaver/context-gate` (BB12).
Both entry points already compute `originPid` and inject it; the
project file loads at the SAME boundary, by the same owners.

**§5.1 Load once, in the orchestrator.** `resolveEffectiveSettings`
(`context-gate/src/read.ts:24`) already resolves `projectRoot`.
Extend `EffectiveSettings` with `permissions: ProjectPermissions |
null`. Because the loader can throw, resolve returns a discriminated
result:

```ts
type ResolveResult =
  | { ok: true; settings: EffectiveSettings }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string };
```

Both entry funcs (`runOutputExecCommand` in `run-command.ts`,
`runOutputPipeline` in `run.ts`) call resolve and, on
`policy_load_failed`, return a new typed outcome
`{ ok: false; reason: "policy_load_failed"; detail }` BEFORE any
spawn / `fs.readFile` — gate shut before IO, satisfying I3. The
loaded `permissions` then flows into `evaluateCommand`
(`run-command.ts:161`) and `runTwoGates` → `evaluatePathRead`
(`read.ts:50`).

**§5.2 Injection.** The context-gate `loadProjectPermissions` (which
internally calls `policy.parseProjectPermissions`) is injected into
the orchestrator like `spawn`/`now`/`newId` (default = real fn), so
orchestrator tests drive absent/valid/throwing without a real
filesystem.

**§5.3 Entry-point mapping.** CLI
`apps/cli/src/commands/output/exec.ts`: `policy_load_failed` → stderr
`error: policy_load_failed: <detail>` + non-zero exit (reuse the
failure-message path). MCP `mcp-bridge/src/tools/run-command.ts`:
`throw new McpBridgeError("policy_load_failed", …)` (enum slot already
present). File-read path (`runOutputPipeline` /
`mega_read_file`): same outcome → its CLI/MCP error surfaces.

**§5.4 `deny.write` at v0.9.** No `mega` write command consumes the
gate yet, so `deny.write` is parsed, validated, and exposed on
`denyWritePatterns` but has NO live enforcement call site. Specified
now so the schema is stable when a write path lands; loader + tests
cover it. Flagged as a known no-op to avoid a false sense of write
protection.

## §6 Alternatives considered

- **`allow:` support** — REJECTED (§3.1): escalation risk; the file
  is agent-writable.
- **`yaml` vs `js-yaml`** — choose **`yaml@^2`**. No YAML lib is a
  direct dep today (`js-yaml` is only transitive in the lockfile).
  `yaml.parse` is safe-by-default (no custom constructors / no
  code-exec on parse, unlike YAML-1.1 type tags), actively
  maintained, ESM-native, types bundled. A parse-time code-exec
  vector is unacceptable; `yaml`'s default `parse` closes it. Added to
  **`@megasaver/context-gate`** deps (the IO layer), NOT policy.
- **Pure-policy + IO-in-context-gate split (LOCKED, parent
  decision — §4.1).** `@megasaver/policy` exposes the PURE
  `parseProjectPermissions(raw)` (zod `.strict()` + glob compile, no
  fs/yaml, zero new deps); `@megasaver/context-gate` owns
  `loadProjectPermissions(projectRoot)` (fs read + `yaml.parse`,
  delegating validation to the pure parser). Rationale: the
  security-critical schema/validation stays with the evaluators in
  policy, which remains pure and fs-free in unit tests; only raw-text
  → object (`yaml.parse`) + the fs read live in the layer that
  already does IO (store reads, spawn). The earlier "loader-in-policy
  does fs" shape is REJECTED — it would add fs+yaml to a package whose
  evaluators are pure functions.

## §7 Definition of Done & test plan (TDD, tests first)

1a. **Pure parser** (`@megasaver/policy`) — valid object ⇒ compiled
   `ProjectPermissions`; unknown key / stray `allow:` / wrong-typed
   field ⇒ `PolicyLoadError` (I1, I3, §3.1); no fs touched.
1b. **IO loader** (`@megasaver/context-gate`) — absent file ⇒ `null`;
   valid file ⇒ compiled `ProjectPermissions`; malformed YAML /
   non-ENOENT fs error ⇒ `PolicyLoadError` (I3).
2. **Tighten-only (I1)** — `deny.commands: ["cat"]` denies `cat`, yet
   NO file re-allows `rm -rf /` (still `dangerous_pattern`) or a
   non-allowlisted `make` (still `command_not_allowed`), and none
   un-denies `**/.env`.
3. **Deny-precedence (I2)** — project-denied command/path ⇒
   `allowed:false` even where baseline would allow.
4. **Path-glob denial (I4)** — `deny.read: ["creds/**"]` denies
   `creds/x.txt`, `CREDS/X.TXT` (case), `creds\x.txt` (backslash);
   gate-2 symlink/`..` rejection unchanged.
5. **Fail-closed mapping** — orchestrator + CLI + MCP each turn a
   throwing loader into `policy_load_failed` / non-zero exit /
   `McpBridgeError`, with the injected spawn and `fs.readFile` NEVER
   called on that branch.
6. **Enum order** — `policyDenyCodeSchema` stays alphabetic
   (closed-enum tripwire test extended).

Gate: `pnpm verify` green; changesets for BOTH public-API changes
(`@megasaver/policy` — new `parseProjectPermissions` + deny-code
member; `@megasaver/context-gate` — new `loadProjectPermissions` +
`yaml` dep); `security-reviewer` + `critic` passes (HIGH);
author ≠ reviewer.

## §8 Resolved decisions (parent)

1. **Load home = `@megasaver/context-gate`** — confirmed (BB12
   extracted the orchestrator there, #88 merged). The load wires into
   `resolveEffectiveSettings` (`context-gate/src/read.ts`), injected
   like `spawn`/`now`/`newId`.
2. **`@megasaver/policy` stays PURE** — validation/compile live in the
   pure `parseProjectPermissions(raw)`; the fs read + `yaml.parse`
   (and the `yaml@^2` dep) live in `@megasaver/context-gate`. Policy
   gains no runtime deps. See §4.1 (LOCKED).

No open questions — spec is execution-ready.
