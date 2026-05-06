---
title: '@megasaver/connector-claude-code'
tags: [entity, connector, claude-code, v0.1]
sources:
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - https://code.claude.com/docs/en/memory
status: spec-written
created: 2026-05-06
updated: 2026-05-06
---

# `@megasaver/connector-claude-code`

Thin Claude Code adapter. Lives at `packages/connectors/claude-code`;
package name is `@megasaver/connector-claude-code`.

## Scope

v0.1 manages a Mega Saver block inside root `CLAUDE.md` only. Claude
Code loads project instructions from root `CLAUDE.md` or
`.claude/CLAUDE.md`; this slice chooses root `CLAUDE.md` for a small,
team-shared first connector. HTML comment sentinels are used because
Claude Code strips block-level comments before context injection.

## Managed block

Sentinels:

- `<!-- MEGA SAVER:BEGIN -->`
- `<!-- MEGA SAVER:END -->`

Rendered shape:

```md
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: claude-code
Project: <name> (<id>)
Session: <title/id/none>
Risk: <risk/none>

## Memory

- [project:<entry-id>] <content>
- [session:<entry-id>] <content>
<!-- MEGA SAVER:END -->
```

## Public surface planned

- `CLAUDE_CODE_AGENT_ID`
- `CLAUDE_MD_FILE`
- `MEGA_SAVER_BLOCK_START`
- `MEGA_SAVER_BLOCK_END`
- `ClaudeCodeContextSchema`
- `renderClaudeCodeContext(context)`
- `parseClaudeMd(content)`
- `upsertMegaSaverBlock({ existingContent, context })`
- `removeMegaSaverBlock(content)`
- `readClaudeMd(projectRoot)`
- `writeClaudeMd({ projectRoot, content })`
- `syncClaudeMdContext({ projectRoot, context })`

## Validation rules

- Context uses full core `Project`, `Session | null`, and
  `MemoryEntry[]`.
- Session, if present, must match the project and have
  `agentId === "claude-code"`.
- Memory entries max: 20. Caller owns selection/order.
- Every memory entry must match the project.
- Session-scoped memory requires the selected session.
- Sentinel strings inside rendered values are rejected.

## Error codes planned

`ClaudeCodeConnectorErrorCode`:

- `claude_md_context_invalid`
- `claude_md_block_conflict`
- `claude_md_read_failed`
- `claude_md_write_failed`
- `project_root_invalid`

## Boundary rules

- Connector may import `@megasaver/core` and `@megasaver/shared`.
- Core must never import this connector.
- No Claude process launch in this slice.
- No `.claude/CLAUDE.md`, `.claude/rules/`, `CLAUDE.local.md`, imports,
  auto memory, memory retrieval, compression, or token audit yet.

## Related

- [[entities/core]]
- [[entities/shared]]
- [[concepts/agent-agnostic-core]]
