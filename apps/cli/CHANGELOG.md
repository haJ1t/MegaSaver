# @megasaver/cli

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

- 4660d37: Add the `mega session saver {enable,disable,status,stats}` command surface
  (AA1 epic, BB2). `enable` toggles Mega Saver Mode on a session with a
  required `--mode safe|balanced|aggressive`, persisting `tokenSaver`
  settings via `CoreRegistry.updateTokenSaver`; `disable` clears the
  enabled flag; `status` and `stats` report current state. `--mode` is
  rejected on the non-enable subcommands. `stats` reports settings only and
  signals that per-call event stats arrive with BB6 (no faked data source).
  A new `invalidModeMessage` / `unexpectedModeMessage` pair is exported from
  `apps/cli/src/errors.ts`.
- 67d66dc: Add the `mega output {file,filter,chunk}` CLI surface. `mega output file`
  reads an on-disk file through the two-gate path-safety pipeline, runs it
  through `filterOutput`, and optionally persists the resulting chunk-set.
  `mega output filter` runs an existing log file through the same filter
  pipeline (sandbox resolver only) so `pnpm test > log.txt && mega output
filter` works. `mega output chunk` returns a single stored chunk from a
  previously persisted chunk-set, located by `<chunk-set-id>` alone. No
  child-process execution is introduced (enforced by a `no-child-process`
  guard test); the commands wire `@megasaver/policy`,
  `@megasaver/output-filter`, and `@megasaver/content-store` into the CLI
  behind the existing path-safety and redaction gates.
- 751df6c: Add `mega output exec` — the first user-visible child-process spawn in
  Mega Saver. A new core orchestrator `runOutputExecCommand`
  (`packages/core/src/context-gate/run-command.ts`, re-exported from the
  `context-gate.ts` barrel) spawns a policy-gated child process and runs
  its combined stdout+stderr through the redact -> filter -> store ->
  stats pipeline; the `mega output exec` CLI command is a thin adapter
  that calls it, and BB8's MCP `mega_run_command` will reuse the same
  entry point.

  Security invariants enforced and tested: `policy.evaluateCommand` runs
  BEFORE spawn (deny-before-spawn, with a spawn-never-called assertion on
  every denial branch — `command_not_allowed`, `dangerous_pattern`,
  `recursive_megasaver`); `MEGASAVER_ORIGIN_PID` is set on the spawned
  child env and checked on entry so a descendant re-entering Mega Saver is
  denied `recursive_megasaver`; redaction runs before persistence (the
  raw unredacted output is never stored). The child's exit code is
  mirrored on a clean run; `--timeout`/`--max-bytes` bounds (defaults 300s
  / 20MB) force-terminate but still persist the partial output as exit 1.

  `@megasaver/core` now depends on `@megasaver/stats` for the stats step;
  this is acyclic (stats never imports core) and the dependency-direction
  allow-list is widened accordingly. `@megasaver/cli` gains no direct
  stats dependency — it consumes the orchestrator through
  `@megasaver/core` only.

