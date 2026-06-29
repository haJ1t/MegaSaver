---
"@megasaver/output-filter": patch
---

Four token-saver benchmark fixes for the output filter:

- **Timestamp folding**: bare wall-clock `HH:MM:SS` is now masked to `<ts>`, and
  the position guard is scoped to a real `file:line:col` (path token followed by
  `:line:col`) so a masked timestamp's `T`-separator can no longer masquerade as
  a source position. Guards run on the masked template, letting volatile-only
  log lines collapse while structural evidence is preserved.
- **Diff markers**: a trailing newline is treated as a line terminator, not a
  context line, so the empty tail element no longer inflates the
  `[N unchanged]` collapsed-context count by one.
- **Diagnostic dedupe**: diagnostic-class outputs (typescript, eslint,
  stacktrace, pytest, go_test, cargo_test) are exempt from simhash dedupe —
  each `error TSxxxx` is distinct evidence — while vitest/test stays deduped
  since its compressor already folds duplicate failures.
- **Intent pinning**: an exact intent-token hit gets a decisive score bump and
  the single best exact-intent match is pinned in `fitBudget` so budget
  pressure can never starve the declaration the read was for (still yields to
  the hard byte budget if it alone overflows).
