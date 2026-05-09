---
title: Cursor connector target — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md
  - docs/superpowers/specs/2026-05-09-mega-connector-status-design.md
  - wiki/entities/connectors-generic-cli.md
  - wiki/entities/cli.md
---

# Cursor connector target — design

## §0 TL;DR

Add a third connector target alongside `claude-code` and `codex`:
`cursor` → `.cursor/rules/megasaver.mdc`. The Mega Saver context
block is rendered by the existing `connectors-shared` primitives;
the new wrinkle is that Cursor `.mdc` files require YAML
frontmatter, so `ConnectorTarget` gains an optional `header?:
string` that `mega connector sync` prepends ONCE on first seed.
Existing `upsertBlock` semantics keep frontmatter intact on every
later run (it sits in the `before` region around the sentinel
block).

`@megasaver/shared`'s `agentIdSchema` gains `"cursor"`. The
generic-cli connector package gains `cursorTarget` and adds it to
`builtinTargets`. The CLI's `KNOWN_TARGET_IDS` and `KNOWN_TARGETS`
add `"cursor"`. `mega session create --agent cursor` and
`mega connector sync --target cursor` work end-to-end after this
slot.

## §1 Motivation

Cursor is the third agent named in CLAUDE.md §1 ("Mega Saver
connects to Claude Code, Codex, **Cursor**, Aider, and any CLI
agent"). It was always a v0.1 target slot; the prior connector
slices intentionally shipped only `claude-code` (root `CLAUDE.md`)
and `codex` (`AGENTS.md`) so the manifest pattern could land
first. Cursor closes the third member of the public-facing trio
without altering the manifest contract — it just adds a target.

This slot also exercises a new dimension of the manifest
(frontmatter prefix) that future targets like Aider's YAML config
will reuse.

## §2 Non-goals

- No multi-file split. Cursor supports many `.cursor/rules/*.mdc`
  files; we ship exactly one (`megasaver.mdc`). Multi-scope split
  remains YAGNI until at least one user reports needing it.
- No new connector package. Cursor's manifest lives inside the
  existing `@megasaver/connector-generic-cli` package despite the
  package name's "CLI" connotation. The package's actual contract
  is "any flat-file rule target with a sentinel block"; renaming
  is its own slot if ever justified.
- No new sentinel syntax. The same `<!-- MEGA SAVER:BEGIN -->`
  sentinels used today work inside `.mdc` (which is markdown).
- No frontmatter mutation on existing files. If a user already has
  `.cursor/rules/megasaver.mdc`, the connector treats it like any
  agent file: parse, upsert, write only when changed.
- No support in this slot for `--scope` flags, glob filters, or
  per-rule frontmatter customisation.
- No closure of the open S3–S11 / T1, T3–T8 critic backlog.

## §3 Surface — public API additions

### 3.1 `@megasaver/shared`

Add `"cursor"` to the `agentIdSchema` enum. Final shape:

```ts
export const agentIdSchema = z.enum([
  "claude-code",
  "codex",
  "cursor",
  "generic-cli",
]);
```

Alphabetical order is preserved. Type inference (`AgentId`)
widens by one literal. The agent-id test file gains one
assertion that `agentIdSchema.parse("cursor")` succeeds. The
existing closed-enum exhaustiveness tests update from 3 → 4
members.

Public surface change: minor (additive enum widening).

### 3.2 `@megasaver/connector-generic-cli`

The package's `ConnectorTarget` interface (in `src/targets.ts`)
gains one optional field:

```ts
export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
}
```

The new field is purely opt-in for first-seed pre-content; absent
on `codexTarget` and on the CLI's inline `CLAUDE_CODE_TARGET`,
which keep current behaviour byte-identically.

Add the new manifest:

```ts
export const cursorTarget: ConnectorTarget = Object.freeze({
  id: "cursor",
  agentId: "cursor" satisfies AgentId,
  relativePath: ".cursor/rules/megasaver.mdc",
  header: [
    "---",
    "description: Mega Saver project context (auto-managed block)",
    "alwaysApply: true",
    "---",
    "",
    "",
  ].join("\n"),
});
```

The two-blank-line tail puts a single blank line between the
frontmatter close and the sentinel block (last `""` joined adds
the trailing `\n`, so the final string is
`---\n…\n---\n\n\n` then the block). The block itself is rendered
by `renderBlock(context)` exactly as for the other targets.

Update `builtinTargets`:

```ts
export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
]);
```

`findTarget("cursor")` returns the new manifest; `findTarget("codex")`
unchanged.

Public surface change: minor (new export `cursorTarget`,
`ConnectorTarget` interface widened by optional field).

### 3.3 `@megasaver/cli`

Three small additions in `apps/cli/src/commands/connector.ts` and
one in `apps/cli/src/errors.ts`.

`apps/cli/src/errors.ts`:

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor"] as const;
```

`apps/cli/src/commands/connector.ts` import addition:

```ts
import { type ConnectorTarget, codexTarget, cursorTarget } from "@megasaver/connector-generic-cli";
```

`KNOWN_TARGETS` array:

```ts
const KNOWN_TARGETS: readonly ConnectorTarget[] = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
];
```

`TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length))`
recomputes to `11` (claude-code is still the longest); status
output gutter unchanged. Cursor lines render as
`"cursor       .cursor/rules/megasaver.mdc  …"` (cursor padded
6 → 11 with 5 trailing spaces, matching existing math).

Sync seed branch (`runConnectorSync` per-target loop) gains the
header:

```ts
if (existing === null) {
  const newContent = (target.header ?? "") + renderBlock(context);
  await writeTargetFile({ absPath, content: newContent });
  input.stdout(formatStatusLine(target, "created"));
  continue;
}
```

That single `(target.header ?? "")` change is the only edit on
the sync code path. For `claude-code` and `codex` the prefix is
empty string so output is byte-identical; sync tests pin those
contracts and remain green.

Status path: NO change. `parseBlock` ignores everything outside
the sentinel pair; the byte-equality predicate
(`upsertBlock(existing, ctx) === existing`) sees only the block
content. Frontmatter on existing cursor files lives in the `before`
region and is preserved on writes.

Public surface change: patch (additive enum / target id, no
behaviour break).

## §4 Output format

`mega connector status demo` example for a project where all
three files exist and are in sync (claude-code has an open
session, codex has none, cursor has a different open session):

```text
claude-code  CLAUDE.md                     in-sync   session=01HXY...
codex        AGENTS.md                     missing   session=none
cursor       .cursor/rules/megasaver.mdc   in-sync   session=02ABC...
```

`mega connector sync demo --target cursor` example (file did not
exist; `--target cursor` opts in to seeding):

```text
claude-code  CLAUDE.md                     skipped
codex        AGENTS.md                     skipped
cursor       .cursor/rules/megasaver.mdc   created
```

The default-without-`--target` invocation continues to silently
`skipped` non-existing files for all three targets.

## §5 First-seeded file body

After `mega connector sync demo --target cursor` against a project
with no prior `.cursor/rules/megasaver.mdc`, the file contents
are:

```text
---
description: Mega Saver project context (auto-managed block)
alwaysApply: true
---

