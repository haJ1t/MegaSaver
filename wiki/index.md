---
title: Wiki Index
updated: 2026-05-09
---

# Wiki Index — Mega Saver

> **Session start: read this file first.** It tells you what exists in the wiki and where to look.

## Decisions (locked-in choices)

- [[decisions/bootstrap-matrix]] — the 10 foundation decisions (path, repo, stack, MVP, language, git…)

## Concepts (cross-cutting ideas)

- [[concepts/contextops]] — what "ContextOps" means; product category.
- [[concepts/agent-agnostic-core]] — non-negotiable: agents connect to core, never reverse.
- [[concepts/risk-aware-development]] — LOW / MEDIUM / HIGH / CRITICAL gating skills.
- [[concepts/superpowers-discipline]] — mandatory chain on every feature.
- [[concepts/wiki-first-token-discipline]] — wiki is the only sanctioned project memory; question → entry mapping; hard rules to avoid raw spec/code reads.

## Entities

- [[entities/cli]] — `@megasaver/cli` `mega` command scaffold (v0.1).
- [[entities/connectors-claude-code]] — `@megasaver/connector-claude-code` root `CLAUDE.md` adapter (merged).
- [[entities/connectors-generic-cli]] — `@megasaver/connector-generic-cli` manifest-driven connector (v0.1 = Codex `AGENTS.md`).
- [[entities/connectors-shared]] — `@megasaver/connectors-shared` block helpers + context schema.
- [[entities/core]] — `@megasaver/core` agent-agnostic engine foundation (v0.1).
- [[entities/shared]] — `@megasaver/shared` contracts package (v0.1).

More subsystem pages land as features get built. Slot reserved for: `mcp-bridge`, `app`, `skill-packs`.

## Workflows

- [[workflows/cli-test-pattern]] — Citty handler test shape, env injection, biome ↔ TS strict conflict resolution.

Slots reserved for future workflow pages: `multi-agent-dogfood`, `design-skill-routing`, `core-registry-consumer-pattern`.

## Syntheses (cross-page answers)

- [[syntheses/mega-saver-product]] — what the product is, six subsystems, v0.1 slice.

## Sources (pointers to raw + project artifacts)

- [[sources/fikri-original]] — original 1421-line product idea (`raw/mega-saver-platform-fikri.txt`) with section index. Read this instead of the raw file.
- [[sources/spec-bootstrap]] — pointer to `docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md`.
- [[sources/plan-bootstrap]] — pointer to `docs/superpowers/plans/2026-05-03-mega-saver-bootstrap-plan.md`.

## Raw

- `raw/mega-saver-platform-fikri.txt` — original Turkish product idea, 1421 lines. **Do NOT read whole.** Use `sources/fikri-original.md`.

## Quick links by question

| Question                                          | Read                                            |
|---------------------------------------------------|-------------------------------------------------|
| What is Mega Saver?                               | [[syntheses/mega-saver-product]]                |
| What did we decide for the bootstrap?             | [[decisions/bootstrap-matrix]]                  |
| Why is the core agent-agnostic?                   | [[concepts/agent-agnostic-core]]                |
| What process do I follow for a new feature?       | [[concepts/superpowers-discipline]]             |
| Which wiki page answers my question?              | [[concepts/wiki-first-token-discipline]]        |
| What risk level applies and what does it gate?    | [[concepts/risk-aware-development]]             |
| What schemas / registry / errors does Core export? | [[entities/core]]                              |
| What commands / flags does the CLI support?       | [[entities/cli]]                                |
| What does the Claude Code connector write?        | [[entities/connectors-claude-code]]             |
| What does the generic-CLI connector ship?         | [[entities/connectors-generic-cli]]             |
| Where do shared connector helpers live?           | [[entities/connectors-shared]]                  |
| What types / IDs does Shared export?              | [[entities/shared]]                             |
| How do I write a CLI handler test?                | [[workflows/cli-test-pattern]]                  |
| What's in the original product idea?              | [[sources/fikri-original]]                      |
| Where's the bootstrap spec/plan?                  | [[sources/spec-bootstrap]] / [[sources/plan-bootstrap]] |
| What does `mega connector status` report?         | [[entities/cli]]                                |

