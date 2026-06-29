---
title: Template-line folding (collapseSimilar)
status: approved
risk: high
created: 2026-06-29
---

# Template-line folding (collapseSimilar)

## Goal

Collapse runs of consecutive log lines that are identical except for
volatile tokens (timestamps, ids, ports, byte/duration counts) into a
single exemplar plus a count. `collapseRepeatedLines` already handles
byte-identical runs; it misses build/install/server log spam where each
line differs only by a clock value or request id, so those runs survive
verbatim. This pass targets that lever: ~80–90% fewer lines on noisy
logs while staying lossless and evidence-preserving.

## Mechanism

A second pass, `collapseSimilar`, runs in
`packages/output-filter/src/normalize.ts` AFTER `collapseRepeatedLines`.

1. For each line, compute a MASKED form: replace pure identity-noise
   tokens with stable placeholders — ISO/clock timestamps, uuid ids, long
   hex ids (requiring at least one `a-f` letter so pure-decimal ids never
   match), and request-id port numbers. Duration, byte-count, and bare
   decimal-number masks are deliberately NOT applied: those values are
   often the distinguishing signal and the return path is the only copy
   the agent sees (see Lossless note), so masking them would silently drop
   evidence.
2. Fold a run of consecutive lines whose MASKED form is identical into:
   - the FIRST concrete instance, verbatim;
   - a marker line: `… [N similar: <masked template>]`;
   - the LAST concrete instance, verbatim.
   `N` is the run length. First and last are kept as boundary evidence.
3. Runs of length 1 (no following match) are emitted unchanged.

Pure, deterministic, no LLM.

### Conservative masking (HARD constraints — risk HIGH, §12)

- Do NOT fold any line containing `error`, `failure`, `exception`,
  `warning`, `panic` (case-insensitive) or a diagnostic code.
- Do NOT mask the numeric parts of error codes or `file:line:col`
  positions — those distinguish real events.
- Never collapse two lines that differ in anything an agent needs to
  tell two real events apart.
- When in doubt, do not fold.

## Files to touch

- `packages/output-filter/src/normalize.ts` — add `collapseSimilar`,
  invoke it after `collapseRepeatedLines` inside `normalize`.
- test file alongside it (TDD) covering the cases below.

No changes to `classify.ts`, `compress/`, or `compressByCategory` —
this is a normalize pre-pass and stays tool-resident (runs in both the
CLI saver hook and the MCP `mega_run_command` / `mega_read_file` paths).

## Lossless / evidence-preservation note

Compression only changes what is RETURNED. NOTE: in this repo the
persisted ChunkSet is built from the filtered excerpts
(`context-gate` run-command / read paths), not from raw output, so a
folded middle line does NOT reach the ChunkSet and is NOT recoverable
via `mega_fetch_chunk`. The return path is therefore treated as the only
copy the agent sees. Folding is kept safe by narrowing the masks (no
duration/byte/decimal masks — those carry signal) rather than by relying
on a recovery net. Keeping the first AND last concrete instance preserves
run boundaries; the keyword/position/decimal guards ensure no two distinct
errors, diagnostics, or value-bearing events are ever merged or hidden.

## Test plan

1. Timestamp-only-varying log lines fold to one exemplar + count, with
   the FIRST and LAST concrete instance kept verbatim.
2. Two DISTINCT error lines do NOT fold — the keyword guard holds.
3. Lines with differing meaningful (non-masked) content do not fold.
4. A single line (run length 1) is untouched.
5. The pass is a no-op on already-unique text.

## Out-of-scope

- Non-consecutive / interleaved similar lines (only consecutive runs).
- Cross-category or structured (JSON/diff) folding — handled by their
  own compressors.
- Any LLM-based or fuzzy similarity matching.
- Changing what is persisted or recoverable — return-only change.
