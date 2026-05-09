---
title: Aider connector target — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md
  - docs/superpowers/specs/2026-05-07-generic-cli-connector-design.md
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md
  - docs/superpowers/specs/2026-05-09-mega-connector-status-design.md
  - wiki/entities/connectors-generic-cli.md
  - wiki/entities/cli.md
---

# Aider connector target — design

## §0 TL;DR

Add a fourth connector target alongside `claude-code`, `codex`,
and `cursor`: `aider` → `CONVENTIONS.md`. The Mega Saver context
block is rendered by the existing `connectors-shared` primitives;
unlike `cursorTarget` no `header` is set — `CONVENTIONS.md` is
plain markdown with no required frontmatter. Aider loads the file
via `--read CONVENTIONS.md` or a `read:` directive in the user's
`.aider.conf.yml`; wiring that flag is out-of-scope for this slot.

`@megasaver/shared`'s `agentIdSchema` gains `"aider"` (alphabetic
insert, becomes the first member). The generic-cli connector
package gains `aiderTarget` and adds it to `builtinTargets`. The
CLI's `KNOWN_TARGET_IDS` and `KNOWN_TARGETS` add `"aider"` (launch
order, appended after cursor). `mega session create --agent aider`
and `mega connector sync --target aider` work end-to-end after
this slot.

## §1 Motivation

