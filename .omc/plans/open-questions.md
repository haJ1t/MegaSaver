# Open Questions

## BB5 @megasaver/output-filter - 2026-05-29
- [ ] content-store placeholder dedupe — content-store does not exist in this worktree, so BB5 cannot "patch BB4 in-PR" per epic §14-bis. Whoever lands/rebases BB4 must type-import OutputSourceKind from @megasaver/output-filter instead of declaring a local enum. — Matters: avoids a duplicated/divergent closed enum across packages.
- [ ] Hamming dedupe threshold — spec pins HAMMING_DEDUPE_THRESHOLD=3 provisionally; confirm/tune against a real corpus during impl and document the final value in dedupe.ts. — Matters: too low keeps near-dupes, too high drops distinct evidence.
- [ ] Specialised-parser detection signatures (test-output / ts-diagnostic / stacktrace) are sketched, not pinned; exact regexes finalized during TDD against fixtures. — Matters: detection precedence determines which chunks rank as errors.
- [ ] Redaction ownership reconciliation — epic §9d literally says "BB5 lands the exact regexes" but BB3 (policy) already shipped redact() + REDACTION_PATTERNS. Spec §3.1 resolves this (BB5 imports policy.redact; tests verify pipeline invariant only). Confirm reviewers accept this reconciliation. — Matters: prevents duplicated, drift-prone redaction corpora.

## BB6 @megasaver/retrieval + @megasaver/stats - 2026-05-29
- [ ] Stats reset UX (epic §13c / §20b) — BB6 ships the locked "zero summary, keep events" behaviour, but the epic marks it tentative. BB10 design:design-critique may flip it to "preserve summary, show lifetime savings after disable". — Matters: changing it later alters resetOnDisable's contract and the GUI badge semantics.
- [ ] resetOnDisable totals zeroing while events.jsonl is preserved means summary and events can diverge by design. Confirm BB10 GUI reads lifetime savings from the events log (not the zeroed summary) if lifetime display is wanted. — Matters: determines whether the audit log must stay the source of truth for lifetime stats.
- [ ] @megasaver/output-filter must be built before @megasaver/stats can type-import OutputSourceKind. The plan mandates a pnpm install + pnpm -r build after scaffolding; confirm turbo build ordering resolves this in CI as well as locally. — Matters: a missing build step makes stats typecheck fail on a cold checkout.

## BB4 @megasaver/content-store - 2026-05-10
- [ ] OQ-1: Atomic-write parity test — exercise core through its public write surface, or import the unexported atomicWriteFile via a guarded deep test-only specifier? Decide at impl time based on whether core's public surface can reach all five §6 scenarios. BB4 must NOT add a core export either way. — Matters: determines the test fixture shape and keeps BB4's diff inside its package.
- [ ] OQ-2: listChunkSets ordering is unspecified by contract. If BB7a/BB8 need a guaranteed order, add it in that PR; do not speculatively add now. — Matters: avoids premature abstraction while leaving the door open for consumers.
- [ ] Risk reconciliation: epic §14 classes BB4 as MEDIUM, but the BB4 directive + child spec frontmatter set risk:HIGH (redaction-flag + durability). Confirm HIGH stands; reviewer may upgrade, never silently downgrade (CLAUDE.md §12). — Matters: HIGH triggers architect design + critic review in the chain.
- [ ] Output-filter is already landed in this worktree, so BB4 imports OutputSourceKind directly (no §14-bis local placeholder/dedupe). Confirm this matches the intended landing order on the integration branch. — Matters: if BB4 is rebased onto a base WITHOUT output-filter, the §14-bis placeholder path must be reinstated.
