---
title: '@megasaver/mcp-bridge'
tags: [entity, package, mcp, bridge, critical, v1.0, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
status: active
created: 2026-05-13
updated: 2026-06-14
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

## Closed enums (AA1 §17)

- `McpToolName` (4 members), pinned in
  `packages/mcp-bridge/test/tool-name.test-d.ts`.
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

## v1.2 — Proxy Mode (2026-06-14)

See [[concepts/proxy-mode]] for the full 7-phase arc. Two bridge deltas:

- **P0 tool-naming mode** (commit `49b002e`).
  `MEGASAVER_TOOL_NAMING=proxy|legacy` (default `proxy`). `tools/list`
  exposes exactly ONE name per tool — `proxy_read_file` /
  `proxy_run_command` / `proxy_expand_chunk` in proxy mode, the `mega_*`
  set in legacy — never both (no duplicate schemas). Same dispatch behind
  both names. `mega_recall` is NOT renamed (absent from the rename map).
- **P3 — `proxy_search_code`** (commit `31bd0d7`). NEW 5th tool:
  policy-gated `grep` through `runOutputExecCommand` (reuses spawn / policy
  / redact / filter / store / stats), group-by-file output, optional
  in-memory BM25 enrichment that only reorders results (`index_enrichment`
  status), `path_scope` traversal guard (rejects absolute / `..`). Adds a
  `@megasaver/retrieval` dependency to mcp-bridge. Exposed in BOTH naming
  modes. The package now ships **5 tools**.
