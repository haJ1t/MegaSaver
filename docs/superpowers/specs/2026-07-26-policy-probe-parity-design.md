# Restore policy ReDoS probe parity

- Status: user-authorized release correction
- Risk: **MEDIUM** — benchmark-only source change guarded by a security regression test
- Source: GitHub Actions run `30209915950`, Ubuntu job `89814290161`

## Problem

`redos-probe.mjs` exports a local copy of each shipped policy regex so it can
measure their runtime. The newly added parity test compares those exported
regexes to the runtime table. It found that `connection_string_secret` in the
probe still uses the older quoted-value expression: it stops at the first
doubled quote. The shipped pattern was corrected in `230df3f7` to retain
doubled quotes inside an ADO.NET quoted secret.

The probe therefore measures a different regex than the product ships, making
any timing result for that detector misleading.

## Decision

Update only `NEW_DETECTORS.connection_string_secret.re` in
`scripts/redos-probe.mjs` to exactly match the shipped
`connection_string_secret` pattern. Keep the parity test strict; it is the
regression guard that exposed the drift.

## Acceptance criteria

1. The parity test's existing red assertion becomes green without changing its
   expectation.
2. `NEW_DETECTORS.connection_string_secret.re.source` equals the source of the
   shipped pattern byte for byte, including the doubled-quote alternatives.
3. The full policy test suite and `pnpm verify` pass locally.
4. Both GitHub Actions matrix jobs and the bundle smoke check pass before merge.

## Out of scope

No shipped redaction behavior, matching semantics, benchmark seed, public API,
or policy table ordering changes.
