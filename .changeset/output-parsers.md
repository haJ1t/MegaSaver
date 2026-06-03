---
"@megasaver/output-filter": minor
---

Add four format-aware output parsers: pytest, go test, cargo test, and eslint.

The format-aware chunker (`chunkByFormat`) now recognizes these tool outputs and
chunks them by failure boundary instead of by fixed line windows, so failing
tests and their tracebacks/assertions/panics rank above passing-run noise.
Each parser ships a `detectX`/`parseX` pair wired into `chunkByFormat` ahead of
the generic test-output detector (framework outputs are themselves test output;
ordering most-specific to least keeps each fixture routed to its own parser).
Public API is unchanged — the new parsers are reached only through
`chunkByFormat`.
