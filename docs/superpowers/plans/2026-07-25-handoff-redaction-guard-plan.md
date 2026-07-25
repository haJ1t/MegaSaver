# Handoff redaction guard — plan

Spec: [2026-07-25-handoff-redaction-guard-design.md](../specs/2026-07-25-handoff-redaction-guard-design.md)

1. Add the zod string-leaf walker + classification lists to
   `packages/core/test/handoff-export.test.ts`.
   → verify: test enumerates the real schema surface.
2. Add the behavioral test planting one secret in every redacted path.
   → verify: **RED** on `git.branch`, reproducing review finding 2.
3. Redact `git.branch` in `buildHandoffPacket`, preserving `null`.
   → verify: green; the 31 pre-existing handoff-export tests still green.
4. Changeset + spec + plan; `pnpm verify`.
5. External review: `code-reviewer` + `critic` (HIGH risk, §12).
6. Address review findings (see below).
   → verify: per-field RED proof for each new redaction, fail-closed proof
   for the walker, `pnpm verify` exit 0.

## Review findings addressed

Both reviewers independently found the guard was fail-open, and the critic
found the classification itself blessed live leaks.

- **Walker failed open** on ~12 zod shapes (`z.record`, `z.union`,
  `.catch()`, `.pipe()`, …) — a new field in any of them would pass CI
  unredacted. Now throws on unrecognized types.
- **Five fields misclassified as STRUCTURAL** were leaking secrets today:
  `git.changedFiles[].path`, `git.diff.excludedPaths[]`,
  `memories[].anchor.files[].path`, `memories[].anchor.symbols[].path`,
  `memories[].anchor.symbols[].name`. The three git paths are now redacted;
  the anchor keys turned out to need dropping instead — see round two.
- **Behavioral test was negative-only**, so it passed vacuously for any path
  the fixture did not populate. Now derived from `REDACTED_PATHS` with a
  per-path presence assertion.
- **`failures[].resolution` is unreachable** — moved to its own list with a
  test that keeps it unreachable.

Round-two review (after the above landed) found three more:

- **Redacting anchor paths in place caused a false `contradicted`** on the
  receiver — `code-truth` uses path/name as lookup keys, so a rewritten one
  resolves to nothing and auto-closes `validTo`. Now the whole anchor (plus
  `lastVerified`) is dropped when any key is dirty; a clean anchor passes
  through untouched. New `DROPPED_PATHS` list, two tests.
- **`STRUCTURAL_PATHS` had no runtime assertion**, so a future leaky field
  could be waved through by appending it there — the round-one mistake,
  repeatable. Now every populated structural value must match a machine shape.
- **`.catchall()` / `.passthrough()` still passed silently** through the
  ZodObject branch, and `valuesAt` could not resolve nested arrays. Both
  closed.

## Evidence

Step 2 RED (before step 3):

```
FAIL  redacts a secret planted in every free-text field at once
AssertionError: expected '{"taskSummary":...' not to contain
'sk-ant-api03-abcdefghij0123456789'
  ..."git":{"branch":"feat/sk-ant-api03-abcdefghij0123456789",...
```

Every other field in that payload showed `sk-ant-[REDACTED]`; only
`git.branch` carried the raw secret.

Step 6 — each new redaction reverted one at a time, test re-run:

```
revert branch    → git.branch leaked the secret: 'feat/sk-ant-api03-…'
revert changed   → git.changedFiles[].path leaked the secret: 'src/sk-ant-api03-…'
revert excluded  → git.diff.excludedPaths[] leaked the secret: '.env.sk-ant-api03-…'
revert anchor    → memories[].anchor.files[].path leaked the secret: 'src/sk-ant-api03-…'
```

All four are load-bearing.

Fail-closed proof — `notes: z.record(z.string()).optional()` added to
`handoffPayloadSchema`, then reverted:

```
Error: unclassifiable zod type ZodRecord at notes
```

Final: `packages/core` 37/37; `pnpm verify` 56/56 tasks, exit 0.
