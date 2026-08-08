---
"@megasaver/output-filter": minor
"@megasaver/context-gate": minor
"@megasaver/bench-replay": patch
---

Token measurement on the saver hot path has a real bound. The 500 ms race in
`record-output` could never fire: `encode` is synchronous after memoization, so
the timer callback waited on the work it was meant to interrupt. Measured on
the shipped code, all with the budget silent — 8,000 characters of Japanese
prose took 24,267 ms, 32 KB of newlines 46,218 ms, and `"a"` followed by 50,000
spaces 114,331 ms. The PostToolUse saver runs on every tool call, so a padded
file or a cleared progress area hung the agent for tens of seconds per counter,
twice per event, after which the hook emitted nothing and the output passed
through uncompressed. All four now decline in ≤1 ms.

`countTokens` returns `number | null`; `null` means declined, never zero and
never an estimate. It reads the encoder's own split pattern from
`encoding.patStr` rather than restating it, and declines when
`SUM over matches of (MATCH_OVERHEAD_BYTES + bytes) * bytes` exceeds
`MAX_WORK_UNITS`. The sum is per match rather than a global maximum times a
global total: the latter lets one outlier poison the document around it, and
50 KB of clean log with a single 800-byte base64 line scored 22.7x the budget
under that form though it encodes in 31.8 ms. Both terms are load-bearing —
without the per-match floor, high-match-count input is admitted far past
budget; without counting whitespace matches, 32 KB of newlines scores zero
work, because cl100k matches a whitespace run as one match. Nothing is chunked,
so a returned count is the encoder's own output — exact, not approximate. The
new `tokenWorkUnits` export makes the decline decision assertable directly
instead of through a stopwatch. `longestRun`, `MAX_SAFE_RUN` and `CHUNK_SIZE`
are gone.

Overlay events gain an optional `tokenCountOutcome` of `"declined"`,
`"load-timeout"` or `"failed"`. Absence still means the count succeeded.
Without it all three were byte-identical downstream, so a tokenizer that
started throwing would have read as nothing more than a workload of large
outputs — and a load timeout, which is environmental, would have been filed as
a tokenizer bug.

`MAX_WORK_UNITS` is derived against a **loaded** machine, not an idle one: the
1500 ms per-tool-call ceiling divided by 4.3x measured contention, minus the
lazy `getEncoding` load and the guard's own scans, which sit inside the awaited
path and had previously gone uncounted. The work bound is exact and
deterministic; the wall-clock bound follows from it only up to ~4x contention,
and past that the fixed costs alone exceed the ceiling, so no work budget could
hold it. That limit is stated rather than implied.

Coverage on ordinary content: 186 KB of minified JSON, 141 KB of logs, 134 KB
of prose, 121 KB of TypeScript, 63 KB of wrapped base64, 30 KB of punctuated
Japanese, 240 KB of one-byte-match input — while a payload that is mostly long
rules is admitted only to about 1 KB. Mixed content is measured on its own
merits: a 50 KB log containing one 800-byte line is counted, not refused for
it. A declined row omits all three token fields; `mega audit honest` already
reports the resulting coverage, though `honest-metrics` then substitutes a
bytes/4 estimate that is +19.3% wrong on JSON, so declines are visible but not
free.

`TOKEN_COUNT_BUDGET_MS` is renamed `ENCODING_LOAD_BUDGET_MS`, keeping its
500 ms value and now bounding only the lazy encoding load, which really is
async. `@megasaver/bench-replay`'s `TokenCounters.count` widens accordingly and
`TokenDivergenceReport` gains `excludedCorpora`, so a declined corpus is named
rather than silently dropped from the divergence figure.

Note for anyone comparing across the upgrade: rows written before this change
with a long unbroken run were chunked and biased slightly upward, while the
same shapes are now exact-or-absent, so an aggregation window straddling the
deploy mixes two measurement regimes.
