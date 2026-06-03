# @megasaver/output-filter

## 1.1.0

### Minor Changes

- 7b978d3: Add four format-aware output parsers: pytest, go test, cargo test, and eslint.

  The format-aware chunker (`chunkByFormat`) now recognizes these tool outputs and
  chunks them by failure boundary instead of by fixed line windows, so failing
  tests and their tracebacks/assertions/panics rank above passing-run noise.
  Each parser ships a `detectX`/`parseX` pair wired into `chunkByFormat` ahead of
  the generic test-output detector (framework outputs are themselves test output;
  ordering most-specific to least keeps each fixture routed to its own parser).
  Public API is unchanged — the new parsers are reached only through
  `chunkByFormat`.

### Patch Changes

- 19def67: Broaden the output-filter ranker's failure markers so Phase-3a parser chunks
  score correctly. The ERROR signal now matches CamelCase exception names
  (`ZeroDivisionError`, `AssertionError`, `TypeError`, `ParseError`) via a
  case-sensitive `[A-Z][A-Za-z]*Error\b` arm, and the panic signal matches
  Rust's `panicked` (`\bpanic(ked)?\b`). Previously a pytest `ZeroDivisionError`
  traceback or a Rust `panicked … ParseError` block scored as low as 1 (file
  path only) while its summary line scored ~9, so failures under-ranked
  passing-run noise. Lowercase `error` keeps its existing `\berror\b/i`
  precision, so benign prose like "error handling is configurable" is not
  over-boosted.
- Updated dependencies [bb3d179]
  - @megasaver/policy@1.1.0

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- ae41534: Add the `@megasaver/output-filter` package: an evidence-preserving
  output filter pipeline (normalize, chunk, dedupe via SimHash, rank,
  summarize, fit-to-budget) plus a `resolveSafeReadPath` sandbox gate.
  Parsers for stack traces, test output, and TS diagnostics keep the
  high-signal evidence agents need while dropping noise, so we cut
  tokens without blinding the model. Public surface re-exported from
  `index.ts` with a closed `outputFilterErrorCodeSchema` enum.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [61efb28]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/policy@1.0.0