Aider is the fourth agent named in CLAUDE.md §1 ("Mega Saver
connects to Claude Code, Codex, Cursor, **Aider**, and any CLI
agent"). Cursor closed the third member of the public-facing
trio; Aider closes the quartet and completes the v0.1 connector
matrix. From this slot forward, every agent named in the mission
statement has a working `mega connector sync --target <id>` and
a working `mega session create --agent <id>`.

This slot also exercises the **bare-target case** of the
`ConnectorTarget` interface — the variant where `header` is
absent. The cursor slot proved the with-header path; aider proves
the without-header path is also clean.

## §2 Non-goals

- No `.aider.conf.yml` auto-load wiring. The user is responsible
  for adding `--read CONVENTIONS.md` to their Aider invocation or
  setting `read: CONVENTIONS.md` in their `.aider.conf.yml`. We
  ship the file; the user wires the loader.
- No multi-file Aider split (e.g. separate mission/session/memory
  files). One `CONVENTIONS.md`, one block.
- No new connector package. Aider's manifest lives inside the
  existing `@megasaver/connector-generic-cli` package alongside
  `codexTarget` and `cursorTarget`. The package's actual contract
  remains "any flat-file rule target with a sentinel block".
- No new sentinel syntax. The same `<!-- MEGA SAVER:BEGIN -->`
  HTML-comment sentinels work in plain markdown.
- No special collision policy for `CONVENTIONS.md`. Despite the
  generic filename, the same `upsertBlock` semantics apply as for
  every other target: pre-existing content is preserved in the
  `before` region; the block is appended on first seed; subsequent
  syncs replace only the block region.
- No frontmatter on `CONVENTIONS.md`. Plain markdown.
- No closure of the open critic backlog (S3–S11, T1, T3–T8,
  U2–U10, V1–V4 + V6–V9, W4–W10, X4–X6).
- No `mega session update --agent aider` test additions; the
  existing `update.ts` flow validates `--agent` via the widened
  `agentIdSchema` automatically.

## §3 Surface — public API additions

### 3.1 `@megasaver/shared`

Add `"aider"` to the `agentIdSchema` enum. Final shape (alphabetic
insert at front):

```ts
export const agentIdSchema = z.enum([
  "aider",
  "claude-code",
  "codex",
  "cursor",
  "generic-cli",
]);
```

Type inference (`AgentId`) widens by one literal. The agent-id
test file gains one assertion that `agentIdSchema.parse("aider")`
succeeds. The existing closed-enum exhaustiveness drift-guard
(`as const satisfies` pattern) updates from 4 → 5 members.

Public surface change: minor (additive enum widening).

### 3.2 `@megasaver/connector-generic-cli`

Add the new manifest:

```ts
export const aiderTarget: ConnectorTarget = Object.freeze({
  id: "aider",
  agentId: "aider" satisfies AgentId,
  relativePath: "CONVENTIONS.md",
});
```

The `header` field is intentionally absent. `ConnectorTarget`'s
`header?: string` (introduced by the cursor slot) supports this
out of the box; `(target.header ?? "")` already short-circuits to
empty string when `header` is undefined, matching the
byte-identical behaviour codex and claude-code rely on.

Update `builtinTargets`:

```ts
export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
  aiderTarget,
]);
```

`builtinTargets` order is launch order (insertion), not
alphabetic. `findTarget("aider")` returns the new manifest;
`findTarget("codex")` and `findTarget("cursor")` unchanged.

Public surface change: minor (new export `aiderTarget`,
`builtinTargets` length 2 → 3).

### 3.3 `@megasaver/cli`

Three small additions in `apps/cli/src/commands/connector.ts` and
one in `apps/cli/src/errors.ts`.

`apps/cli/src/errors.ts`:

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor", "aider"] as const;
```

(Launch order — same as `KNOWN_TARGETS`. Keep in sync with
`apps/cli/src/commands/connector.ts`.)

`apps/cli/src/commands/connector.ts` import addition:

```ts
import {
  type ConnectorTarget,
  aiderTarget,
  codexTarget,
  cursorTarget,
} from "@megasaver/connector-generic-cli";
```

`KNOWN_TARGETS` array:

```ts
const KNOWN_TARGETS: readonly ConnectorTarget[] = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
  aiderTarget,
];
```

`TARGET_ID_COLUMN_WIDTH = Math.max(...KNOWN_TARGETS.map((t) => t.id.length))`
recomputes to `11` (claude-code is still the longest); status
output gutter unchanged. Aider lines render as
`"aider        CONVENTIONS.md  …"` (aider padded 5 → 11 with
6 trailing spaces, matching existing math).

Sync code path: NO change. `(target.header ?? "")` already in
place from the cursor slot; for aider it short-circuits to empty
string, identical to the claude-code / codex byte contract.

Status code path: NO change. `parseBlock` ignores everything
outside the sentinel pair; the byte-equality predicate
(`upsertBlock(existing, ctx) === existing`) sees only the block
content. Pre-existing content above or below the block is
preserved on writes.

Public surface change: patch (additive enum / target id, no
behaviour break).

## §4 Output format

`mega connector status demo` example for a project where all
four files exist and are in sync (claude-code has an open
session, codex has none, cursor has its own session, aider has
its own session):

```text
claude-code  CLAUDE.md       in-sync   session=01HXY...
codex        AGENTS.md       missing   session=none
cursor       .cursor/rules/megasaver.mdc  in-sync   session=02ABC...
aider        CONVENTIONS.md  in-sync   session=03DEF...
```

`mega connector sync demo --target aider` example (file did not
exist; `--target aider` opts in to seeding):

```text
claude-code  CLAUDE.md       skipped
codex        AGENTS.md       skipped
cursor       .cursor/rules/megasaver.mdc  skipped
aider        CONVENTIONS.md  created
```

The default-without-`--target` invocation continues to silently
`skipped` non-existing files for all four targets.

## §5 First-seeded file body

After `mega connector sync demo --target aider` against a project
with no prior `CONVENTIONS.md`, the file contents are:

```text
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: aider
Project: demo (01HXY...)
Session: none
Risk: none

## Memory

