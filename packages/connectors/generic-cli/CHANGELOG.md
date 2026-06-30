# @megasaver/connector-generic-cli

## 1.1.0

### Minor Changes

- 00bd97e: Phase 9 — Multi-Agent Connectors. `agentIdSchema` widens to eight
  members (adds `continue`, `gemini`, `windsurf`).
  `@megasaver/connector-generic-cli` ships three new flat-file targets:
  `geminiTarget` (`GEMINI.md`), `windsurfTarget` (`.windsurfrules`),
  `continueTarget` (`.continue/rules/megasaver.md`) — each a frozen
  target object reusing the existing sync path (no new sync code). The
  CLI registers them in `KNOWN_TARGETS` and adds two commands:
  `mega connector list` (known targets + present/absent, exit 0) and
  `mega connector doctor` (per-target exists/writable/in-sync vs stale,
  exit 1 on any stale/not-writable/error). Cross-agent shared memory is
  proven by an integration test (project memory synced to two agents
  lands byte-identically in both files). `vscode`/`jetbrains` (native IDE
  plugins) and a `mega connect` alias are out of scope. The four shipped
  targets (`claude-code`/`codex`/`cursor`/`aider`) are byte-identical.

### Patch Changes

- Updated dependencies [7fcd881]
- Updated dependencies [8ff3003]
- Updated dependencies [de4ffb2]
- Updated dependencies [44931b7]
- Updated dependencies [0a3256b]
- Updated dependencies [e2f7867]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [031f6de]
- Updated dependencies [391e659]
- Updated dependencies [31238a3]
- Updated dependencies [4e8c6e8]
- Updated dependencies [abfaf3b]
- Updated dependencies [a2b5643]
- Updated dependencies [4be82f8]
- Updated dependencies [900ce56]
- Updated dependencies [900ce56]
- Updated dependencies [f1fe1d3]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [27960fb]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [484f243]
- Updated dependencies [00bd97e]
- Updated dependencies [1db07df]
- Updated dependencies [39e5eb6]
- Updated dependencies [f46ce66]
- Updated dependencies [4fe5749]
- Updated dependencies [4c184db]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/connectors-shared@1.1.0
  - @megasaver/core@1.1.0

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

- a3a4401: Initial publish of `@megasaver/connector-generic-cli`. Manifest-driven
  connector that synchronises a Mega Saver block into per-agent config
  files. v0.1 ships the `codexTarget` (`AGENTS.md`).

### Minor Changes

- 0498b79: Add Cursor as a connector target. `agentIdSchema` widens to four
  members (adds `"cursor"`); `@megasaver/connector-generic-cli`
  ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
  and gains an optional `ConnectorTarget.header` field that the CLI
  prepends on first seed (used to write Cursor's required YAML
  frontmatter once). Existing `claude-code` and `codex` paths are
  byte-identical. `mega session create --agent cursor` and
  `mega connector sync demo --target cursor` work end-to-end.

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
