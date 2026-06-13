---
title: '@megasaver/connectors-shared'
tags: [entity, connectors, helpers, v0.1]
sources:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
status: shipped
created: 2026-05-07
updated: 2026-06-14
---

# `@megasaver/connectors-shared`

Agent-agnostic helpers consumed by every Mega Saver connector. Lives
at `packages/connectors/shared`. Knows nothing about specific
agents — `agentId` is data carried through `ConnectorContext`.

## Public surface

- `MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END`
- `ConnectorContextSchema` (Zod, strict, refined; rejects sentinel
  substrings and Unicode lookalikes via NFKC + zero-width strip)
- `ConnectorContext` type
- `assertConnectorContext(input)`
- `renderBlock(context)` — canonical markdown block
- `parseBlock(content)` — `{ before, block, after }` or throws
  `block_conflict` with offending sentinel line numbers in the message
- `upsertBlock({ existingContent, context })` — preserves dominant
  EOL (CRLF / LF) of input
- `removeBlock(content)` — preserves dominant EOL
- `readTargetFile(absPath)` — `null` on ENOENT
- `writeTargetFile({ absPath, content })` — temp-file + rename;
  refuses to replace a symlink; preserves existing file mode
- `syncTargetBlock({ absPath, context })` → `Promise<string>`
- `assertProjectRoot(projectRoot)` — sync absolute-path-to-existing-
  directory guard, throws `target_path_invalid`
- `ConnectorError` + `connectorErrorCodeSchema` codes:
  `context_invalid`, `block_conflict`, `file_read_failed`,
  `file_write_failed`, `target_path_invalid`

## Boundaries

- Depends on `@megasaver/core` and `@megasaver/shared` only.
- Does not depend on any connector.
- Does not start agents, write CLI configs, or know agent identifiers
  except as data on `ConnectorContext.agentId`.

## AA1 / Mega Saver Mode

- `context-gate-block.ts` renders an additive
  `<!-- MEGA SAVER:CONTEXT_GATE BEGIN/END -->` block (telling the
  agent to prefer `mega_run_command` etc.), emitted ONLY when the
  session's `tokenSaver.enabled === true` (source: AA1 §7; BB11).
- `parseBlock` is parameterised by the sentinel pair, so the legacy
  `MEGA SAVER:BEGIN/END` block and the CONTEXT_GATE block coexist in
  one agent file without clobbering each other.

## v1.2 — Proxy Mode (2026-06-14)

P5 (commit `07040de`) reworks the CONTEXT_GATE block text. See
[[concepts/proxy-mode]].

- The block now biases the agent to the **proxy** tool names
  (`proxy_run_command` / `proxy_read_file` / `proxy_search_code`) instead
  of the `mega_*` names, matching the default `MEGASAVER_TOOL_NAMING=proxy`
  surface.
- Adds the guidance lines "prefer proxy tools" and "expand before assuming
  omitted" (i.e. call `proxy_expand_chunk` rather than treating compressed
  output as truncated) so the agent does not re-fetch full output.

## Related

- [[entities/connectors-claude-code]]
- [[entities/connectors-generic-cli]]
- [[concepts/agent-agnostic-core]]
