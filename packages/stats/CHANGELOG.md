# @megasaver/stats

## 1.0.1

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0

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

- 6078dc9: Add the `@megasaver/retrieval` and `@megasaver/stats` packages.

  `@megasaver/retrieval` provides standalone, pure BM25 ranking over chunked
  output text plus `DerivedIntent` derivation, giving the context gate a
  deterministic relevance signal without spawning git or holding a persistent
  index. `@megasaver/stats` adds the `SessionTokenSaverStats` and
  `TokenSaverEvent` Zod schemas with append/update helpers that persist under an
  injected store root (`<store>/stats/<projectId>/<sessionId>.json` +
  `.events.jsonl`) using the atomic-write pattern from `@megasaver/core`, so
  token-saver telemetry survives crashes without corrupting partial writes. Both
  expose their public surface from `index.ts` with closed, alphabetically pinned
  error-code enums.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [ae41534]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/output-filter@1.0.0
