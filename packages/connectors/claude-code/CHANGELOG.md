# @megasaver/connector-claude-code

## 1.0.2

### Patch Changes

- @megasaver/core@1.0.2
- @megasaver/connectors-shared@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [a2526d3]
  - @megasaver/core@1.0.1
  - @megasaver/connectors-shared@1.0.1

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

- 59fca3a: Add the initial Claude Code connector with deterministic root `CLAUDE.md`
  managed-block rendering, validation, and sync helpers.
- a3a4401: Refactor `@megasaver/connector-claude-code` to delegate render, parse,
  upsert, remove, and filesystem operations to
  `@megasaver/connectors-shared`. Rendered block is byte-identical
  (regression test asserts).

  BREAKING (input shape): `ClaudeCodeContextSchema` now requires a
  top-level `agentId: "claude-code"` field — previously the agent
  identity was hardcoded inside the renderer and the schema only
  validated `{ project, session, memoryEntries }`. Callers constructing
  a `ClaudeCodeContext` literal must add `agentId: "claude-code"`. All
  exported function names and rendered output remain unchanged.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [0c30651]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [a3a4401]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/connectors-shared@1.0.0
  - @megasaver/core@1.0.0
