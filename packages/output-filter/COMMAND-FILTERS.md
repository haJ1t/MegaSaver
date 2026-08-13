# Adding a command filter — mechanical recipe

The command-filter registry (`src/filters/index.ts`) is the volume moat:
each new filter is one module + one registry entry + one test. This
checklist is the complete recipe. Every requirement below is enforced
somewhere mechanical: the conformance harness (`test/filters/conformance.ts`)
checks 1–6 on the fixture; the W4 gate
(`packages/context-gate/test/save-integrity-command-filters.test.ts`)
checks 7; CI checks 8–9.

1. **Name:** kebab-case `<tool>-<subcommand>` (e.g. `git-status`). Append
   the name to `CompressorName` (`src/compress/index.ts`) after the current
   last member, AND to the persisted mirror `rankingTraceSchema.compressor`
   (`src/replay-trace.ts`) in the same order — the two form the
   append-only published contract.
2. **Module:** one pure module `src/filters/<name>.ts`. No IO, no
   dependencies, never throws. Unrecognized shape → return the input
   verbatim (safe no-op).
3. **Shape guard first.** Every collapse emits a counted `… [<n> <label>]`
   marker — the `EVIDENCE_MARKER` prefix contract (`src/markers.ts`) that
   `fitBudget` recognizes and preserves.
4. **Marker regexes:** anchored `^… \[` … `\]$`, flagless. All quantifiers
   bounded — no `^\s*` under `m`, no `/g` (stateless `.test`). Review
   against `wiki/concepts/unbounded-run-redos.md`.
5. **Integrity:** `"line-subset"` unless impossible: every delivered
   non-marker line appears verbatim (trim-compared) in the input.
   `"rewrite"` is only for filters that synthesize content (e.g. a header
   line) — it requires a bespoke integrity test (precedent:
   `test/compress-tsc-integrity.test.ts`) and declared synthesized forms,
   and is excluded from lossless claims.
6. **Registry:** append the entry at the END of `COMMAND_FILTERS`. A
   more-specific command may precede a general one only with a WHY comment
   (the order is first-match-wins and observable).
7. **Test:** `test/filters/<name>.test.ts` — a realistic SYNTHETIC fixture
   (fabricated shas/ids/image/pod names; never captured from a live
   system, never real secrets) + `assertFilterConformance` + behavior
   assertions for what stays, what folds, and what passes through.
8. **W4 inclusion:** add the fixture (as a compact row) to
   `packages/context-gate/test/save-integrity-command-filters.test.ts`.
   Size the row like the property-test corpus: large enough to compress,
   clear the admission guard (≥256 B AND ≥15% saved), and fit the mode
   budget in whole lines.
9. **Hot path:** never import `@megasaver/indexer` or `js-tiktoken` from
   `src/filters/` — the lazy-import guards (`test/no-eager-typescript.test.ts`,
   `test/tokens-real.test.ts`) must stay green.
10. **Release:** changeset (`@megasaver/output-filter` minor) + a note in
    `wiki/entities/output-filter.md`.