- 0e9be7a: BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
  mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
  widened to 16 members, McpToolName closed enum, the
  `mega mcp install/repair/serve/status/uninstall` CLI, and the
  `McpSetupOps` facade (with `aggregateMcpStatus` reporting
  `mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
  per agent) wired into the GUI bridge as the production `mcpOps`.
  Replaces the v0.3 not_implemented placeholder. createBridge API
  preserved (AA1 §2c).

  `mega mcp serve` is the long-running stdio launch entry an agent
  spawns to reach the bridge: it resolves the store + a
  JsonDirectoryCoreRegistry (as `mega output exec` does), starts the
  bridge over stdio, and shuts down cleanly on stdin-EOF / SIGINT /
  SIGTERM. To make the installed config runnable, `installMcp` now
  writes `{ command, args }` (idempotency compares both) and
  `mega mcp install`/`repair` default to `command: "mega"`,
  `args: ["mcp", "serve"]` instead of the unlaunchable `"mega-mcp"`
  literal (gap found by the AA1 §16 live smoke).

- 367d325: feat: add session CRUD CLI commands and core endSession method

  `@megasaver/core` gains `CoreRegistry.endSession(id, { endedAt })`
  on both registry implementations and a new `session_already_ended`
  error code. `@megasaver/cli` gains four `mega session` subcommands
  (`create`, `list`, `show`, `end`) plus the supporting CLI error
  helpers.

- cfab2fa: Add `mega connector status <projectName> [--target <id>]` — read-only
  report of per-target sync state. Status words: `in-sync`, `drift`,
  `no-block`, `missing`, `error`. Exit `0` when every line is `in-sync`
  or `missing`; `1` if any line is `drift`, `no-block`, or `error`.
- aa6bee3: feat: add `mega connector sync` CLI command

  Wires the existing `@megasaver/connectors-shared` and
  `@megasaver/connector-generic-cli` primitives into a single user-facing
  verb. `mega connector sync <projectName>` writes a Mega Saver block
  into each known agent file (`CLAUDE.md`, `AGENTS.md`) under the
  project's `rootPath`. Default behaviour skips files that do not
  already exist; `--target <id>` opts a specific target into seeding.
  Best-effort partial failure: each target reports its status (`wrote`,
  `noop`, `created`, `skipped`, `error`) on stdout; exit 1 if any
  target failed.

- 04987a8: Add `mega session update <sessionId> [--title …] [--risk …] [--agent …]`
  for partial mutation of an open session. Empty `--title ""` clears
  to `null`; ended sessions are rejected (`session_already_ended`);
  `mega session update <id>` with no flags emits `error: nothing to
update`. `@megasaver/core` exports `sessionUpdatePatchSchema` and a
  new `CoreRegistry.updateSession(id, patch)` method on both the
  in-memory and JSON-directory implementations. `apps/cli`'s
  `commands/session.ts` is split into a `commands/session/`
  directory closing v0.1 backlog item I5.
- 7a199b6: Add `mega memory create/list/show` subcommands as a thin CLI layer
  over the existing `CoreRegistry.{createMemoryEntry,getMemoryEntry,
listMemoryEntries}` surface. Append-only ledger; no `delete` or
  `update`. `--content` rejects empty / control-char / multi-line at
  the CLI boundary via a new `contentSchema` (mirrors `titleSchema`).
  Cross-field guard: `--scope project` rejects `--session`;
  `--scope session` requires `--session <uuid>`. `mega connector
sync` / `status` continue to pass `memoryEntries: []` to
  `buildConnectorContext` — wiring to read real entries is a
  separate slot.

### Patch Changes

- 0c30651: Ship the final AA1 epic surface (BB11): GUI AgentSetupDoctor + connector
  CONTEXT_GATE block.

  `@megasaver/connectors-shared` gains `renderContextGateBlock` (rendered only
  when `session.tokenSaver?.enabled === true`) plus the `MEGA SAVER:CONTEXT_GATE`
  sentinel constants. `parseBlock(content, sentinels?)` is now parameterised by
  sentinel pair (defaulting to the legacy pair, so every existing caller is
  byte-unaffected) and `upsertBlock` manages the legacy + CONTEXT_GATE blocks in
  one pass.

  `@megasaver/mcp-bridge` hoists `DEFAULT_MCP_COMMAND` / `DEFAULT_MCP_ARGS`
  (`mega` + `["mcp","serve"]`) and threads an optional `args` through
  `buildMcpSetupOps` so the written MCP config is a runnable launch command.

  `@megasaver/gui` adds the Agent setup view (`agent-setup-doctor` +
  `agent-setup-row`), four zod-validated bridge routes under `/api/mcp/*`
  (status/install/repair/uninstall) consuming BB8's `McpSetupOps`, the
  `mcp_setup_failed` bridge error code, api-client methods, and the
  `agent-setup` nav tab. The GUI bridge now writes a runnable `mega mcp serve`
  launch command on install.

  `@megasaver/cli` connector-sync now seeds a brand-new agent file via
  `upsertBlock` (so it also receives the CONTEXT_GATE block when the session has
  Mega Saver Mode enabled); output stays byte-identical for tokenSaver-off
  sessions.

- 084123d: Extract the context-gate output orchestrator into `@megasaver/core`. The
  redact/gate/read/filter/persist pipeline and chunk lookup now live in
  `packages/core/src/context-gate/` behind the `context-gate.ts` barrel,
  exposing `runOutputPipeline`, `fetchChunk`, and `locateChunkSet` plus the
  supporting helpers. The `mega output {file,filter,chunk}` CLI commands
  become thin adapters that call the core orchestrator instead of owning the
  pipeline locally; behavior is preserved. This gives BB8 a single
  package the MCP bridge can import (§2a/§8d). A dependency-direction test
  enforces the §3c cycle guard: core depends only on shared, policy,
  output-filter, and content-store, and never on mcp-bridge or apps.
- b0e4382: Wire `mega connector sync` and `mega connector status` to read
  real memory entries via `registry.listMemoryEntries(project.id)`.
  The connector context now includes project-scoped entries plus
  session-scoped entries belonging to the target's
  currently-picked open session. Other agents' session-scoped
  memory is filtered out. Empty-memory projects continue to render
  `- none` byte-identically.
- abd3414: Fix `mega connector status`: swap `pickLatestOpenSession` to a
  `Date.parse` numeric comparator (correct ranking under mixed
  RFC 3339 offsets) and emit the `session=<id|none>` suffix on the
  `error` status line for column symmetry across all five status
  words. Sync output is unchanged.
- 0498b79: Add Cursor as a connector target. `agentIdSchema` widens to four
  members (adds `"cursor"`); `@megasaver/connector-generic-cli`
  ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
  and gains an optional `ConnectorTarget.header` field that the CLI
  prepends on first seed (used to write Cursor's required YAML
  frontmatter once). Existing `claude-code` and `codex` paths are
  byte-identical. `mega session create --agent cursor` and
  `mega connector sync demo --target cursor` work end-to-end.
- Updated dependencies [93840ac]
- Updated dependencies [0c30651]
- Updated dependencies [61efb28]
- Updated dependencies [a8b6531]
- Updated dependencies [ae41534]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [0e9be7a]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [a3a4401]
- Updated dependencies [a3a4401]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/connectors-shared@1.0.0
  - @megasaver/mcp-bridge@1.0.0
  - @megasaver/policy@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/output-filter@1.0.0
  - @megasaver/core@1.0.0
  - @megasaver/connector-generic-cli@1.0.0
