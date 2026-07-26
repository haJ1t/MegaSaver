# Plan — close the three disclosed carrier gaps

Spec: [[docs/superpowers/specs/2026-07-26-carrier-residual-gaps-design]]
Risk: CRITICAL. Branch `fix/policy-carrier-residuals` off `origin/main` in a
worktree; no edits on `main`.

## Steps

1. **Red.** Add the twelve measured leaks as fixtures in
   `packages/policy/test/redact-superlinear.test.ts` under the existing
   `vendor and connection-string carriers` describe.
   → verify: all twelve fail, and the two controls (`glpat-`, `;Password=`)
   pass, so the fixtures are not vacuous.

2. **`slack_webhook_url`.** Insert at index 4, immediately after `jwt`.
   → verify: red tests 1–2 go green; the non-vacuity gate fails on the missing
   canonical positive and the table-length pin (39), proving both guards live.

3. **Pins for the new row.** Byte pin, `.flags` pin, non-vacuity entry, table
   length 39 → 40, and extend the ordering `it.each` list to include it. Use
   `gi`, not `g`, because URI scheme and DNS host matching is case-insensitive.
   → verify: gate green; flipping the insertion index to last reddens the
   ordering test (guard is load-bearing, not decorative).

4. **`gitlab_token`.** Extend the alternation; update its byte pin.
   → verify: red tests 3–9 green; `glpat-` control still green.

5. **`connection_string_secret`.** Bounded `\s{0,8}` gaps + quoted
   alternatives + 4096 bounds; update its byte pin.
   → verify: red tests 10–14 green; the existing
   "stops at whitespace, not just at the next `;`" and `PWD=` negative tests
   stay green.

6. **Measure, per spec §4.** Add probe seeds for the three detectors to
   `scripts/redos-probe.mjs`, each an anchor with no terminator; the probe's
   own `assertSeedsMatch()` refuses a vacuous seed.
   → verify: growth per doubling ~2.0 at 100/200/400 KB; benign 200 KB log
   constant same order as before. If growth > 2.0, shrink the gaps (spec §4),
   do not weaken the guard.

7. **Records.** Amend §5b: three rows leave the disclosed-gap table, five new
   disclosed losses enter it, `slack_webhook_url` joins the §5b enumeration
   (30 → 31 post-lock rows). Changeset. Wiki `policy` entity + `log.md`.
   → verify: `grep` asserts the old gap sentences are **gone** and the new ones
   present — a bare `.replace()` that silently no-ops is exactly how the §5a
   "strict superset" claim shipped false in #309.

8. **Verify.** `pnpm verify --force` (not a cached replay), full policy suite,
   `biome check`.
   → verify: report executed counts, not `FULL TURBO` cache hits; check
   `Test Files` as well as `Tests`, because an unbuilt workspace dep makes
   files fail to load while the `Tests` line still reads green.

## Out of scope

`pk_`, `Pwd=`, Twilio secrets, `_gitlab_session=`, and the ~28 designed-not-
shipped detectors in the 2026-07-19 baseline-extension design (ADR follow-up
F4). Each is settled or separately tracked.
