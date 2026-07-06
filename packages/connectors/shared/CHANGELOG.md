# @megasaver/connectors-shared

## 1.2.1

### Patch Changes

- @megasaver/core@1.2.1

## 1.2.0

### Minor Changes

- 326ed5a: Edit impact: surface the blast radius of an edit — impacted callers and the
  tests to run — directly to connected agents, without manual dependency lookup.

  - `@megasaver/mcp-bridge`: new `get_edit_impact` MCP tool. Seeds from
    `changedFiles` (or `git diff --name-only HEAD`, degrading gracefully to an
    empty set on non-git roots), merges per-seed impact packs deduped by block
    id, and returns the impacted callers plus `suggestedTests` — the test-typed
    blocks inside the merged radius.
  - `@megasaver/connectors-shared`: the context-gate block now instructs the
    agent to call `get_edit_impact({ projectId })` after editing files so
    impacted callers and suggested tests surface automatically.

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/core@1.2.0
  - @megasaver/shared@1.2.0

## 1.1.0

### Minor Changes

- 8ff3003: Agent Office Phase 1: add the agent-agnostic AgentLauncher interface
  (+ LauncherError) and a claude-code adapter that runs one headless
  `claude -p` task with stream-json output. Spawn is injectable; the
  engine/supervisor wiring lands in Phase 2.
- de4ffb2: Agent Office Phase 2: supervisor engine, permission gating, audit log

  - `@megasaver/agent-office`: add `createSupervisor` (processNextTask /
    drainAgent / runWorkspace), `resolveLauncherPermission` (safe-by-default
    full gate), `createLauncherRegistry`, `auditEventSchema` /
    `appendAudit` / `listAudit`. Tighten `workspaceKey` to `workspaceKeySchema`
    on `OfficeAgent` and `OfficeTask`. Add `permission_denied` and
    `launcher_not_registered` error codes.

  - `@megasaver/connectors-shared`: `LaunchHandle.cancel(signal?)` now accepts
    an optional `NodeJS.Signals` argument (default `SIGTERM`).

  - `@megasaver/connector-claude-code`: forward `cancel(signal?)` to
    `child.kill(signal ?? "SIGTERM")`.

- e2f7867: Add workspace-scoped Saver Mode activation to the live GUI. A new "Saver Mode"
  workspace tab toggles Mega Saver Mode for a folder by writing the CONTEXT_GATE
  block into <cwd>/CLAUDE.md (sentinel-bounded, atomic) and reports MCP-install
  status. connectors-shared exposes renderContextGateBlockText +
  upsertContextGateBlockText for the render-in-bridge path.
- 1db07df: Plan 3c — per-target projection conformance. Add a fail-closed `projectionPreflight`
  (spec §11 matrix + §14 "projection preflight failure aborts the connector write")
  that validates the final rendered connector output before the atomic write: exactly
  one balanced Mega Saver managed block, a balanced `CONTEXT_GATE` block when present,
  and surviving header/frontmatter for header targets (Cursor). It reuses `parseBlock`,
  rewraps a `block_conflict` as a new `projection_invalid` error code, and is
  agent-agnostic (takes the rendered string + `{ expectHeader }`, not a `ConnectorTarget`).

  `mega connector sync` now runs the preflight before each write (seed + update paths);
  an unconformant projection aborts only that connector's write — the store and other
  targets are untouched. A unified conformance matrix test across all 7 known targets
  (Claude Code, Codex, Cursor, Aider, Gemini, Windsurf, Continue) pins §11 as a
  regression guard. Preflight is defense-in-depth: `upsertBlock` is already correct, so
  this guards against a future renderer/merge regression silently corrupting a user's
  agent-config file.

- 39e5eb6: Proxy Mode v1.2 tool naming mode. `MEGASAVER_TOOL_NAMING=proxy|legacy`
  (default proxy) controls the MCP `tools/list` surface: proxy mode
  exposes `proxy_read_file` / `proxy_run_command` / `proxy_expand_chunk`,
  legacy mode keeps the `mega_*` names — never both at once, so no
  duplicate tool schemas. Both modes dispatch to the same
  implementation. `mega_recall` is unchanged. The Context Gate connector
  block now emits the proxy default names.
- 4c184db: Connector drift detection now classifies in-sync/noop by EOL-normalized
  comparison, so a file whose halves merely disagree on line ending (CRLF
  vs LF, common on Windows) is no longer misreported as drift. The
  EOL-preserving bytes written on a real change are unchanged. New
  `normalizeEol` export on `@megasaver/connectors-shared`.

### Patch Changes

- 44931b7: Slim the connector Context Gate block: drop the redundant "enabled for this
  session" line and the duplicated "prefer over native" intro (the same guidance
  is already stated once below). All load-bearing guidance — the four MCP tool
  bullets, the `intent` rule, the prefer-proxy/expand rules — is unchanged. Saves
  a few injected tokens per turn with no loss of agent guidance.
- 900ce56: Phase 1 (DIMMEM) read/write surface over the typed memory schema.

  Core: `CoreRegistry` gains `updateMemoryEntry` (mutable-in-place patch,
  bumps `updatedAt`, rejects immutable-field changes), `deleteMemoryEntry`
  (hard delete; empties remove the project's JSONL rather than leaving a
  zero-byte file), and `searchMemoryEntries` — local, offline BM25
  (`@megasaver/retrieval`) over title+content+keywords with type/
  confidence/scope filters, stale excluded by default, newest-first when
  no text. New exports: `memoryEntryUpdatePatchSchema`,
  `memorySearchQuerySchema`, `searchMemoryEntries`, `MemorySearchQuery`.

  CLI: `mega memory create` gains typed flags (`--type --title --keyword
--confidence --source --reason --goal --file --expires`, all optional
  with neutral defaults); new `mega memory search/update/delete/explain`
  (`delete` requires `--yes`; `--json` on read commands).

  MCP bridge: three new tools — `save_memory`, `search_memory`,
  `get_relevant_memories` — widening the closed tool enum to seven.

- Updated dependencies [7fcd881]
- Updated dependencies [0a3256b]
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
- Updated dependencies [f46ce66]
- Updated dependencies [4fe5749]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/core@1.1.0

## 1.0.2

### Patch Changes

- @megasaver/core@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [a2526d3]
  - @megasaver/core@1.0.1

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

- a3a4401: Initial publish of `@megasaver/connectors-shared`. Provides the
  canonical block render/parse/upsert/remove helpers, the
  `ConnectorContext` schema, and target-agnostic filesystem helpers
  shared by every Mega Saver connector.

### Minor Changes

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

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/core@1.0.0
