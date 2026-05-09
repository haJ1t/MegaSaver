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
| What does `mega memory` ship?                      | [[entities/cli]]                                |

## Status

Closed-enum tripwire refactor landed via PR #22 (`489f7d0`):
the broken `as const satisfies readonly T[]` mirror pattern in
`apps/cli/src/errors.ts` (4 sites: `AGENT_VALUES`, `RISK_VALUES`,
`KNOWN_SCOPE_IDS`, local `KNOWN_TARGET_IDS`) is replaced with
schema-derived sources: `agentIdSchema.options` /
`riskLevelSchema.options` from `@megasaver/shared`,
`memoryScopeSchema.options` from `@megasaver/core`,
`KNOWN_TARGET_IDS` from a new `apps/cli/src/known-targets.ts`
canonical registry (`KNOWN_TARGETS.map((t) => t.id)`). New
file owns `CLAUDE_CODE_TARGET`, `KNOWN_TARGETS`,
`KnownTargetId` literal union, `isKnownTargetId` helper. The
duplicated `KNOWN_TARGET_IDS` in `connector.ts` collapses to
the same import. Individual `codexTarget`/`cursorTarget`/
`aiderTarget` `: ConnectorTarget` annotations dropped so
`(typeof KNOWN_TARGETS)[number]["id"]` resolves to the literal
union (verified empirically with `@ts-expect-error` probe).
+8 net tests (5 known-targets + 3 errors drift-guards). Mid-
execution `43205c8` regressed `KnownTargetId` to `string` by
removing `as const` from `CLAUDE_CODE_TARGET`; recovered in
`79eb9d8` (revert + `Object.hasOwn`-style header absence
checks in `targets.test.ts`). Critic re-pass IMPORTANT-2
(loop-cast structural smell at `connector.ts:128`) +
IMPORTANT-3 (expectTypeOf runtime no-op clarification) closed
inline (`67b6515`). Behavior byte-identical: 4 smoke strings
match before/after. Closes the bug class behind cursor PR #17
+ aider PR #21 CRITICAL fix-ups for **error messages**. Open
**Z-series backlog**: **Z1** *FIRST-CRITICAL* — citty
`description` strings in `apps/cli/src/commands/session/create.ts`,
`session/update.ts`, `memory/create.ts` still hand-mirror the
same enum lists with "Keep in sync" comments → next agent
widening recreates the bug class on the help-text surface;
**Z2** vitest `typecheck: true` mode wire (so `expectTypeOf`
catches regressions in `vitest run` alone, not just via
`pnpm typecheck`); **Z3** add `.test-d.ts` regression suite
with `@ts-expect-error` directives pinning the literal union;
**Z4** document in `wiki/entities/cli.md` which closed-set
surfaces are schema-derived (errors.ts) vs still hand-mirrored
(citty descriptions). Previously: Aider connector target
landed via PR #21 (`184b13d`): 4th built-in connector target
ships — `aider` → `CONVENTIONS.md`
(plain markdown, no frontmatter; user wires `aider --read
CONVENTIONS.md` themselves). Closes the v0.1 connector matrix
promised in `CLAUDE.md §1` (claude-code + codex + cursor +
aider). `agentIdSchema` widens to 5 members (alphabetic-first
insert); `aiderTarget` joins `builtinTargets`; CLI
`KNOWN_TARGETS` appends in launch order. Critic re-pass caught
CRITICAL Y1 (silent stale `AGENT_VALUES` in
`apps/cli/src/errors.ts` — `as const satisfies readonly
AgentId[]` permits subset, so the supposed tripwire failed open
and `mega session create --agent <typo>` lied to the user with a
4-member valid-agent list) and MAJOR Y2 (parallel `update.ts`
`--agent` description drift + missing drift-guard test for
`sessionUpdateCommand`); both closed inline before merge (Y1 in
`585554f`, Y2 in `dbad49e`). Open Y-series backlog: **Y3** docs
drift (`CLAUDE.md §7` / `AGENTS.md` / `.cursor/rules/*.mdc`
enumerate 3 agent files but 4 now ship); **Y4** add `aiderTarget`
assertion to `packages/connectors/generic-cli/test/public-export.test.ts`;
**Y5** noop + stale-block-replace coverage holes for aider sync;
**Y6** repo-wide closed-enum drift-guard refactor (replace
`as const satisfies readonly T[]` with proper `Equal<>`
exhaustiveness check or use `schema.options` directly — the
recurring fix-up pattern across cursor + aider proves the current
tripwire is structurally insufficient); **Y7** document
launch-order vs alphabetic convention in `docs/conventions/`.
Previously: Connector memoryEntries wiring landed via PR #20
(`b0e4382`): `mega connector sync` and `mega connector status`
now read real memory entries via
`registry.listMemoryEntries(project.id)` and filter them
per-target to "project-scoped + current-session-scoped".
Empty-memory projects continue to render `- none`
byte-identically. Critic backlog item W11 (deferred-state lock
test) closes by superseding — the wiring slot itself locks the
real state. Previously: `mega session update` + I5 split landed via PR #18 (`04987a8`):
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
(176 tests), `@megasaver/connectors-shared` (56 tests),
`@megasaver/connector-claude-code` (45 tests, byte-identical
render parity), and `@megasaver/connector-generic-cli` (26 tests,
Codex `AGENTS.md` + Cursor `.cursor/rules/megasaver.mdc` targets). 455 total. Previously merged: core
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
Critic v0.2 followups for PR #19 (MemoryEntry CLI slot):
W1 + W2 + W3 closed inline in PR #19 (`b186679`) — `projectNameSchema`
hoisted to `commands/shared/schemas.ts` (5-site consolidation +
cross-command consistency test); `readTestEnv` deduplicated to the
canonical `session/shared.ts` copy; `session_project_mismatch`
mapper branch with canonical CLI message + cross-project create
test. Still open: W4 decide `mega memory create --scope session`
policy on ended sessions (today accepts; spec silent); W5
explicit `memory_entry_already_exists` mapper branch (defensive
parallel to `memory_entry_not_found`); W6 widen `contentSchema`
regex to block U+2028 / U+2029 (also affects `titleSchema`); W7
switch list `truncate` to `Intl.Segmenter` for grapheme-aware
splitting (or accept codepoint-only as v0.1); W8 README refresh —
list all v0.1 subcommands (chronic drift since PR #11); W9
parse-on-handoff consistency policy between `memory create` (re-
parses) and `session create` (trusts registry); W10 restore
NODE_ENV in `apps/cli/test/memory.test.ts` afterEach (mirror
session.test.ts save/restore pattern); W11 closed in PR #20
(`b0e4382`) by superseding — the wiring slot itself locks the
real state via integration tests asserting block contents after
`mega memory create` + `mega connector sync`.
Critic v0.2 followups for PR #20 (connector memoryEntries
wiring slot): X1 + X2 closed inline in PR #20 (`65cbd12`) — 3
stale references in `2026-05-09-mega-connector-sync-design.md`
(§0 TL;DR + §2 + §3d pseudocode) corrected; redundant
`assertConnectorContext` call dropped from `buildConnectorContext`
(renderer already validates at the boundary). Still open: X4
decide and document `memoryEntries.length > 20` policy
(`ConnectorContextSchema` enforces `.max(20)` — current behavior
is hard-fail; filter-then-cap-by-recency is the natural answer);
X5 delete dead continuation-indent path in
`packages/connectors/shared/src/render.ts:32-37` (CLI
`contentSchema` rejects newlines so the path is unreachable
through the public surface) or document the invariant; X6 fix
S4 backlog tracker entry — actual `connector.ts` LOC is now
369 (354 → 369 = +15 in this slot, not +3 as PR description
implied; S4 split urgency higher than tracked).