## Status

`mega session update` + I5 split landed via PR #18 (`04987a8`):
new `mega session update <sessionId> [--title …] [--risk …]
[--agent …]` for partial mutation of an open session. `--title ""`
clears to `null`; ended sessions are rejected. `@megasaver/core`
exports `sessionUpdatePatchSchema` and a new
`CoreRegistry.updateSession(id, patch)` method on both the
in-memory and JSON-directory implementations. `apps/cli`'s
`commands/session.ts` (511 LOC > §8 300 threshold) is split into
`commands/session/{create,list,show,end,update,shared,index}.ts`
closing v0.1 backlog item I5. Previously: Cursor connector target landed via PR #17 (`f2d7f63`): `agentIdSchema`
widens to four members (adds `"cursor"`),
`@megasaver/connector-generic-cli` ships `cursorTarget` writing
`.cursor/rules/megasaver.mdc` with optional `ConnectorTarget.header`
for first-seed YAML frontmatter, and the CLI registers cursor in
`KNOWN_TARGET_IDS` / `KNOWN_TARGETS`. `mega session create --agent
cursor` and `mega connector sync demo --target cursor` work
end-to-end. Existing `claude-code` and `codex` paths byte-identical.
Previously: `mega connector status` landed via PR #15 (`b1a81cc`): new
`mega connector status <projectName> [--target <id>]` adds read-only
per-target reporting on top of the connector primitives.
Status words: `in-sync` | `drift` | `no-block` | `missing` | `error`.
Exit `0` when every line is `in-sync` or `missing`; `1` otherwise.
The previously-shipped `mega connector sync` (PR #14, `204f922`)
remains unchanged.

Critic v0.2 followups I1–I4 closed via PR #13
(`0facd09`, NODE_ENV gate on `MEGA_TEST_*` env-vars + `readTestEnv`
helper + workflow doc) and PR #12 (`5b3923a`, `session_already_ended`
mapper case + outer-catch ctx using `kind: "session"` + spec §4
title control-char drift correction). CLI Session CRUD itself
landed on `main` via PR #11 (`9c5a388`): four `mega session`
subcommands (`create`, `list`, `show`, `end`),
`CoreRegistry.endSession(id, { endedAt })` mutation on both
in-memory and JSON-directory registries, `session_already_ended`
error code, CLI errors module widened with discriminated
`ZodContext` + 7 helpers + `as const satisfies` drift guards.
Six packages on `main`: `@megasaver/shared` (24 tests),
`@megasaver/core` (128 tests, 15 files), `@megasaver/cli`
(142 tests), `@megasaver/connectors-shared` (56 tests),
`@megasaver/connector-claude-code` (45 tests, byte-identical
render parity), and `@megasaver/connector-generic-cli` (26 tests,
Codex `AGENTS.md` + Cursor `.cursor/rules/megasaver.mdc` targets). 421 total. Previously merged: core
M3+M4 PR #10 (`ac27142`), connector follow-ups + core M1/M2 PR #9
(`0dc2e29`), generic-cli connector PR #8 (`8679c4c`), README
refresh PR #7, Claude Code connector PR #6, CLI project CRUD
PR #5, bootstrap PRs. Open v0.2 follow-ups: I5 closed in PR #18
(commands/session.ts split into commands/session/), cross-process
lock integration test (forked process), `atomicWriteFile` + `fsync`
durability, plus the deferred slices `mega project create --root
<dir>`, Aider YAML target, MemoryEntry CLI commands, `--json`
output flag pass. Critic v0.2 followups for PR #15 (`mega connector status`):
S1 + S2 + S12 closed in PR #16 (`eb21060`) — `pickLatestOpenSession`
switched to `Date.parse` numeric compare; `error` status line now
carries `session=<id|none>` for column symmetry; S12 closed by
decision (the duplicate compute inside `buildConnectorContext`
is kept deliberately to preserve its self-contained shape).
Still open: S3 extract `resolveProjectAndRoot` shared prologue
between sync + status when third consumer arrives; S4 split
`apps/cli/src/commands/connector.ts` (366 LOC) into
`connector/{sync,status,shared,index}.ts`; S5 harden read-path
symlink semantics (`readTargetFile` lstat-first or
`assertTargetWithinProject`); S6 regression-fixture asserting
`upsertBlock(existing, ctx) === existing` for seeded files
inoculates byte-equality predicate; S7 multi-open-session
tie-break test; S8 `--target` help-text divergence (filter ≠
seed); S9 spec §4 example uses 3-space gutter, impl + tests use
2; S10 spec §11 concurrency stanza for status vs concurrent
sync; S11 `targets.length > 0` invariant after filter.
Critic v0.2 followups for PR #16 (S1+S2 followups slot): T2
(error+open-session cross-product test) closed inline in
PR #16 (`aaa4607`). Still open: T1 direct unit test on
`pickLatestOpenSession` (export as `_internal` or sibling
helper); T3 same-instant tie-break test (parallels S7); T4
DST-transition ranking test; T5 millisecond-precision test;
T6 sync error line carries `session=<id|none>` for
cross-command symmetry (bundle with `--json` flag landing);
T7 §4 worked-example annotation in
`2026-05-09-mega-connector-status-design.md` clarifying the
three lines are from multiple runs; T8 restructure
`wiki/index.md` Status section paragraph into a list when next
critic finding closes.
Critic v0.2 followups for PR #17 (cursor connector target slot):
U1 (session `--agent` help text drift) closed inline in PR #17
(`c9ddfc8`) with a snapshot test that derives the expected agent
list from `agentIdSchema.options`. Still open: U2 cursor-specific
`no-block` test (current coverage tests claude-code only); U3
test cursor sync into existing user-content `.cursor/rules/*.mdc`
file (humanContent path through `joinWithManagedBlock`); U4
document user-edit frontmatter contract (which edits survive
`upsertBlock` round-trip); U5 cursor multi-open-session test for
`pickLatestOpenSession` correctness when both claude-code and
cursor sessions are open; U6 `mkdir({recursive:true})` failure
path test (EACCES / ENOSPC / ENOTDIR); U7 wrap mkdir failures as
`ConnectorError("file_write_failed", …)` for consistent error
shape (today they fall through the unexpected-failure branch);
U8 README refresh — `Claude Code connector` section is stale,
codex (PR #8) and cursor (PR #17) targets unmentioned;
U9 validate `ConnectorTarget.header` does not contain
`MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END` literals at
registration time (latent footgun for external targets); U10
add `// claude-code lives in @megasaver/connector-claude-code;
this aggregates across packages.` comment at
`apps/cli/src/commands/connector.ts:48` so the cross-package
`KNOWN_TARGETS` aggregation is discoverable for new contributors.
Critic v0.2 followups for PR #18 (session update + I5 split slot):
IMPORTANT-1 (UX asymmetry between create/update for --risk/--agent
error format) and V5 (--title control-char/newline guard bypass on
update) both closed inline in PR #18 (`6841bbb`) by parsing
agentIdSchema/riskLevelSchema/titleSchema at the CLI boundary in
`update.ts` and extracting `titleSchema` into
`commands/session/shared.ts`. Still open: V1 concurrent-update
race test (process fork) — pairs with the existing cross-process
lock integration test followup; V2 partial-write recovery test
(kill between temp-write and rename in `json-directory-store.ts`);
V3 schema drift property test (fast-check) ensuring every random
session × random patch keys merges cleanly through `sessionSchema`;
V4 whitespace-only `--title "   "` semantics decision (today
update accepts, create rejects); V6 update-then-end durability
test (open → `update --risk high` → `end` → assert ended session
carries `riskLevel: "high"`); V7 multi-flag error precedence pin
(`update <bad-uuid> --risk bogus --agent unknown` — assert which
error surfaces first); V8 pin `kind: "session_update"` Zod-error
message format in a test (currently asserts only `startsWith
"error:"`); V9 wiki entity refresh — `wiki/entities/core.md`
test-count line still claims 116 instead of 128 post-merge.