<!-- MEGA SAVER:BEGIN -->
[…rendered block, identical to claude-code/codex…]
<!-- MEGA SAVER:END -->
```

The frontmatter is intentionally minimal; users can edit it
freely (e.g. add `globs:` constraints), and `upsertBlock` will
preserve their edits on every subsequent sync because the
sentinel block is the only region the connector touches.

## §6 Test plan

New tests, by package:

- **`@megasaver/shared`** — `agentIdSchema.test.ts` (or whatever
  the file is called):
  - `agentIdSchema.parse("cursor")` returns `"cursor"`.
  - exhaustiveness: enum members count is now 4
    (`["claude-code","codex","cursor","generic-cli"]`).
  - +2 tests; total shared package 22 → 24.

- **`@megasaver/connector-generic-cli`** — `targets.test.ts` (or
  the existing public-export test file):
  - `cursorTarget.id === "cursor"`.
  - `cursorTarget.agentId === "cursor"`.
  - `cursorTarget.relativePath === ".cursor/rules/megasaver.mdc"`.
  - `cursorTarget.header` starts with `"---\n"`, ends with
    `"\n\n\n"` (frontmatter close + 2 blank lines).
  - `cursorTarget.header` contains `"alwaysApply: true"`.
  - `builtinTargets.length === 2` and includes both.
  - `findTarget("cursor")` returns `cursorTarget`.
  - +5 tests; total generic-cli 21 → 26.

- **`@megasaver/cli`** — `connector.test.ts` (sync side):
  - `runConnectorSync --target cursor` against an empty project
    creates `.cursor/rules/megasaver.mdc` with the documented
    frontmatter prepended to the rendered block; status word is
    `created`. (1 test)
  - Subsequent `runConnectorSync` after a session change updates
    only the block region; frontmatter bytes are byte-identical
    to the seed's frontmatter; status word is `wrote`. (1 test)
  - Default `runConnectorSync` (no `--target`) silently skips
    a missing `.cursor/rules/megasaver.mdc`. (1 test)
  - +3 tests.

- **`@megasaver/cli`** — `connector-status.test.ts`:
  - all three files missing → 3 `missing` lines, exit 0. (1 test)
  - cursor seeded by sync, then status reports `in-sync` with
    the seeded session id. (1 test)
  - +2 tests.

- **`@megasaver/cli`** — `session.test.ts`:
  - `mega session create --agent cursor` succeeds; `show` returns
    the new session with `agent: cursor`. (1 test)
  - +1 test.

Total new tests: 13 (2 shared + 5 generic-cli + 6 CLI). CLI
121 → 127, shared 22 → 24, generic-cli 21 → 26. Project total
381 → 394.

## §7 Risk

**MEDIUM**. Three packages touched, each additive:
- `@megasaver/shared` enum widening (closed-set members 3 → 4).
- `@megasaver/connector-generic-cli` interface widening + new
  manifest export.
- `@megasaver/cli` `KNOWN_TARGET_IDS` + `KNOWN_TARGETS` extension
  + one-line seed prefix.

No Core schema change. No public-API breaking. Existing tests on
the changed packages should remain byte-identical-pass; new
behaviour is gated on the cursor manifest's presence. Full
superpowers chain (TDD, code-reviewer, critic v0.2 follow-up
pass) before merge.

## §8 Out of scope (explicit)

- Aider YAML target — separate slot.
- Multi-file Cursor split (`megasaver-{mission,session,memory}.mdc`).
- Per-session `globs:` customisation in cursor frontmatter.
- Renaming `@megasaver/connector-generic-cli` to something more
  honest (e.g. `connector-file-targets`).
- Critic backlog S3–S11, T1, T3–T8 — separate slots.
- Closing I5 `commands/session.ts` 511 LOC split — separate slot
  paired with `mega session update`.
- Bumping the `apps/cli` private app version. The CLI is
  `private: true`; changeset level remains patch.

## §9 Migration / compatibility

No migration required. Existing repos that already have a
`.cursor/rules/megasaver.mdc` (manually authored) will be picked
up by `mega connector status` after this slot lands; the
byte-equality predicate compares the rendered block against the
file's block region (between sentinels). If the user's manual
content does not contain a sentinel pair, status reports
`no-block` for cursor, matching how it would for any other
agent file with content but no Mega Saver block.

For users who created sessions BEFORE this slot, the existing
sessions remain valid (`agentId` was already widened by Zod's
additive enum). Sessions with `agentId: "claude-code"` still
filter correctly to the claude-code target; cursor target's
`pickLatestOpenSession` finds none until a `--agent cursor`
session is created.
