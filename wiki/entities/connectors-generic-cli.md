---
title: '@megasaver/connector-generic-cli'
tags: [entity, connector, generic-cli, v0.1]
sources:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
status: shipped
created: 2026-05-07
updated: 2026-05-07
---

# `@megasaver/connector-generic-cli`

Manifest-driven connector. v0.1 ships one target: `codexTarget`
(writes `AGENTS.md` at project root, agent id `"codex"`).

## Public surface

- `ConnectorTarget` (interface): `{ id, agentId, relativePath }`
- `codexTarget`, `builtinTargets`, `findTarget(id)`
- `GenericCliContextSchema`, `assertGenericCliContext(input, target)`
- `syncGenericCliTarget({ projectRoot, target, context })`
- `readGenericCliTarget({ projectRoot, target })`
- `writeGenericCliTarget({ projectRoot, target, content })`
- `GenericCliConnectorError`, `genericCliConnectorErrorCodeSchema`
  codes: `target_unknown`, `context_invalid`, `block_conflict`,
  `file_read_failed`, `file_write_failed`, `project_root_invalid`

## Validation

- `context.agentId === target.agentId`.
- All shared schema rules (project/session/memory cross-id, sentinel
  injection rejection, max-20 memory).
- `projectRoot` absolute path to existing directory.

## Out of scope (v0.1)

- CLI integration (`mega connector sync` lands later).
- `.cursor/rules/*.mdc`, `.aider.conf.yml`, YAML/non-markdown targets.
- Optimistic concurrency.

## Related

- [[entities/connectors-shared]]
- [[entities/connectors-claude-code]]
- [[concepts/agent-agnostic-core]]
