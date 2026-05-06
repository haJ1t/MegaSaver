---
title: Claude Code connector design
date: 2026-05-06
risk: high
status: spec-written
package: "@megasaver/connector-claude-code"
sources:
  - wiki/index.md
  - wiki/entities/core.md
  - wiki/entities/shared.md
  - https://code.claude.com/docs/en/memory
---

# `@megasaver/connector-claude-code` — v0.1 `CLAUDE.md` adapter

## 1. Context

Mega Saver v0.1 has the neutral pieces needed by a connector:
`@megasaver/shared` exports `AgentId` with `"claude-code"`;
`@megasaver/core` exports strict `Project`, `Session`, and
`MemoryEntry` schemas plus synchronous registry implementations.
The agent-agnostic boundary is locked: core never imports or knows
Claude Code formats.

Claude Code's current memory model loads project instructions from
`./CLAUDE.md` or `./.claude/CLAUDE.md`, treats instructions as context
rather than hard enforcement, and recommends concise, structured files
under about 200 lines. It also strips block-level HTML comments before
injecting `CLAUDE.md` into context. That makes HTML comment sentinels a
good fit for machine-owned boundaries that should not cost tokens.

## 2. Goal

Create the first connector package at `packages/connectors/claude-code`.
It manages a deterministic Mega Saver block inside root `CLAUDE.md`
while preserving any human-authored content outside the block.

This slice gives later CLI commands a safe library surface to sync
selected Mega Saver project/session/memory context into Claude Code
without adding agent-specific logic to core.

Out of scope: see §11.

## 3. Risk

Risk level: **HIGH**.

Why:

- Connector code is public surface for the first supported agent.
- It writes to a user-visible instruction file that may be tracked in git.
- A bad block format can waste tokens or confuse Claude Code sessions.
- Agent-specific assumptions must stay isolated from `@megasaver/core`.

Required gates: feature worktree, spec before implementation, TDD,
`pnpm verify` plus connector smoke evidence, two fresh-context review
passes, and wiki updated as info-carrier.

## 4. Alternatives considered

- Pure renderer only: lowest risk, but every consumer would reimplement
  the same read/upsert/write sequence and error mapping.
- Root `CLAUDE.md` adapter with pure and filesystem helpers: recommended;
  small, useful, testable, and aligned with Claude Code project memory.
- Full Claude Code launcher: too large. Process orchestration needs its
  own CLI/connector spec.

## 5. Locked decisions

1. Package location: `packages/connectors/claude-code`.
2. Package name: `@megasaver/connector-claude-code`.
3. Package is ESM, strict TypeScript, private until v0.1 release.
4. Package may depend on `@megasaver/core` and `@megasaver/shared`.
5. Package must not be imported by `@megasaver/core`.
6. The only file path managed in v0.1 is `<projectRoot>/CLAUDE.md`.
7. `.claude/CLAUDE.md`, `.claude/rules/`, `CLAUDE.local.md`, imports,
   hooks, and settings are deferred.
8. The connector never selects memory from the registry. Callers pass the
   already-selected entries; connector only validates and renders.
9. The managed block uses HTML comment sentinels:
   `<!-- MEGA SAVER:BEGIN -->` and `<!-- MEGA SAVER:END -->`.
10. Existing content outside the managed block is preserved exactly
    except for the minimal newline normalization needed around insertion
    or removal.

## 6. Public surface

```ts
export const CLAUDE_CODE_AGENT_ID: AgentId;
export const CLAUDE_MD_FILE = "CLAUDE.md";
export const MEGA_SAVER_BLOCK_START = "<!-- MEGA SAVER:BEGIN -->";
export const MEGA_SAVER_BLOCK_END = "<!-- MEGA SAVER:END -->";

export const ClaudeCodeContextSchema: z.ZodType<ClaudeCodeContext>;

export interface ClaudeCodeContext {
  project: Project;
  session: Session | null;
  memoryEntries: MemoryEntry[];
}

export interface ClaudeMdDocument {
  hasManagedBlock: boolean;
  contentBeforeBlock: string;
  managedBlock: string | null;
  contentAfterBlock: string;
}

export function renderClaudeCodeContext(
  context: ClaudeCodeContext,
): string;

export function parseClaudeMd(content: string): ClaudeMdDocument;

export function upsertMegaSaverBlock(input: {
  existingContent: string;
  context: ClaudeCodeContext;
}): string;

export function removeMegaSaverBlock(content: string): string;

export function readClaudeMd(projectRoot: string): Promise<string | null>;

export function writeClaudeMd(input: {
  projectRoot: string;
  content: string;
}): Promise<void>;

export function syncClaudeMdContext(input: {
  projectRoot: string;
  context: ClaudeCodeContext;
}): Promise<string>;
```

## 7. Context validation

`ClaudeCodeContextSchema` is strict and reuses core schemas.

Rules:

