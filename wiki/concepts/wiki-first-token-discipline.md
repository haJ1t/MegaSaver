---
title: Wiki-first token discipline
tags: [concept, memory, governance, tokens]
sources:
  - wiki/CLAUDE.md
  - ~/.claude/projects/-Users-halitozger-Desktop/memory/feedback_wiki_first.md
status: active
created: 2026-05-06
updated: 2026-05-06
---

# Wiki-first token discipline

User directive (2026-05-03 + reinforced 2026-05-06): **the wiki is the only sanctioned project memory channel.** Skipping it and reading raw `docs/`, `packages/`, `apps/` files for orientation defeats the entire wiki investment. This page maps every common question to its wiki entry point so a session never re-discovers what a prior session already filed.

## Why this matters

Each session starts cold. Without the wiki, the agent re-reads spec/plan/code to rebuild context. Two-day projects with 5+ specs already cost thousands of tokens per session-start. Wiki summaries reduce that to a fixed budget — `index.md` + 1–3 targeted pages.

Concrete failure mode this directive prevents (observed 2026-05-06 in `feat/cli-project-crud`): the planner assumed `Project` had 2 fields (`id`, `name`) because the wiki page only referenced the spec instead of enumerating fields. Real schema has 5 fields. The drift cost a `Pick<>` deviation, a Task 8 plan correction, and a follow-up commit. A wiki entry that listed the 5 fields would have prevented all of it.

## Question → wiki entry mapping

| Question | Read |
|---|---|
| What is Mega Saver? | [[syntheses/mega-saver-product]] |
| What did we lock in v0.1? | [[decisions/bootstrap-matrix]] |
| What's the v0.1 surface of `@megasaver/core`? (schemas, registry, errors) | [[entities/core]] |
| What's the v0.1 surface of `@megasaver/cli`? (commands, flags, output) | [[entities/cli]] |
| What types/IDs/enums does `@megasaver/shared` export? | [[entities/shared]] |
| How do I write a CLI handler test? | [[workflows/cli-test-pattern]] |
| What process do I follow for a new feature? | [[concepts/superpowers-discipline]] |
| What risk level applies and what does it gate? | [[concepts/risk-aware-development]] |
| Why is the core agent-agnostic? | [[concepts/agent-agnostic-core]] |
| What's "ContextOps"? | [[concepts/contextops]] |
| Where's the bootstrap spec/plan? | [[sources/spec-bootstrap]] / [[sources/plan-bootstrap]] |
| What's in the original product idea? | [[sources/fikri-original]] (do NOT read raw `fikri.txt`) |
| What changed and when? | `wiki/log.md` (append-only timeline) |

## Hard rules

1. **Always read `wiki/index.md` first** at session start. ≤60 lines. Cheap.
2. **Drill into 1–3 targeted pages on demand.** Never bulk-read.
3. **`raw/` is read-only and last-resort.** Source pages in `sources/` index them; reach for raw only when a wiki page explicitly points at a section AND a synthesis is missing the detail.
4. **Spec/plan files live under `docs/superpowers/`.** Wiki pages in `sources/` reference them with one-line summaries. Do NOT open the spec/plan unless the wiki summary is insufficient.
5. **Concrete > pointer.** A wiki page that says "see spec §4.5" wastes tokens compared to one that lists the 5 fields directly. When writing wiki, embed the load-bearing concrete facts (schemas, signatures, error codes, locked patterns).
6. **If the wiki lacks a needed page, write it during the work.** Do not work around the gap. Append to `wiki/log.md` as `ingest`.
7. **Source citation per claim.** Every non-trivial fact carries `(source: <file>:<line>)` so future sessions can verify without re-deriving.
8. **Page size.** ≤50 lines preferred, ≤100 hard cap. Split when longer.

## Anti-patterns (don't)

- Don't read `packages/core/src/*.ts` directly to rediscover Project/Session/MemoryEntry shape. → [[entities/core]] enumerates them.
- Don't grep `errors.ts` for class names. → [[entities/core]] lists `CoreRegistryError` + `CorePersistenceError` codes.
- Don't read `apps/cli/src/commands/doctor.ts` to copy the test pattern. → [[workflows/cli-test-pattern]].
- Don't open the full plan file (`docs/superpowers/plans/...md`) for orientation. Open the relevant entity/workflow page instead.
- Don't rebuild "where are the worktrees" / "what's on main" from `git log`. The latest `wiki/log.md` `schema | … pushed to main` entry has the merge commit + summary.

## Failure recovery

If a session opens the wrong tier (e.g. raw spec) before the wiki, treat it as a wiki gap. Stop, identify which page should have answered the question, file the missing fact into that page, log it. Do not plough on with the raw read — that compounds the gap.

## Related

- [[concepts/superpowers-discipline]] — the broader process this reinforces.
- [[workflows/cli-test-pattern]] — example of a workflow page that crystallizes a repeated pattern.
