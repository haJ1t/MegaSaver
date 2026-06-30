# @megasaver/shared

## 1.1.0

### Minor Changes

- 7fcd881: Add the Agent Office engine data layer: Role / OfficeAgent / OfficeTask
  schemas, atomic-json stores, and the predefined-role seed set. Adds
  roleId / officeAgentId / officeTaskId branded ids to @megasaver/shared.
- fde8e86: Add the live-first Phase 3 workspace-keyed read surface.

  - `@megasaver/shared`: `workspaceKeySchema`, `encodeWorkspaceKey(cwd)`
    (`sha256(cwd)` → 16 lowercase-hex chars), and `workspaceLabel(cwd)` —
    an fs-safe key space distinct from the lowercase-UUID `projectId`.
  - `@megasaver/indexer`: `resolveWorkspaceIndexPaths(storeDir, key)` and
    `buildWorkspaceIndex(...)` write under `index/<workspaceKey>/`, plus
    `workspaceProjectId(key)` (a deterministic UUIDv5 stamped on index
    blocks so `codeBlockSchema` parses without a schema migration).
  - `@megasaver/core`: `readWorkspaceRules` / `readWorkspaceTools` read the
    workspace-keyed overlay JSONL (`rules/<key>.jsonl`, `tools/<key>.jsonl`),
    reusing the existing rule/tool zod schemas. Read-only; no registry.

- 4be82f8: Add a live agent transcript (Phase A). The supervisor now projects each claude
  stream-json event into a compact `TranscriptEntry` (assistant text, tool calls,
  results) and persists it per-agent; the bridge exposes a backlog route and a
  live SSE stream; the GUI office board opens a read-only activity feed when you
  click an agent. New `officeTranscriptId` branded id in `@megasaver/shared`.
- f7cbc28: Phase 2 (Semantic Repo Index): new `@megasaver/indexer` package that
  parses a repo into typed `CodeBlock`s — AST extraction for TS/JS/TSX via
  the TypeScript compiler API, structural extraction for Markdown (heading
  sections) and JSON (top-level keys + package.json `script:<name>`), an
  ignore-aware traversal-safe `scanRepo` (never follows symlinks; honors
  always-ignore + .gitignore + .megaignore; skips secret/binary/oversized
  files), an atomic JSON-directory store with `contentHash` incremental
  `buildIndex`, and BM25 `searchBlocks`. New `CodeBlockId` in
  `@megasaver/shared`. CLI gains `mega scan` and `mega index
build/status/search/show`. `typescript` is a CLI runtime dependency
  (externalized from the bundle).
- 12c8e9e: Phase 4 — MCP Server full surface. Adds two first-class core entities
  (ProjectRule, FailedAttempt) with schemas, branded ids, JSONL storage, and
  registry CRUD, plus four MCP tools: `get_project_context`,
  `record_failed_attempt`, `save_project_rule`, `get_project_rules`. The bridge
  now exposes 15 tools. Additive only — no existing schema, store, or tool
  changes shape.
- f7bb136: Phase 6 — Task Engine. Adds a deterministic task state machine: TaskPlan
  with embedded typed TaskSteps (scan/retrieve_context/plan/edit/test/debug/
  document/save_memory), dependency-aware status rollup, and selective retry
  (reset only the failed step + its transitive dependents, never the whole
  plan). The engine is a state tracker, not an executor — the calling agent
  runs each step and reports the outcome. New: branded TaskPlanId/TaskStepId,
  1 pure transition module, 5 CoreRegistry methods (createTaskPlan, getTaskPlan,
  listTaskPlans, recordTaskStep, retryTaskStep), 6 error codes, 4 MCP tools
  (build_task_plan, get_task_status, record_task_step, retry_failed_step;
  bridge now 22 tools), and CLI (mega task plan/status/step/retry/explain).
  Phase 5 (FailedAttempt) and Phase 1 (MemoryEntry) reuse is opt-in. No LLM,
  no embeddings.
- ed46198: Phase 7 — Tool Router. Adds a deterministic, per-project tool router. New
  first-class ToolDefinition entity (name/description, category enum
  [filesystem/search/git/test/package/database/deploy/browser/dangerous],
  risk enum [safe/medium/dangerous], normalized keywords, opaque
  z.unknown() inputSchema/outputSchema — descriptive only, never executed),
  stored as per-project JSONL. New pure routeToolsForTask(tools, query)
  reusing rankBm25: a security gate runs BEFORE relevance — a tool is
  blocked (never routed to a plain task) when risk=dangerous OR category in
  {dangerous, deploy, database}; among the rest, score>0 tools are allowed
  (descending score, id tiebreak), irrelevant tools are omitted. Returns
  { allowedTools, blockedTools, reason }. New branded ToolDefinitionId,
  4 CoreRegistry methods (createToolDefinition, getToolDefinition,
  listToolDefinitions, routeToolsForTask), 2 error codes
  (tool_definition_already_exists, tool_definition_not_found), 1 MCP tool
  route_tools_for_task (bridge now 23 tools), and CLI mega tools
  add/list/route/explain. Registration is CLI-only; the router only advises
  (no execution, no enforcement at a call site). No LLM, no embeddings.
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
- 38a04c9: Project/session/memory id schemas now require lowercase UUIDs (reject
  uppercase/mixed-case). Makes the case-collision safety explicit at the
  boundary. Error-surface change: an uppercase id on a CLI command (`mega
session show <ID>`) or GUI bridge path param now fails validation
  ("id must be lowercase") instead of resolving to a 404. randomUUID
  already mints lowercase, so no production write path regresses.

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

- 0498b79: Add Cursor as a connector target. `agentIdSchema` widens to four
  members (adds `"cursor"`); `@megasaver/connector-generic-cli`
  ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
  and gains an optional `ConnectorTarget.header` field that the CLI
  prepends on first seed (used to write Cursor's required YAML
  frontmatter once). Existing `claude-code` and `codex` paths are
  byte-identical. `mega session create --agent cursor` and
  `mega connector sync demo --target cursor` work end-to-end.
- 4a56e4c: Initial release of `@megasaver/shared` — cross-cutting contracts package. v0.1 surface: `RiskLevel`, `AgentId`, branded entity IDs (`ProjectId`, `SessionId`, `MemoryEntryId`). Schema-first via Zod, ESM-only.

### Patch Changes

- 93840ac: Add `codex` to the `AgentId` enum so the upcoming generic-cli connector
  target can carry its own agent identity instead of collapsing into
  `generic-cli`.
