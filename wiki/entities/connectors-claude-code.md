---
title: '@megasaver/connector-claude-code'
tags: [entity, connector, claude-code, v0.1]
sources:
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - docs/superpowers/specs/2026-06-25-intent-aware-hook-design.md
  - https://github.com/haJ1t/MegaSaver/pull/180
  - https://code.claude.com/docs/en/memory
status: merged
created: 2026-05-06
updated: 2026-06-26
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

## Public surface

- `CLAUDE_CODE_AGENT_ID`
- `CLAUDE_MD_FILE`
- `MEGA_SAVER_BLOCK_START`
- `MEGA_SAVER_BLOCK_END`
- `claudeCodeConnectorErrorCodeSchema`
- `ClaudeCodeConnectorErrorCode`
- `ClaudeCodeConnectorError`
- `ClaudeCodeContextSchema`
- `assertClaudeCodeContext(input)`
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

## Error codes

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

## Implementation evidence

Implemented on `codex/connectors-claude-code`. Connector tests: 45
tests across 5 files, including a built-package public export smoke.
Full `pnpm verify` passes with 4 packages and 206 total tests.
Built-package smoke imported `dist/index.js`, `syncClaudeMdContext`
wrote root `CLAUDE.md`, and printed `true` / `true`.

External review gate passed at commit `d447622`:

- Production reviewer approved after connector typecheck, build, test,
  and lint evidence.
- Critic reviewer approved after checking named public exports,
  generated declaration output, parser/updater/filesystem boundaries,
  and full `pnpm verify`.

Merged into `main` via PR <https://github.com/haJ1t/MegaSaver/pull/6>.

Accepted v0.1 residual risks: no optimistic concurrency on `CLAUDE.md`
writes, no file mode/xattr preservation guarantees, and no
`.claude/CLAUDE.md` support.

## Refactor (2026-05-07)

`@megasaver/connector-claude-code` is now a thin wrapper over
`@megasaver/connectors-shared`. Render output is byte-identical to
the pre-refactor implementation; a regression fixture
(`test/regression-fixture.ts`) plus `test/regression.test.ts`
enforces this. Public surface preserved; `ClaudeCodeConnectorError`
codes still exist as a 1:1 alias of the shared error codes.

## Follow-ups merged (PR #9, 2026-05-08)

`assertProjectRoot` now lives in `@megasaver/connectors-shared`
(F3 hoist). `claudeMdPath` calls the shared helper through the
existing `wrapSharedConnectorError` mapper, so callers still see
`project_root_invalid`. Filesystem behaviour gained a symlink
guard (refuse to replace symlinks) and file-mode preservation via
the shared `writeTargetFile`. Render parity, public surface, and
error codes are unchanged.

Note (semver): `ClaudeCodeContextSchema` now requires a top-level
`agentId: "claude-code"` field. PR #8 changeset was bumped from
`patch` to `minor` to acknowledge this required-field addition.

## Hook settings (PR #141, 2026-06-15)

Second responsibility (beyond the `CLAUDE.md` block): the single source of
truth for the Claude Code Mega Saver **hook entries** in
`~/.claude/settings.json`. Moved here from `apps/cli` so both the CLI and the
GUI bridge can consume it (`apps/gui` cannot import `apps/cli` — §8). Module
`src/hook-settings.ts`; pure + boundary-validated; writes are **atomic**
(temp file + `rename`, so a crash can't truncate the user's global config).

Public surface (added):

- `installClaudeCodeHook({ settingsPath, command? })` — idempotent add of
  PreToolUse `mega hooks log` + PostToolUse `mega hooks saver`.
- `uninstallClaudeCodeHook({ settingsPath, command? })` — removes ONLY those
  two entries at the **command** level (preserves co-located user hooks and
  every unrelated key). No-op if absent.
- `readClaudeCodeHookStatus({ settingsPath, command? })` →
  `{ connected, preInstalled, postInstalled }`; missing/malformed file ⇒
  all-false (never throws).
- `removePre/PostToolUseHook`, `has/addPre/PostToolUseHook`,
  `resolveClaudeCodeSettingsPath` (mirrors `apps/cli` `resolveHomeDir`:
  `HOME ?? USERPROFILE ?? ""`), constants `HOOK_MATCHER`,
  `DEFAULT_HOOK_COMMAND` (`mega hooks log`), `SAVER_HOOK_COMMAND`
  (`mega hooks saver`).

Consumed by `mega hooks install|uninstall` ([[entities/cli]]) and the GUI
bridge route `GET|POST|DELETE /api/hooks/claude-code` ([[entities/gui]]).
Critic review caught a Critical bug pre-merge: entry-level removal deleted
co-located user hooks → fixed to command-level strip + regression test.
Operational gotcha: Claude Code loads hooks at **session start**, so a hook
connected mid-session only takes effect after `/hooks` review or a new
session; and the installed command (`mega hooks saver`) must resolve on PATH.

## Intent hook (PR #180, 2026-06-25)

`hook-settings.ts` now manages a **third** hook: a `UserPromptSubmit`
entry running `mega hooks intent`
(code: packages/connectors/claude-code/src/hook-settings.ts:9
`INTENT_HOOK_COMMAND = "mega hooks intent"`). It has **no tool matcher** —
Claude Code ignores `matcher` for this event type
(code: hook-settings.ts:137). It captures the user's latest prompt for the
intent-aware saver ranking (see [[intent-aware-hook]]).

Added helpers: `has/add/removeUserPromptSubmitHook`
(code: hook-settings.ts:125,131,143). `installClaudeCodeHook` /
`uninstallClaudeCodeHook` now also seed/strip the intent entry idempotently
(code: hook-settings.ts:188,208). `ClaudeCodeHookStatus` gained
`intentInstalled`, and `connected = preInstalled && postInstalled &&
intentInstalled` (code: hook-settings.ts:217,232) — so a connector counts as
connected only when all three hooks are present. Consumed by
`mega connector claude-code install|uninstall|status` ([[cli]]) (PR #180).

## Related

- [[entities/core]]
- [[entities/shared]]
- [[entities/cli]]
- [[entities/gui]]
- [[concepts/agent-agnostic-core]]
