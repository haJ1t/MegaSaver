---
title: Connector memoryEntries wiring — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md
  - docs/superpowers/specs/2026-05-09-mega-connector-status-design.md
  - docs/superpowers/specs/2026-05-09-memory-entry-cli-design.md
  - wiki/entities/cli.md
---

# Connector memoryEntries wiring — design

## §0 TL;DR

Replace the `memoryEntries: []` placeholder in
`apps/cli/src/commands/connector.ts`'s `buildConnectorContext`
with a real call to `registry.listMemoryEntries(project.id)`,
filtered to "project-scoped + current-session-scoped" relative
to the target's picked session. Both `mega connector sync` and
`mega connector status` flow through `buildConnectorContext`, so
both commands inherit the change.

After this slot, the loop that PR #19 explicitly deferred closes:

```
mega memory create demo --scope project --content "user prefers TS"
mega connector sync demo
# → CLAUDE.md / AGENTS.md / .cursor/rules/megasaver.mdc each contain
#   "- [project:01abc...] user prefers TS" inside the Mega Saver block.
```

Critic backlog item **W11** (locking the deferred state with an
integration test) closes automatically because the assertion
flips from "block is empty" to "block contains the entry".

## §1 Motivation

`@megasaver/connectors-shared`'s `renderBlock` already serialises
memory entries into the agent block: `- [<scope>:<id>] <content>`
per entry, `- none` when the list is empty. PR #19 added the CLI
surface to create / list / show memory entries but left the
connector context wiring on `[]` per the spec's explicit "out of
scope (Bonus deferred)" note. The product loop is therefore
two-thirds shipped: entries can be created and read via the CLI
but never appear in the agent's context block.

This slot is a one-line production change (plus a filter helper)
that closes the loop. After this slot, the `## Memory` section in
each rendered agent file reflects the user's actual `mega memory`
state.

## §2 Non-goals

- No render-format change. `renderMemoryEntries` in
  `connectors-shared` already emits the documented shape.
- No new `mega memory` subcommand or schema change.
- No memory cap / pagination / `--limit` flag (Q3-A).
- No order-by-createdAt sort (Q2-A — registry insertion order
  already monotonic-with-createdAt in practice).
- No closure of W4-W10 critic backlog items (each is its own
  slot).
- No `--json` flag pass.

## §3 Surface

### 3.1 Production change — `apps/cli/src/commands/connector.ts`

`buildConnectorContext` widens by one parameter and gains a
filter step. Current shape (around line 54-66):

```ts
function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  return assertConnectorContext({
    agentId: target.agentId,
    project,
    session,
    memoryEntries: [],
  });
}
```

New shape:

```ts
function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
  allMemoryEntries: readonly MemoryEntry[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  const memoryEntries = filterMemoryEntriesForSession(allMemoryEntries, session);
  return assertConnectorContext({
    agentId: target.agentId,
    project,
    session,
    memoryEntries,
  });
}

function filterMemoryEntriesForSession(
  entries: readonly MemoryEntry[],
  session: Session | null,
): MemoryEntry[] {
  return entries.filter((entry) => {
    if (entry.scope === "project") return true;
    return session !== null && entry.sessionId === session.id;
  });
}
```

`MemoryEntry` is imported from `@megasaver/core` (already exported
by that package).

### 3.2 Caller updates

Two call sites — `runConnectorSync` (around line 140) and
`runConnectorStatus` (around line 293) — both pass three args
today. Both gain a fourth.

For each command:

1. Fetch the project's memory entries ONCE before the per-target
   loop, alongside the existing `sessions` fetch:
   ```ts
   const sessions = registry.listSessions(project.id);
   const memoryEntries = registry.listMemoryEntries(project.id);
   ```
2. Inside the loop, pass `memoryEntries` to
   `buildConnectorContext`:
   ```ts
   const context = buildConnectorContext(target, project, sessions, memoryEntries);
   ```

`assertProjectRoot` ordering and the per-target try/catch shape
are unchanged.

### 3.3 Filter rule

For each target's picked `session` (from
`pickLatestOpenSession(sessions, target.agentId)`):

| Memory entry shape          | Included in block? |
|------------------------------|---------------------|
| `scope: "project"`           | Yes (always)        |
| `scope: "session"`, sessionId === current session.id | Yes (current context) |
| `scope: "session"`, sessionId !== current session.id | No (other agent / other run)  |
| `scope: "session"`, current session is `null` | No (no current context to belong to) |

The `filterMemoryEntriesForSession` helper above implements this
table verbatim.

### 3.4 Render path

No change. `packages/connectors/shared/src/render.ts:30-38`
already emits `- [<scope>:<id>] <content>` per entry and `- none`
for an empty list. Filter result feeds straight into the existing
renderer.

### 3.5 Spec drift in prior connector spec

`docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md`
contains the line:

> "Memory entries are empty in v0.1."

This claim is no longer true after this slot. The line is updated
to:

> "Memory entries: project-scoped entries (always) plus
> session-scoped entries belonging to the target's currently-
> picked open session (`pickLatestOpenSession`). Other agents'
> session-scoped memory is filtered out so each block reflects
> only the relevant context."

