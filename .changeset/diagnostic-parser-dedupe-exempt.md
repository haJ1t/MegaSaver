---
"@megasaver/output-filter": patch
---

fix: exempt parser-detected diagnostics (eslint/pytest/go/cargo/stacktrace) from dedupe

`chunkByFormatWithMeta` now reports a `diagnostic` flag alongside `semantic`, set
for the parsers that emit one chunk per distinct diagnostic. `filterOutput` skips
simhash dedupe when that flag is set, so distinct eslint problems / pytest /
go-test / cargo-test failures / stack frames are no longer collapsed. These
outputs classify as `generic_shell`/`unknown`, so the existing
`DIAGNOSTIC_CATEGORIES` (keyed on classification) could not reach them. vitest /
generic test-output stay deduped.
