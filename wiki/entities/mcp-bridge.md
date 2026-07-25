---
title: '@megasaver/mcp-bridge'
tags: [entity, package, mcp, bridge, critical, v1.0, aa1]
sources:
  - docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
  - docs/superpowers/specs/2026-06-12-phase10-team-cloud-design.md
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

## v1.2 — Proxy Mode (2026-06-14)

See [[concepts/proxy-mode]] for the full 7-phase arc. Two bridge deltas:

- **P0 tool-naming mode** (commit `49b002e`).
  `MEGASAVER_TOOL_NAMING=proxy|legacy` (default `proxy`). `tools/list`
  exposes exactly ONE name per tool — `proxy_read_file` /
  `proxy_run_command` / `proxy_expand_chunk` in proxy mode, the `mega_*`
  set in legacy — never both (no duplicate schemas). Same dispatch behind
  both names. `mega_recall` is NOT renamed (absent from the rename map).
- **P3 — `proxy_search_code`** (commit `31bd0d7`). NEW tool:
  policy-gated `grep` through `runOutputExecCommand` (reuses spawn / policy
  / redact / filter / store / stats), group-by-file output, optional
  in-memory BM25 enrichment that only reorders results (`index_enrichment`
  status), `path_scope` traversal guard (rejects absolute / `..`). Adds a
  `@megasaver/retrieval` dependency to mcp-bridge. Exposed in BOTH naming
  modes. (Introduced on the v1.2 branch as the 5th tool over the four AA1
  base tools; after the Phase 0–10 merge the bridge ships **26 tools** —
  the 25 ContextOps tools plus `proxy_search_code` — and `McpToolName` is a
  **26-member** enum.)

## Inert tool inputs closed (2026-07-25)

Two `.strict()` tool schemas declared a key nothing read: `max_results`
(`src/tools/search-code.ts:25`) and `around` (`src/tools/fetch-chunk.ts:19`).
Because the schemas are strict, these were among the very few keys a caller
could pass WITHOUT an error — every other unknown key failed loud, these two
were accepted and dropped. Same defect class as `deny.write` in
[[entities/policy]], found by the same security review.

One claim in the report did not survive checking: `max_results` is NOT published
to agents as `{minimum:1, maximum:500, default:50}`. That line lives in the v1.2
roadmap plan, never implemented — `src/server.ts:282` advertises
`inputSchema: { type: "object" }` for **all 26 tools**, so no input property,
bound, or default is published for anything. Lower exposure, same defect; and it
means there was no published default to honor.

- **`max_results` → honored.** It is a genuine cap: `enrich` already BM25-orders
  files, so top-N is meaningful. The cap runs AFTER `enrich` (a slice-before-rank
  implementation keeps whatever grep emitted first) and reports a new optional
  `omitted: {files, matches}` when it drops anything — a silent cap is worse than
  an ignored parameter, because the agent acts on a truncated list believing it
  complete. Lossless: the raw output stays reachable via `chunkSetId`. No default
  adopted; absent ⇒ uncapped, or every existing caller would start truncating.
- **`around` → removed.** Not an ignored knob but an unbuilt feature
  (neighbouring-chunk fetch needs chunk ordering, bounds, a changed result
  shape). `.strict()` now rejects it, and zod's own message names the key, which
  reaches the caller through `McpBridgeError("validation_failed", …)`. It did
  NOT get the custom named-message machinery `deny.write` earned — that paid off
  on a security key where silence means false protection; here zod naming the
  key is already actionable.

`shapeResult` is the single chokepoint for both the in-process and
daemon-forward branches, so the cap needed no daemon-side change (the daemon's
own `searchRequestSchema` never declared `max_results`, which is irrelevant —
forwarding goes to `/exec-registry` and the `ExecResult` is shaped locally).

Sources: [[docs/superpowers/specs/2026-07-25-inert-mcp-inputs-design]],
[[docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design]] §P3-T8.

Mutation testing (2026-07-25) killed 5 of 6 mutants on the first pass; the
survivor was "treat absent `max_results` as a default of 50", which every test
accepted because no fixture had more than 50 files — i.e. the §3.2 no-default
decision shipped untested. Closed with a 60-file daemon-path fixture, verified
red against exactly that mutant (60 → 50) before being kept.
