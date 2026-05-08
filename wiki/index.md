---
title: Wiki Index
updated: 2026-05-07
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

## Status

CLI Session CRUD landed on `main` via PR #11 (`9c5a388`): four new
`mega session` subcommands (`create`, `list`, `show`, `end`),
`CoreRegistry.endSession(id, { endedAt })` mutation on both
in-memory and JSON-directory registries, `session_already_ended`
error code, CLI errors module widened with discriminated `ZodContext`
and 6 new helpers + `as const satisfies` drift guards. Six packages
on `main`: `@megasaver/shared` (22 tests), `@megasaver/core`
(116 tests, 15 files), `@megasaver/cli` (84 tests),
`@megasaver/connectors-shared` (56 tests),
`@megasaver/connector-claude-code` (45 tests, byte-identical render
parity), and `@megasaver/connector-generic-cli` (21 tests, Codex
`AGENTS.md` target). 344 total. Previously merged: core M3+M4 PR
#10 (`ac27142`), connector follow-ups + core M1/M2 PR #9
(`0dc2e29`), generic-cli connector PR #8 (`8679c4c`), README
refresh PR #7, Claude Code connector PR #6, CLI project CRUD
PR #5, bootstrap PRs. Next slots (v0.2 follow-ups from critic):
I1 `MEGA_TEST_*` env-var injection cleanup, I2 `session_already_ended`
mapper case, I3 dead `kind: "session"` mapper branch, I4 spec §4
title control-char amendment, I5 split `commands/session.ts` when
`update` lands, cross-process lock integration test,
`atomicWriteFile` + `fsync` durability, `mega connector sync`
CLI command spec.
