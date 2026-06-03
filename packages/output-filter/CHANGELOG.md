# @megasaver/output-filter

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
