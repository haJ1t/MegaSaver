---
title: Reject `deny.write` instead of silently ignoring it
status: proposed
risk: CRITICAL
created: 2026-07-25
builds-on: docs/superpowers/specs/2026-06-03-permissions-yaml-design.md
amends: "permissions-yaml §2 (YAML schema), §5.4 (deny.write at v0.9), §7 (DoD)"
package: "@megasaver/policy"
---

# Reject `deny.write` instead of silently ignoring it

> CRITICAL risk — this is permission code (`CLAUDE.md` §12), and the
> change makes a previously-accepted config file fail closed. Full
> chain + `critic` + `security-reviewer` + verifier required.

## §1 Problem

`.megasaver/permissions.yaml` accepts three peer keys under `deny:`:

```yaml
deny:
  read:     ["creds/**"]   # enforced — evaluatePathRead
  write:    ["creds/**"]   # NOT enforced — nothing reads it
  commands: ["make"]       # enforced — evaluateCommand
```

`parse-project-permissions.ts:57` compiles `deny.write` into
`ProjectPermissions.denyWritePatterns`. That field has **no consumer
anywhere in the repo** — only the type declaration, the assignment, and
four test assertions (three in `packages/policy/test/parse-project-permissions.test.ts`,
one in `packages/context-gate/test/load-project-permissions.test.ts:47`).
There is no `evaluatePathWrite` to pair with `evaluatePathRead`.

The defect is not the missing enforcement — permissions-yaml §5.4
deliberately scoped live write enforcement out. The defect is that the
**same object fails closed on a misspelled key and fails silent on a
real-but-dead one**:

| operator writes | today |
|---|---|
| `deny: { execute: [...] }` (typo) | `PolicyLoadError` — loud, fail-closed |
| `deny: { write: [...] }` (inert) | accepted, compiled, ignored — silent |

An operator writing a security policy gets a stronger signal for a
typo than for a rule that will never fire. `deny.write` presents as a
peer of two keys that work. That is a false sense of write coverage,
and permissions-yaml I3 (fail-closed) exists precisely to prevent the
gate from silently reading as more protective than it is.

Nothing operator-facing documents `deny.write` today: `README.md`
mentions `permissions.yaml` twice and never shows a `write:` key. The
only place the key is described is this repo's own design docs, which
an operator does not read before editing YAML.

## §2 Decision

**Reject `deny.write` at parse time with a `PolicyLoadError` whose
message names the key and says it is not enforced.** Remove
`denyWritePatterns` from `ProjectPermissions`.

Absence stays free: a file with no `write:` key is unaffected. Only a
file that *declares* write rules — the exact case that today buys
false confidence — fails closed.

## §3 Design

### §3.1 Schema (`packages/policy/src/parse-project-permissions.ts`)

`write` stays a **named** key in the shape, typed `z.never().optional()`:

```ts
write: z.never().optional(),
```

`.optional()` is load-bearing: bare `z.never()` would reject the
`undefined` of an absent key and fail every valid file.

Keeping `write` in the shape rather than deleting it is deliberate. If
it were deleted, `.strict()` would still reject it — but as
"unrecognized key", indistinguishable from a typo, which is the wrong
story: the key is real, it is spelled correctly, and it is not
enforced. Naming it in the shape also documents the rejection at the
one place a reader looks for the schema.

### §3.2 Error message

`parseProjectPermissions` selects the message from the zod issue paths:

```ts
const denyWrite = result.error.issues.some(
  (issue) => issue.path[0] === "deny" && issue.path[1] === "write",
);
throw new PolicyLoadError(denyWrite ? DENY_WRITE_MESSAGE : "invalid project permissions", {
  cause: result.error,
});
```

Every other failure mode keeps its current message byte-identical.

The message must be actionable, because it is what the operator sees.
`resolveEffectiveSettings` (`context-gate/src/read.ts:56`) puts
`err.message` into `detail`, and the file-read and MCP surfaces print
it (`policyLoadFailedMessage`, `McpBridgeError`). Message:

```
deny.write is not enforced: Mega Saver has no write gate, so these
globs would never deny anything. Remove the deny.write key; use
deny.read / deny.commands, which are enforced.
```

