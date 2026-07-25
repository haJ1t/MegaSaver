# Plan — policy redaction ReDoS (instances 4 and 5)

Spec: [2026-07-25-policy-redaction-redos-design.md](../specs/2026-07-25-policy-redaction-redos-design.md)
Branch: `fix/policy-redaction-redos`

## 1. RED — growth-ratio guard at the real call site

Write `packages/policy/test/redact-redos.test.ts`:

- drives `redactWithFindings` (the exported sink), never a bare regex;
- samples at 50 KB and 100 KB, min over 5 trials, repeat count calibrated from
  one real call so a reverted bound reds out on the ratio instead of hanging;
- one case per triggering shape: a space run, a tab run, a ` \t` alternation
  (instance 5) and an `'a'` run plus an `'a.b_c1'` run (instance 4);
- asserts `ratio < MAX_GROWTH`.

**Verify:** all shape cases fail on unmodified `redaction-patterns.ts`.

## 2. GREEN — four bounds

Edit `packages/policy/src/redaction-patterns.ts` only:

1. `aws_secret_key`: trailing `\s*` → `\s{0,64}`
2. `api_key_header`: trailing `\s*` → `\s{0,64}`
3. `basic_auth_header`: `basic\s+` → `basic\s{1,64}`
4. `email`: `[A-Za-z0-9._%+-]+` → `[A-Za-z0-9._%+-]{1,64}`

**Verify:** step 1's cases pass.

## 3. Each bound is load-bearing, individually

For each of the four, in turn: revert that one bound in the source, run the
guard, record which case goes red, restore. All four must go red alone.

**Verify:** four recorded red runs, and the suite green again after each restore.

## 4. No redaction is lost

Add to the same test file:

- one positive per touched pattern — a real `aws_secret_access_key = <40 chars>`
  line, a real `x-api-key: <secret>` header, a real
  `Authorization: Basic <base64>` header — asserting the value is replaced by
  the marker and the structure survives;
- an equivalence sweep: for a corpus of shapes that matched before the change,
  assert the bounded pattern produces the same output as the unbounded one;
- a pin on `email`'s count for an over-long local part (still exactly 1);
- pins on the two deliberate divergences (>64 chars of padding; >64-char local
  part) so they are decisions, not surprises.

**Verify:** all green.

## 5. Consumers

`pnpm --filter @megasaver/policy test`, then `context-gate`, `output-filter`,
`core` — redaction sinks are shared. Then `pnpm verify`.

## 6. Paperwork

- `.changeset/policy-redaction-redos.md` (patch — behaviour preserved for every
  real shape; the two divergences are documented and out of RFC range).
- Amend the §5a `aws_secret_key` row footnote in
  `docs/superpowers/specs/2026-05-10-bb3-policy-design.md`, per the `jwt`
  precedent — amend, never rewrite.
- `wiki/concepts/unbounded-run-redos.md`: instances 4 and 5 → fixed.
- `wiki/log.md`: timestamped entry.
- Conventional commit on `fix/policy-redaction-redos`.
