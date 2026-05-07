---
title: '@megasaver/connectors-shared'
tags: [entity, connectors, helpers, v0.1]
sources:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
status: shipped
created: 2026-05-07
updated: 2026-05-07
---

# `@megasaver/connectors-shared`

Agent-agnostic helpers consumed by every Mega Saver connector. Lives
at `packages/connectors/shared`. Knows nothing about specific
agents — `agentId` is data carried through `ConnectorContext`.

## Public surface

- `MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END`
- `ConnectorContextSchema` (Zod, strict, refined)
- `ConnectorContext` type
- `assertConnectorContext(input)`
- `renderBlock(context)` — canonical markdown block
- `parseBlock(content)` — `{ before, block, after }` or throws `block_conflict`
- `upsertBlock({ existingContent, context })`
- `removeBlock(content)`
- `readTargetFile(absPath)` — `null` on ENOENT
- `writeTargetFile({ absPath, content })` — temp-file + rename
- `syncTargetBlock({ absPath, context })`
- `ConnectorError` + `connectorErrorCodeSchema` codes:
  `context_invalid`, `block_conflict`, `file_read_failed`,
  `file_write_failed`, `target_path_invalid`

## Boundaries

- Depends on `@megasaver/core` and `@megasaver/shared` only.
- Does not depend on any connector.
- Does not start agents, write CLI configs, or know agent identifiers
  except as data on `ConnectorContext.agentId`.

## Related

- [[entities/connectors-claude-code]]
- [[entities/connectors-generic-cli]]
- [[concepts/agent-agnostic-core]]
