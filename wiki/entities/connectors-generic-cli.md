---
title: '@megasaver/connector-generic-cli'
tags: [entity, connector, generic-cli, v0.1, phase9]
sources:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - docs/superpowers/specs/2026-06-12-phase9-connectors-design.md
status: shipped
created: 2026-05-07
updated: 2026-06-12
---

# `@megasaver/connector-generic-cli`

Manifest-driven connector. v0.1 ships two targets: `codexTarget`
(writes `AGENTS.md` at project root, agent id `"codex"`) and
`cursorTarget` (writes `.cursor/rules/megasaver.mdc`, agent id
`"cursor"`). Phase 9 adds three flat-file targets:
- `geminiTarget` — writes `GEMINI.md`, agent id `"gemini"`, no header.
- `windsurfTarget` — writes `.windsurfrules`, agent id `"windsurf"`, no header.
- `continueTarget` — writes `.continue/rules/megasaver.md`, agent id `"continue"`, no header.

All three are frozen `ConnectorTarget` objects reusing the existing
`runConnectorSync` / `runConnectorStatus` path verbatim (no new sync
code). `builtinTargets` grows from 3 → 6 members.

## Public surface

- `ConnectorTarget` (interface): `{ id, agentId, relativePath, header? }`
- `codexTarget`, `cursorTarget`, `aiderTarget`, `geminiTarget`,
  `windsurfTarget`, `continueTarget`, `builtinTargets` (6),
  `findTarget(id)`
- `GenericCliContextSchema`, `assertGenericCliContext(input, target)`
- `syncGenericCliTarget({ projectRoot, target, context })` →
  `Promise<string>`
- `readGenericCliTarget({ projectRoot, target })`
- `writeGenericCliTarget({ projectRoot, target, content })`
- `GenericCliConnectorError`, `genericCliConnectorErrorCodeSchema`
  codes: `context_invalid`, `block_conflict`, `file_read_failed`,
  `file_write_failed`, `project_root_invalid`. (`target_unknown`
  was reserved in v0.1 init but dropped in PR #9 — `findTarget`
  returns `null`; thrower-style helper deferred until needed.)
- `assertProjectRoot` delegated to `@megasaver/connectors-shared`
  (PR #9 F3); per-connector wrappers map the shared
  `target_path_invalid` to `project_root_invalid`.

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