**Pre-existing gap, closed here** (raised by `security-reviewer`, and
correctly treated as blocking rather than deferrable): `mega output
exec` (`apps/cli/src/commands/output/exec.ts:124`) dropped `detail` and
printed only `command_denied: policy_load_failed`. That negates this
spec's whole rationale on the surface most likely to hit a bad file —
rejection-with-a-named-message was chosen over plain `.strict()`
deletion *because* the operator gets told, and there they were not.
`detail` now rides after the code
(`command_denied: policy_load_failed: <reason>`), preserving the
CLI/MCP code parity that motivated the original omission. Applies to
every `policy_load_failed` cause, not only `deny.write`.

`mega bench` (`apps/cli/src/commands/bench.ts:99`) has the same shape
but reduces a caught error to a bare deny code with no `detail` in
hand; leaving it is not a message-dropping bug of the same kind.

### §3.3 Type

`ProjectPermissions` loses `denyWritePatterns`. `denyReadPatterns` and
`denyCommands` are untouched. Nothing outside the two test files reads
the removed field, so there is no production call site to update.

## §4 Security analysis

- **I1 tighten-only** — unchanged. Rejecting a key cannot re-allow
  anything; the failure mode is deny, never allow.
- **I2 deny-precedence** — unchanged. No evaluator is touched.
- **I3 fail-closed** — strengthened. A config that previously loaded
  with a dead rule now denies until the operator fixes it.
- **I4 path-glob safety** — unchanged. `compileGlob` is untouched;
  `deny.read` compiles exactly as before.
- **No protection is lost.** `denyWritePatterns` denied nothing before
  this change, so no write that was blocked becomes permitted.

## §5 Blast radius (read this)

A project whose `permissions.yaml` declares `deny.write` goes from
"loads, write silently inert" to **every gated operation denied**:
`mega output exec`, `mega output file`, `mega output filter`, and the
MCP `read_file` / `run_command` / `search_code` tools all return
`policy_load_failed` until the key is removed.

Accepted. The break is loud, the message says exactly what to do, and
the fix is deleting three lines of YAML that never did anything. A
silent no-op in a security policy is the worse failure. No file in this
repo declares `deny.write`, and the key is undocumented outside design
docs, so the realistic blast radius is near zero.

Released as **major** for `@megasaver/policy` (1.2.2 → 2.0.0): a
previously-valid config is now rejected and a public type field is
removed. Both are breaking; neither should auto-merge as a minor.

## §6 Alternatives considered

- **(a) Implement `evaluatePathWrite` and wire it to the write paths —
  REJECTED.** permissions-yaml §5.4 scopes live write enforcement out,
  and there is no single write chokepoint to wire: `memory create`,
  `connector sync`, `handoff pack`, `brain export`, and `hooks install`
  all write independently. Gating some and not others reproduces this
  same false-coverage defect in a worse form — a gate that fires on
  some writes reads as a gate that fires on all of them. Real write
  enforcement is its own CRITICAL feature and needs its own spec, not a
  rider on an honesty fix. This decision does not block it: when a write
  gate lands, `write` returns to the schema with a call site behind it.
- **(c) Keep parsing it, document the gap — REJECTED.** Documentation
  does not reach the operator at the moment they edit YAML, and the
  silent accept stays. The spec already carries exactly this mitigation
  (§5.4: "Flagged as a known no-op to avoid a false sense of write
  protection") and it did not prevent the finding. Weakest option for a
  security surface; the parser is where the operator actually gets told.
- **Delete `write` from the schema and let `.strict()` reject it —
  REJECTED.** Correct outcome, wrong message: "unrecognized key" tells a
  correctly-spelled, semantically-real key that it is a typo.
- **Warn on stderr and continue — REJECTED.** Violates I3. A warning on
  a security file that still loads is the silent no-op with extra steps,
  and the gated surfaces (MCP tools) have no stderr an operator reads.

## §7 Definition of Done

1. TDD, red before green.
2. `deny.write` present (non-empty list, empty list, and null value) ⇒
   `PolicyLoadError` whose message names `deny.write`.
3. Absent `write` key ⇒ unchanged behaviour (the `.optional()` guard).
4. Every other malformed shape keeps the message `invalid project
   permissions` — asserted, so the message split cannot silently widen.
5. `ProjectPermissions` no longer declares `denyWritePatterns`
   (type-level; `tsc --noEmit` is the gate).
6. `loadProjectPermissions` propagates the named message end-to-end
   from a real YAML file on disk.
7. `pnpm verify` green.
8. `code-reviewer` + `critic` + `security-reviewer` passes, fresh
   context, author ≠ reviewer.
9. Changeset (major), wiki `entities/policy` update, `log.md` entry,
   permissions-yaml §5.4 amended to point here.
