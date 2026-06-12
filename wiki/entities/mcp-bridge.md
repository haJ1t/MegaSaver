---
title: '@megasaver/mcp-bridge'
tags: [entity, package, mcp, bridge, critical, v1.0, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
status: active
created: 2026-05-13
updated: 2026-06-12
---

# `@megasaver/mcp-bridge`

Real MCP server over `stdio` (AA1 §8; BB8, CRITICAL). Replaced the
v0.3 `not_implemented` placeholder without redesigning the
`createBridge(config)` API (source: AA1 §8). Shipped BB8 (PR #83,
`0e9be7a`).

## Tools (alphabetic; AA1 §8a)

- `mega_fetch_chunk(chunkSetId, chunkId, around?)` — drill into a
  stored excerpt.
- `mega_read_file(path, intent, sessionId, maxBytes?)` —
  `policy.evaluatePathRead` → `resolveSafeReadPath` → `readFile` →
  `filterOutput` → store.
- `mega_recall(sessionId, intent, maxBytes?)` — reload session memory
  + recent tool calls.
- `mega_run_command(command, args, intent, sessionId, maxBytes?)` —
  `evaluateCommand` (env-marker re-entry guard) → spawn → redact →
  filter → store + stats. Same orchestrator as `mega output exec`
  (source: AA1 §8d "one orchestrator, two entry points").

## Tools (Phase 10 additions — approve_memory, gated tools)

- `approve_memory(memoryEntryId, approval?)` — approve or reject a
  suggested memory entry. `approval` defaults to `"approved"`.
  Reuses `updateMemoryEntry`; `resource_not_found` on missing id.
  **25th tool** (added Phase 10; `approve_memory` is now first in
  `mcpToolNameSchema` alphabetically).

`get_project_context` and `mega_recall` both gained an
`approval === "approved"` filter (gate point 2) — unapproved memory
is excluded from agent-facing context. See [[entities/core]] gate
point 1 for `searchMemoryEntries` (gates `search_memory` /
`get_relevant_memories` / context pack).

## Closed enums (AA1 §17 + Phase 10)

- `McpToolName` (**25 members** — Phase 10 added `approve_memory` as first
  member), pinned in `packages/mcp-bridge/test/tool-name.test-d.ts`
  and runtime-counted in `test/tool-name-task.test.ts`.
- `McpBridgeErrorCode` (16 members; replaced the single
  `not_implemented`), pinned in
  `packages/mcp-bridge/test/errors.test-d.ts`.
- `McpTransport = ["stdio", "sse"]` (unchanged; `sse` rejects until a
  later release).

## Setup surface (BB8 + BB11)

`McpSetupOps` (`buildMcpSetupOps`) drives `install` / `repair` /
`status` / `uninstall`, each returning a fresh `McpStatusResult`
(`{ agents: McpAgentStatus[] }`). Consumed by the CLI
`mega mcp {install,repair,status,uninstall}` and the GUI
AgentSetupDoctor `/api/mcp/*` routes.

## Boundaries

Does not import the CLI (`KnownAgentId` is declared here; the CLI
passes a validated id in). The GUI/CLI inject the `connectorSync`
side-effect (AA1 §2c DI).

## Related

- [[entities/cli]] — `mega mcp` surface.
- [[entities/gui]] — AgentSetupDoctor + `/api/mcp/*` bridge routes.
- [[concepts/context-gate-pipeline]] — the filter pipeline each tool runs.

## v1.1 / post-v1.0 (2026-06-03)

The page above reflects the v1.0.0 / BB8 state. No additional public surface
changes in v1.1.0. mcp-bridge@1.0.2 (patch-level bump alongside the
standalone-bundle distribution work, PRs #91, #94). The `mega mcp serve`
subcommand (BB8) allows the bridge to be started manually for debugging;
`mega mcp install` wires it into the agent's MCP config via
`buildMcpSetupOps`.