The wiki entry `wiki/entities/cli.md` carries the same drift in
its `mega connector sync` subsection (the line "Memory entries
are empty in v0.1") and is corrected in the same way.

## §4 Output format examples

`mega memory create demo --scope project --content "user prefers TS"` →
`mega connector sync demo` →
`CLAUDE.md` block:

```text
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: claude-code
Project: demo (01project-...)
Session: 01session-...
Risk: medium

## Memory

- [project:01memory-...] user prefers TS
<!-- MEGA SAVER:END -->
```

`mega connector status demo`:

```text
claude-code  CLAUDE.md   in-sync   session=01session-...
codex        AGENTS.md   missing   session=none
cursor       .cursor/rules/megasaver.mdc   missing   session=none
```

After `mega memory create demo --scope project --content "another note"`:

```text
$ mega connector status demo
claude-code  CLAUDE.md   drift   session=01session-...   ← block needs re-render
```

After `mega connector sync demo`:

```text
$ mega connector status demo
claude-code  CLAUDE.md   in-sync   session=01session-...
```

## §5 Test plan

**Sync side (`apps/cli/test/connector.test.ts`):**

1. **project-scoped entry round-trip** — seed 1 project + 1 open
   claude-code session + 1 project-scoped memory entry. Sync
   `--target claude-code`. Read CLAUDE.md from disk; assert
   block contains `[project:<id>] <content>`.

2. **session-scoped filter — current session included** — seed
   1 project + 1 open claude-code session + 1 session-scoped
   memory belonging to that session. Sync `--target claude-code`.
   Block contains the entry as `[session:<id>] <content>`.

3. **session-scoped filter — other session excluded** — seed
   1 project + 1 open claude-code session (S1) + 1 ENDED
   claude-code session (S2) + 1 session-scoped memory belonging
   to S2. Sync `--target claude-code`. Block contains
   `## Memory` followed by `- none` (memory belongs to S2, but
   `pickLatestOpenSession` picks S1; S2's memory is filtered out).

4. **`Session: none` filters all session-scoped** — seed 1
   project + 0 open sessions + 1 session-scoped memory (orphan
   sessionId). Sync `--target claude-code` (default). Block
   contains `Session: none` and `## Memory` followed by `- none`.

5. **Multi-agent isolation** — seed 1 project + 1 open
   claude-code session + 1 open codex session + 2 session-scoped
   memories (one per agent). Default sync (no `--target`). Both
   files written. CLAUDE.md block contains only the claude-code
   session's memory; AGENTS.md block contains only the codex
   session's memory.

**Status side (`apps/cli/test/connector-status.test.ts`):**

6. **Drift after `mega memory create`** — seed project + open
   session, sync (block written, in-sync). Then add a memory
   entry. `mega connector status` reports `drift` for the
   target whose block now lacks the new entry.

7. **In-sync after re-sync** — same setup as #6 but immediately
   re-sync after memory create. Status reports `in-sync`.

**Total new tests: 7.** CLI 169 → 176.

The existing connector tests (which assume `memoryEntries: []`)
do NOT regress because their fixtures don't seed memory entries
— they keep producing `- none` blocks.

## §6 Risk

**MEDIUM-LOW**. Single-package change (`apps/cli`). Pure additive
behaviour: empty-memory projects produce byte-identical blocks
to today; non-empty memory projects gain real entries. Core
unchanged. `connectors-shared` unchanged.

Full superpowers chain (TDD, code-reviewer, critic backlog pass).

## §7 Out of scope (explicit)

- W4-W10 critic backlog items.
- Memory cap / pagination / `--limit`.
- `--json` flag pass.
- `mega memory delete` / `update`.
- Per-agent memory scoping (e.g. `agentId` field on MemoryEntry)
  — current schema doesn't have it; per-agent isolation in this
  slot is achieved via `sessionId` + `pickLatestOpenSession`'s
  per-`agentId` filter.

## §8 W11 closure

Critic backlog `W11` (PR #19 critic) was: "Lock the deferred
connector-context-wiring state with an integration test asserting
`mega connector sync` block is unchanged after `mega memory
create` until the wiring slot lands."

This slot is the wiring slot. The same integration test pattern
(create memory, sync, inspect block) now asserts the *real* state
(block contains the entry) instead of the deferred state (block
unchanged). W11 closes by superseding.

The wiki Status section update reflects this: W11 moves from
"open" to "closed in PR #TBD (this PR)".

## §9 Migration / compatibility

No migration. Existing CLI consumers that did not call
`mega memory create` see byte-identical sync/status output (the
filter on an empty list yields an empty list, renderer emits
`- none`). Existing CLAUDE.md / AGENTS.md / `.cursor/rules/*.mdc`
blocks that already say `- none` continue to say `- none` until
the user runs `mega memory create` then `mega connector sync`.

If a user pre-existing `memory-entries.json`-style data made it
to disk via test harness or hand-edit, `mega connector sync`
will pick those up on first run after this slot lands —
intentional behaviour, no migration needed.