- `project` must be a full core `Project`.
- `session` may be `null`.
- When `session` is present, `session.projectId === project.id`.
- When `session` is present, `session.agentId === "claude-code"`.
- `memoryEntries` length is `0..20`; caller owns selection and ordering.
- Every memory entry must have `projectId === project.id`.
- Session-scoped entries require a non-null `session`.
- Session-scoped entries require `entry.sessionId === session.id`.
- Rendered text must not contain either sentinel string inside project
  name, session title, or memory content.

Invalid context throws `ClaudeCodeConnectorError` with code
`claude_md_context_invalid`.

## 8. Render format

`renderClaudeCodeContext` returns only the managed block content,
including start/end sentinels and one final newline.

Format:

```md
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: claude-code
Project: <project.name> (<project.id>)
Session: <session.title or session.id or none>
Risk: <session.riskLevel or none>

## Memory

- [project:<memoryEntry.id>] <content>
- [session:<memoryEntry.id>] <content>
<!-- MEGA SAVER:END -->
```

Multiline memory content is rendered under the same bullet with
subsequent lines indented by two spaces. Empty memory lists render
`- none`. The renderer preserves entry order.

## 9. `CLAUDE.md` parsing and update behavior

`parseClaudeMd` recognizes only the exact sentinel lines.

Rules:

- No block: `hasManagedBlock = false`, `managedBlock = null`.
- Exactly one complete block: split into before/block/after parts.
- Multiple start sentinels, multiple end sentinels, end before start, or
  unclosed blocks throw `ClaudeCodeConnectorError` with code
  `claude_md_block_conflict`.

`upsertMegaSaverBlock`:

- Replaces an existing valid managed block.
- Appends the block to the end when no managed block exists.
- Ensures exactly one blank line between human content and the block.
- Ensures the returned content ends with one newline.

`removeMegaSaverBlock`:

- Removes the managed block when present.
- Leaves human content intact.
- Ensures the returned content ends with one newline unless the result is
  empty.

## 10. Filesystem behavior

Filesystem helpers are intentionally narrow.

- `projectRoot` must be an absolute path to an existing directory.
- `readClaudeMd(projectRoot)` returns `null` when `CLAUDE.md` is absent.
- `writeClaudeMd` writes only `<projectRoot>/CLAUDE.md`.
- `syncClaudeMdContext` reads existing content if present, upserts the
  managed block, writes the result, and returns the written content.
- Writes use temp-file plus rename in the same directory.
- Read failures throw `claude_md_read_failed`.
- Write failures throw `claude_md_write_failed`.
- Invalid roots throw `project_root_invalid`.

## 11. Out of scope

- CLI commands such as `mega connector claude-code sync`.
- Starting or wrapping the `claude` binary.
- Detecting installed Claude Code version.
- Editing `.claude/CLAUDE.md`, `.claude/rules/`, `CLAUDE.local.md`, or
  imports.
- Reading Claude Code auto memory from `~/.claude/projects`.
- Memory retrieval, ranking, summarization, compression, or token audit.
- Generic CLI connector behavior.
- Windows-specific path policy beyond Node path correctness.

## 12. Package layout

```text
packages/connectors/claude-code/
  package.json
  tsconfig.json
  tsconfig.test.json
  tsup.config.ts
  vitest.config.ts
  src/
    constants.ts
    context.ts
    errors.ts
    filesystem.ts
    index.ts
    markdown.ts
  test/
    context.test.ts
    errors.test.ts
    filesystem.test.ts
    markdown.test.ts
```

Each production file stays under 300 LOC.

## 13. Test strategy

Strict TDD, one behavior at a time:

- Context schema accepts valid core entities and rejects project/session
  mismatch, non-Claude sessions, too many entries, and sentinel injection.
- Renderer output is deterministic, includes IDs/scopes, handles
  multiline memory, and renders `- none`.
- Parser handles absent block, one block, duplicate blocks, reversed
  sentinels, and unclosed blocks.
- Upsert replaces existing block and appends to human content without
  duplicating managed sections.
- Remove deletes only the managed block.
- Filesystem helpers return `null` for missing files, reject relative or
  missing roots, create `CLAUDE.md`, preserve existing human content, and
  use temp-file plus rename behavior through observable output.
- Public export smoke imports the built package and renders a minimal
  context.

## 14. Definition of Done

- Spec and plan committed before implementation.
- New package included in pnpm workspace/turbo graph.
- Connector build, typecheck, and test commands pass.
- `pnpm verify` passes from the feature worktree.
- Smoke evidence records built-package import and temp-dir sync.
- Changeset added for the new connector package.
- Wiki pages list concrete public surface and error codes.
- Production reviewer and critic both approve.

## 15. Wiki updates

Update:

- `wiki/entities/connectors-claude-code.md`
- `wiki/index.md`
- `wiki/log.md`

The entity page must carry concrete API names, block sentinels, error
codes, and out-of-scope boundaries so future sessions do not need to
open this spec for orientation.