- none
<!-- MEGA SAVER:END -->
```

No frontmatter; the file is plain markdown opening with the
sentinel. Aider's `--read CONVENTIONS.md` ingests the entire file
as read-only context, so the block content is presented to the
agent verbatim.

If the user already has a `CONVENTIONS.md` (e.g. team
conventions, contributing notes) and runs
`mega connector sync demo --target aider`, the rendered block is
**appended** to the existing content (the user's content stays in
the `before` region of `upsertBlock`'s parse). Subsequent syncs
replace only the sentinel-bounded region; user content above is
byte-preserved. This matches how `AGENTS.md` and `CLAUDE.md` are
treated when pre-existing.

## §6 Test plan

New tests, by package:

- **`@megasaver/shared`** — `agent-id.test.ts`:
  - `agentIdSchema.parse("aider")` returns `"aider"`.
  - exhaustiveness drift-guard: enum members count is now 5
    (`["aider","claude-code","codex","cursor","generic-cli"]`).
  - +2 tests; total shared package 24 → 26.

- **`@megasaver/connector-generic-cli`** — `targets.test.ts` (or
  the existing public-export test file):
  - `aiderTarget.id === "aider"`.
  - `aiderTarget.agentId === "aider"`.
  - `aiderTarget.relativePath === "CONVENTIONS.md"`.
  - `aiderTarget.header === undefined` (header field absent).
  - `builtinTargets.length === 3` and includes `aiderTarget`.
  - `findTarget("aider")` returns `aiderTarget`.
  - +5 tests; total generic-cli 26 → 31.

- **`@megasaver/cli`** — `connector.test.ts` (sync side):
  - `runConnectorSync --target aider` against an empty project
    creates `CONVENTIONS.md` with the rendered block (no
    frontmatter); status word is `created`. (1 test)
  - `runConnectorSync --target aider` against a pre-existing
    `CONVENTIONS.md` containing non-MegaSaver content appends the
    block to the file end; existing content above the block is
    byte-preserved; status word is `wrote`. (1 test — proves §2
    "no special collision policy" claim)
  - Default `runConnectorSync` (no `--target`) silently skips
    a missing `CONVENTIONS.md`. (1 test)
  - +3 tests.

- **`@megasaver/cli`** — `connector-status.test.ts`:
  - all four files missing → 4 `missing` lines, exit 0. (1 test)
  - aider seeded by sync, then status reports `in-sync` with
    the seeded session id. (1 test)
  - +2 tests.

- **`@megasaver/cli`** — `session.test.ts`:
  - `mega session create --agent aider` succeeds; `show` returns
    the new session with `agent: aider`. (1 test)
  - +1 test.

Total new tests: 13 (2 shared + 5 generic-cli + 6 CLI). CLI
test count moves accordingly; shared 24 → 26, generic-cli 26 → 31.
Project total 455 → 468.

## §7 Risk

**MEDIUM**. Three packages touched, each additive:

- `@megasaver/shared` enum widening (closed-set members 4 → 5).
- `@megasaver/connector-generic-cli` new manifest export +
  `builtinTargets` length grows.
- `@megasaver/cli` `KNOWN_TARGET_IDS` + `KNOWN_TARGETS` extension.

No Core schema change. No public-API breaking. Existing tests on
the changed packages should remain byte-identical-pass; new
behaviour is gated on the aider manifest's presence. Cursor
precedent makes this a near-mechanical port. Full superpowers
chain (TDD, code-reviewer, critic v0.2 follow-up pass) before
merge.

## §8 Out of scope (explicit)

- `.aider.conf.yml` auto-load helper or generator.
- Multi-file Aider split.
- `CONVENTIONS.md` frontmatter / metadata.
- Renaming `@megasaver/connector-generic-cli` to something more
  honest (e.g. `connector-file-targets`).
- Critic backlog (S3–S11, T1, T3–T8, U2–U10, V1–V4, V6–V9,
  W4–W10, X4–X6) — separate slots.
- `mega session update --agent aider` flow tests (auto-covered by
  `agentIdSchema` widening).
- Bumping the `apps/cli` private app version. The CLI is
  `private: true`; changeset level remains patch.

## §9 Migration / compatibility

No migration required. Existing repos that already have a
`CONVENTIONS.md` (manually authored, common for team conventions)
will be picked up by `mega connector status` after this slot
lands; the byte-equality predicate compares the rendered block
against the file's block region (between sentinels). If the user's
manual content does not contain a sentinel pair, status reports
`no-block` for aider, matching how it would for any other agent
file with content but no Mega Saver block. The user can then run
`mega connector sync demo --target aider` to seed, after which
their existing content is preserved in the `before` region with
the rendered block appended.

For users who created sessions BEFORE this slot, the existing
sessions remain valid (`agentId` was already widened by Zod's
additive enum). Sessions with `agentId: "claude-code"` /
`"codex"` / `"cursor"` still filter correctly to their respective
targets; aider target's `pickLatestOpenSession` finds none until
a `--agent aider` session is created.
