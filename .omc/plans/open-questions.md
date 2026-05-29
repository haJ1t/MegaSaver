# Open Questions

## BB5 @megasaver/output-filter - 2026-05-29
- [ ] content-store placeholder dedupe — content-store does not exist in this worktree, so BB5 cannot "patch BB4 in-PR" per epic §14-bis. Whoever lands/rebases BB4 must type-import OutputSourceKind from @megasaver/output-filter instead of declaring a local enum. — Matters: avoids a duplicated/divergent closed enum across packages.
- [ ] Hamming dedupe threshold — spec pins HAMMING_DEDUPE_THRESHOLD=3 provisionally; confirm/tune against a real corpus during impl and document the final value in dedupe.ts. — Matters: too low keeps near-dupes, too high drops distinct evidence.
- [ ] Specialised-parser detection signatures (test-output / ts-diagnostic / stacktrace) are sketched, not pinned; exact regexes finalized during TDD against fixtures. — Matters: detection precedence determines which chunks rank as errors.
- [ ] Redaction ownership reconciliation — epic §9d literally says "BB5 lands the exact regexes" but BB3 (policy) already shipped redact() + REDACTION_PATTERNS. Spec §3.1 resolves this (BB5 imports policy.redact; tests verify pipeline invariant only). Confirm reviewers accept this reconciliation. — Matters: prevents duplicated, drift-prone redaction corpora.
