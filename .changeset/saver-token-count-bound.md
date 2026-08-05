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
`encoding.patStr` rather than restating it, computes `totalBytes` and
`maxMatchBytes` over that partition in one pass, and declines when
`(MATCH_OVERHEAD_BYTES + maxMatchBytes) * totalBytes` exceeds
`MAX_WORK_UNITS`. Both terms are load-bearing: without the floor term, `"a1"`
repeated has a one-byte largest match and is admitted at 5 MB where it takes
1.3 s; without counting whitespace matches, 32 KB of newlines scores zero work,
because cl100k matches a whitespace run as one match. Nothing is chunked, so a
returned count is the encoder's own output — exact, not approximate. The new
`tokenWorkUnits` export makes the decline decision assertable directly instead
of through a stopwatch. `longestRun`, `MAX_SAFE_RUN` and `CHUNK_SIZE` are gone.

Coverage on ordinary content is wide — 180 KB of prose, 150 KB of logs, 138 KB
of TypeScript, 225 KB of minified JSON, 69 KB of wrapped base64, 42 KB of
punctuated Japanese — while rule-heavy or unpunctuated-CJK payloads are
admitted only to about 1.3 KB. A declined row omits all three token fields;
`mega audit honest` already reports the resulting coverage, though
`honest-metrics` then substitutes a bytes/4 estimate that is +19.3% wrong on
JSON, so declines are visible but not free.

`TOKEN_COUNT_BUDGET_MS` is renamed `ENCODING_LOAD_BUDGET_MS`, keeping its
500 ms value and now bounding only the lazy encoding load, which really is
async. `@megasaver/bench-replay`'s `TokenCounters.count` widens accordingly and
`TokenDivergenceReport` gains `excludedCorpora`, so a declined corpus is named
rather than silently dropped from the divergence figure.

Note for anyone comparing across the upgrade: rows written before this change
with a long unbroken run were chunked and biased slightly upward, while the
same shapes are now exact-or-absent, so an aggregation window straddling the
deploy mixes two measurement regimes.
