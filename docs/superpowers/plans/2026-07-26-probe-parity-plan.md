# Plan — make probe/table drift fail CI

Spec: [[docs/superpowers/specs/2026-07-26-probe-parity-design]]
Risk: MEDIUM. Branch `fix/probe-reads-shipped-table`, stacked on
`fix/policy-carrier-residuals` (PR #311), whose probe changes are the baseline.

## Steps

1. **Export the two "after" tables; guard the CLI.**
   → verify: `import()` of the probe prints nothing, exits 0, and returns
   exactly `AFTER, NEW_DETECTORS`. Without the guard the same import runs
   `timing` — confirmed, it ran for the full 2-minute timeout.

2. **Parity test** comparing real `RegExp` objects to the shipped union of
   `REDACTION_PATTERNS` + `OBSERVED_PATTERNS`.
   → verify: green means no drift remains; then mutate to prove it can fail.

3. **Mutation-verify the test** — a green-on-arrival test proves nothing.
   → verify four independent mutations each turn it red:
   source drift, flags drift, a renamed detector, and a dropped export.

4. **Confirm no CLI regression.** `assertSeedsMatch()` must still run for every
   real invocation now that it sits behind the guard.
   → verify: break a seed the guard actually checks (not one on
   `MATCH_FREE_BY_DESIGN`) and see `VACUOUS SEEDS` reported.

5. **Records.** Spec, plan, wiki entity + log. No changeset — no package public
   API changed.
   → verify: counts in prose computed, not eyeballed.

6. **Verify.** Forced policy typecheck + test, repo lint, conventions.
   → verify: report executed vs cached; `pnpm verify --force` does NOT force
   turbo (it is a `&&` chain, so pnpm appends the flag to the last command).

## Out of scope

Probe *coverage* of the 13 unseeded detectors, and the 3 dead
`MATCH_FREE_BY_DESIGN` entries (spec §5, §6).
