---
title: Wiki Log
type: append-only
---

# Wiki Log

Append-only timeline. New entries at the bottom.

Entry format:

```
## [YYYY-MM-DD] <op> | <description>
```

Ops: `ingest`, `query`, `lint`, `archive`, `schema`.

---

## [2026-05-03] schema | wiki vault initialized

Created vault skeleton with eight folders (`raw`, `sources`, `decisions`, `concepts`, `entities`, `workflows`, `syntheses`, `archive`). Wrote schema (`CLAUDE.md`), index, this log.

## [2026-05-03] ingest | mega-saver-platform-fikri.txt (1421 lines)

Source copied to `raw/mega-saver-platform-fikri.txt`. Section index and condensed summary written to `sources/fikri-original.md`. Six subsystems and 30+ features identified.

## [2026-05-03] ingest | bootstrap spec + plan

Wrote `sources/spec-bootstrap.md` and `sources/plan-bootstrap.md` as pointers (no duplicate content). Both artifacts live in `docs/superpowers/`.

## [2026-05-03] ingest | bootstrap decisions

Wrote `decisions/bootstrap-matrix.md` capturing the 10 foundation choices made during the brainstorming session: project path, monorepo, MVP slice (headless-first), stack (Node 22 + TS strict + pnpm + Turborepo + tsup + Vitest + Biome + Citty), strict superpowers discipline, multi-agent dogfood, design skill mapping, English-only, Conventional Commits + caveman-commit, trunk + worktree workflow.

## [2026-05-03] ingest | seed concepts

Wrote four cross-cutting concept pages: `concepts/contextops.md`, `concepts/agent-agnostic-core.md`, `concepts/risk-aware-development.md`, `concepts/superpowers-discipline.md`. These compound across every future feature.

## [2026-05-03] ingest | product synthesis

Wrote `syntheses/mega-saver-product.md` — single page naming the six subsystems and the v0.1 slice. Future Claude instances answer "what is Mega Saver?" from this page, not the raw fikri.

## [2026-05-03] schema | wiki/raw/*.{txt,md,pdf} gitignored

Before publishing the repo to a public GitHub remote, decided the raw `mega-saver-platform-fikri.txt` (the user's original Turkish product notes) should not enter public history. Added `wiki/raw/*.txt` (and `*.md`, `*.pdf`) to `.gitignore`; updated `sources/fikri-original.md` to flag the file as local-only. The summary + section index in `sources/fikri-original.md` already covers everything the agent needs in normal operation. The historical wiki commit (b463442) was rewritten to drop the raw file before any push — backup tag `backup/before-fikri-untrack` retained locally.

## [2026-05-03] schema | bootstrap PR #1 merged into main

PR <https://github.com/haJ1t/MegaSaver/pull/1> merged. Main now carries all 17 governance deliverables: 12 `docs/conventions/*.md`, `CLAUDE.md`, `AGENTS.md`, three `.cursor/rules/*.mdc`. Worktree removed, `feat/bootstrap-governance` deleted (local + remote), backup tags purged. The `Saver/` placeholder on Desktop also removed — `MegaSaver/` is the only home now.

## [2026-05-03] schema | project-skeleton PR #2 merged into main

PR <https://github.com/haJ1t/MegaSaver/pull/2> merged. Main now carries the full pnpm workspace + tooling skeleton: `.nvmrc`, `.npmrc`, `.editorconfig`, root `package.json` (Node ≥22, `pnpm@9.15.9` via Corepack), `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `turbo.json`, `.changeset/config.json`, `LICENSE` (MIT), `README.md`, `.vscode/extensions.json`, and `pnpm-lock.yaml`. `pnpm install` and `pnpm verify` succeed in a clean checkout. Worktree removed, `feat/project-skeleton` deleted (local + remote). `apps/` and `packages/` remain empty — first real package (`@megasaver/shared`) lands in next spec.

## [2026-05-04] ingest | shared package spec + plan

Wrote `docs/superpowers/specs/2026-05-04-shared-package-design.md` and `docs/superpowers/plans/2026-05-04-shared-package-plan.md`. Locked v0.1 surface for the new package: `RiskLevel`, `AgentId`, three branded entity IDs (`ProjectId`, `SessionId`, `MemoryEntryId`). Schema-first via Zod; Vitest + fast-check; ESM-only; `private: true` until v0.1 release. Risk MEDIUM.

## [2026-05-04] ingest | entities/shared seeded

Wrote `wiki/entities/shared.md` and unblocked the Entities section of `index.md`. Future entity pages (`core-engine`, `cli`, connector pages) follow the same template.

## [2026-05-04] schema | shared package PR #3 merged into main

PR <https://github.com/haJ1t/MegaSaver/pull/3> merged. Main now carries the first real workspace package — `@megasaver/shared`. v0.1 surface live: `RiskLevel` enum, `AgentId` closed enum (claude-code + generic-cli), three branded UUID IDs (`ProjectId`, `SessionId`, `MemoryEntryId`). 22 tests pass (3 files: 4 risk-level + 4 agent-id + 14 ids). `pnpm verify` green from clean checkout. Worktree removed, `feat/shared-package` deleted (local + remote). Next package: `@megasaver/core` (own spec).

## [2026-05-04] ingest | core package spec

Wrote `docs/superpowers/specs/2026-05-04-core-package-design.md` and seeded `wiki/entities/core.md`. Locked the first `@megasaver/core` slice as foundation-only: neutral `Project`, `Session`, and `MemoryEntry` schemas plus typed registry errors and `createInMemoryCoreRegistry()`. Storage is in-memory only; filesystem persistence, memory search, token audit, context packing, and compression remain deferred to their own specs. Risk HIGH.

## [2026-05-04] ingest | core package plan

Wrote `docs/superpowers/plans/2026-05-04-core-package-plan.md` and updated `wiki/entities/core.md` to `plan-written`. Plan breaks implementation into strict TDD tasks: scaffold, typed registry errors, `Project`, `Session`, `MemoryEntry`, project/session/memory registry behavior, changeset/wiki evidence, final verification, and external review. No production implementation has started.

## [2026-05-04] schema | core package implemented

Implemented the first `@megasaver/core` slice in `feat/core-package`: package scaffold, typed registry errors, `Project`, `Session`, and `MemoryEntry` schemas, and the deterministic in-memory registry. Added initial changeset `.changeset/core-package-init.md`. Evidence before review: `pnpm --filter @megasaver/core test` passes 5 files / 50 tests, `pnpm --filter @megasaver/core typecheck` passes, `pnpm --filter @megasaver/core build` passes, and `pnpm verify` passes.

## [2026-05-04] schema | core review fixes

Addressed first external review findings for `@megasaver/core`: entity schemas now reject unknown public fields via strict Zod objects, core typecheck now includes `tsconfig.test.json`, registry negative tests fail closed through a typed error helper, and copy tests cover `create*`, `get*`, and `list*` returned objects. Wiki index status updated to review-fix phase. Evidence after fixes: `pnpm --filter @megasaver/core test` passes 5 files / 53 tests and `pnpm --filter @megasaver/core typecheck` passes.

## [2026-05-04] schema | core review passed

External review gate passed for `@megasaver/core` after fixes. Code-reviewer re-check found no Critical, Important, or Minor issues and reported ready to merge. Critic re-check found no Critical, Important, or Minor issues and reported ready to merge, with normal HIGH-risk requirement satisfied by the recorded external reviewer pass.

## [2026-05-04] schema | core package pushed to main

Fast-forward merged `feat/core-package` into `main`, verified the merged result, removed the temporary worktree and local feature branch, and pushed `main` to <https://github.com/haJ1t/MegaSaver>. `@megasaver/core` is now part of `origin/main`.

## [2026-05-05] ingest | cli scaffold spec

Wrote `docs/superpowers/specs/2026-05-05-cli-package-design.md`. Locked v0.1 surface for `apps/cli`: bin `mega`, three top-level surfaces (`--version`, `--help`, `mega doctor`), stateless three-check `doctor`, plain text output, no `@megasaver/core` import in this slice. Risk MEDIUM.

## [2026-05-05] ingest | cli scaffold plan

Wrote `docs/superpowers/plans/2026-05-05-cli-package-plan.md`. Plan breaks implementation into strict TDD tasks: scaffold app + smoke build, `checkNode`, `checkPlatform` + `checkCwd`, `runChecks` + `renderReport` + `exitCodeFor`, `doctorCommand` handler, Citty wiring (`main.ts` + `cli.ts`), final verification, wiki seed, external review.

## [2026-05-05] schema | cli package implemented

Implemented the first `apps/cli` slice in `feat/cli-package`: app scaffold (commits `2055cd2`–`8afe857`), `Check` type + 3 pure check fns (`checkNode`, `checkPlatform`, `checkCwd`) + 3 helpers (`runChecks`, `renderReport`, `exitCodeFor`) + `doctorCommand` Citty handler, `main.ts` registers `doctor` subcommand. Evidence before review: `pnpm --filter @megasaver/cli test` passes 1 file / 17 tests, `pnpm --filter @megasaver/cli typecheck` passes, `pnpm --filter @megasaver/cli build` emits `dist/cli.js` (shebang line 1) + sourcemap, `pnpm verify` green across all 3 packages, `node apps/cli/dist/cli.js doctor` prints `3 PASS / 0 FAIL` with exit 0.

## [2026-05-05] ingest | entities/cli seeded

Wrote `wiki/entities/cli.md` and updated `wiki/index.md` Entities section to include the CLI app. The CLI is the third v0.1 entity to publish. Status reservation list trimmed to `connectors-claude-code`, `connectors-generic-cli`, `mcp-bridge`, `app`, `skill-packs`. Documented the pnpm v9 workspace-bin caveat: dev invocation is `node apps/cli/dist/cli.js <cmd>` — `pnpm exec mega` does not resolve at root because nothing depends on the CLI package.

## [2026-05-05] schema | cli review passed

External review gate passed for `apps/cli` (MEDIUM risk). Final whole-branch `code-reviewer` pass found no Critical or Important issues; two Minor (TS-strict `?? ""` fallback rationale, `as never` cast in handler test) and one Low (spec §12.6 `pnpm exec mega` symptom of pnpm v9 workspace-bin design — bin field itself correct, dev invocation documented in entity). Verifier agent APPROVED — `pnpm verify` green (92 tests across 3 packages, lint + typecheck clean), build artifacts correct (shebang line 1, executable bit, sourcemap, no `.d.ts`), all three spec §6 surfaces verified live, no convention files touched, `private: true` confirms no changeset needed.

## [2026-05-05] schema | cli scaffold pushed to main

Fast-forward merged `feat/cli-package` into `main`, verified the merged result, removed the temporary worktree and local feature branch, and pushed `main` to <https://github.com/haJ1t/MegaSaver>. `@megasaver/cli` is now part of `origin/main`.

## [2026-05-05] ingest | core persistence spec

Wrote `docs/superpowers/specs/2026-05-05-core-persistence-design.md`. Locked v0.1 durable storage as a JSON directory store with caller-provided `rootDir`, `projects.json`, `sessions.json`, project memory JSONL files, temp-file plus rename writes, typed persistence errors, and no CLI defaults, migrations, file locks, updates, deletes, search, compression, or connector behavior. Risk HIGH.

## [2026-05-05] ingest | core persistence plan

Wrote `docs/superpowers/plans/2026-05-05-core-persistence-plan.md`. Plan breaks implementation into TDD tasks for typed persistence errors, JSON directory store helpers, `createJsonDirectoryCoreRegistry`, corrupt-store hardening, changeset/build smoke evidence, wiki evidence, full verification, and separate code-reviewer plus critic passes.

## [2026-05-05] schema | core persistence plan adjusted

Adjusted the core persistence plan before Task 3 execution to keep tests within the repo's 300 LOC file convention. Corrupt-store tests now land in `packages/core/test/json-directory-registry-corrupt.test.ts` instead of appending to the already-large happy-path registry test file.

## [2026-05-05] schema | core persistence implemented

Implemented JSON directory persistence for `@megasaver/core` in `feat/core-persistence`: caller-provided `rootDir`, `projects.json`, `sessions.json`, project memory JSONL files, temp-file plus rename writes, typed persistence errors, and package export. Evidence before review: `pnpm --filter @megasaver/core test`, `pnpm --filter @megasaver/core typecheck`, `pnpm --filter @megasaver/core build`, and a public export smoke command pass.

## [2026-05-05] schema | core persistence review passed

External review gate passed for `@megasaver/core` JSON directory persistence after review fixes. Production code-reviewer re-check found no Critical, Important, or Minor issues and reported ready to merge. Adversarial critic re-check found no Critical, Important, or Minor issues and reported ready to merge. Fresh evidence before recording: `pnpm verify` passed, `pnpm --filter @megasaver/core test` passed 9 files / 85 tests, public export smoke printed `0`, and `.tmp-core-smoke` was removed.

## [2026-05-05] schema | core persistence pushed to main

PR <https://github.com/haJ1t/MegaSaver/pull/4> merged into `main` (merge commit `0656114`). `@megasaver/core` v0.1 JSON directory persistence is now part of `origin/main`: typed persistence errors, `createJsonDirectoryCoreRegistry`, `projects.json` + `sessions.json` + project memory JSONL layout, temp-file plus rename writes. First package merged via GitHub PR (prior packages used local fast-forward). Local `main` synced via `git pull --ff-only`. Worktree at `.worktrees/core-persistence` and local `feat/core-persistence` branch still present — pending cleanup.

## [2026-05-06] ingest | cli project crud spec

Wrote `docs/superpowers/specs/2026-05-06-cli-project-crud-design.md`. Locked v0.1 first user-facing CRUD: `mega project create <name>` and `mega project list`, XDG-default store at `$XDG_DATA_HOME/megasaver` (fallback `~/.local/share/megasaver`), root `--store` override, auto-init on first use with one-line stderr notice, plain `<id>  <name>` output, duplicate-name reject, every typed core error mapped to exit 1. Layout aligned with existing `commands/doctor.ts` pattern (single file per command + helpers + handlers, flat tests). Risk HIGH.

## [2026-05-06] ingest | cli project crud plan

Wrote `docs/superpowers/plans/2026-05-06-cli-project-crud-plan.md`. Plan breaks implementation into TDD tasks: core `initStore` helper + changeset, CLI `errors.ts`, CLI `store.ts` (`resolveStorePath` + `ensureStoreReady`), `commands/project.ts` (format → list → create → parent), `main.ts` wire-up, full verification with smoke evidence, and wiki ingest. Each task ends with a green per-package verify and a Conventional Commit.

## [2026-05-06] schema | cli project crud implemented

Implemented `mega project create` and `mega project list` in `feat/cli-project-crud`: new `@megasaver/core` export `initStore` (idempotent layout — creates `rootDir`, `projects.json`, `sessions.json` without overwriting), new CLI files `errors.ts`, `store.ts`, `commands/project.ts`, and `main.ts` wires the `project` parent. Project schema is 5-field (`id`, `name`, `rootPath`, `createdAt`, `updatedAt`); CLI sets `rootPath = process.cwd()` at create time and stamps `createdAt`/`updatedAt` to `new Date().toISOString()`. Evidence before review: `pnpm --filter @megasaver/core test` passed (89 tests across 10 files), `pnpm --filter @megasaver/cli test` passed (47 tests across 4 files), `pnpm verify` green (6/6 turbo tasks), and a build smoke against a temp store directory printed empty list (with init notice on stderr) → `f24bff84-98cc-4c32-aa26-43c5516f86ae  demo` on `create` → the same line on the second `list` (no further notice). The temp directory was removed after evidence was captured.

## [2026-05-06] schema | cli project crud final review

Final pre-merge review for `feat/cli-project-crud`. `code-reviewer` and `critic` both returned changes-requested. C1 (`--store` placement) and C2 (control-character names) are addressed in commits `feat(cli): reject control chars in project name` and `docs(spec): align --store flag wording with impl`. Tracked as follow-up (separate specs/issues): M1 duplicate-name TOCTOU (concurrent-write race; structural, low real-world reachability at v0.1 single-dev scale), M2 failure-mode tests (ENOSPC, EACCES, dir-shaped `projects.json`, corrupt-entity rows), M3 unused `newId`/`now` test injection points on `RunProjectCreateInput` (delete or test), M4 unicode normalization spec gap (NFC vs NFD policy). Re-run of `code-reviewer` + `critic` on the corrected branch is required before merge.

## [2026-05-06] schema | cli project crud review passed

External review gate passed for `feat/cli-project-crud` (HIGH risk, 20 commits). First review-pair returned changes-requested with two Important findings (C1 `--store` placement spec/impl drift; C2 control-character names breaking the line-oriented output protocol). C2 fix shipped as `feat(cli): reject control chars in project name` (commit `5c82c45`); C1 doc-amendment as `docs(spec): align --store flag wording with impl` (commit `1c5236c`). Second review pair flagged C2′ — regex covered C0+DEL only, missed C1 — fixed in `fix(cli): reject C1 control chars and unify msg` (commit `3e33755`) which widened the regex to `/^[^\x00-\x1f\x7f-\x9f]+$/` and unified the error message via `NAME_CONTROL_CHARS_MESSAGE` constant. Final third review pair (`code-reviewer` on `3e33755`, `critic` on full HEAD `3e33755`) both Approved with no Critical/Important. Tracked follow-ups: M1 duplicate-name TOCTOU, M2 failure-mode tests (ENOSPC/EACCES/dir-shaped projects.json/corrupt entity), M3 unused `newId`/`now` test injection, M4 unicode normalization policy. Pre-merge evidence: `pnpm verify` green (6/6 turbo tasks), 162 tests pass (22 shared + 89 core + 51 cli), build smoke against temp store directory printed empty list → `<uuid>  demo` → same `<uuid>  demo` line; NEL/LF/TAB/DEL inputs all rejected with `error: name must not contain control characters` exit 1.

## [2026-05-06] schema | cli project crud pushed to main

PR <https://github.com/haJ1t/MegaSaver/pull/5> merged into `main` (merge commit `9003968`). `feat/cli-project-crud` is now part of `origin/main`: new `@megasaver/core` export `initStore` (idempotent layout creation, with changeset for minor bump), new CLI files `errors.ts`, `store.ts`, `commands/project.ts` (parent + create + list), `main.ts` registers the `project` parent, root `--store` per-subcommand override, XDG-default store at `$XDG_DATA_HOME/megasaver` (fallback `~/.local/share/megasaver`), first-run init notice on stderr, control-char rejection (C0+DEL+C1), duplicate-name reject. Local `main` synced via `git pull --ff-only`; worktree `.worktrees/cli-project-crud` removed; local + remote `feat/cli-project-crud` branch deleted. Tracked follow-ups for next slice: M1 duplicate-name TOCTOU, M2 failure-mode tests, M3 `newId`/`now` test injection, M4 unicode normalization policy.

## [2026-05-06] schema | wiki upgraded for token-discipline

User flagged the wiki was acting as info-pointer (referring to spec/plan) rather than info-carrier — agents kept re-reading raw `packages/core/src/*.ts`, full plan files, and existing handler implementations to rediscover schemas, error codes, and test patterns. Concrete failure observed in `feat/cli-project-crud`: planner assumed `Project` had 2 fields (id, name) when actual schema has 5 (id, name, rootPath, createdAt, updatedAt) → caused `Pick<>` deviation in Task 6 and a Task 8 plan correction. Three wiki upgrades shipped on `main` (no spec/plan needed — wiki/governance only): rewrote `wiki/entities/core.md` to enumerate concrete `Project`/`Session`/`MemoryEntry` field lists, full registry interface, and both error class code unions; new `wiki/workflows/cli-test-pattern.md` crystallizing the Citty handler + vi.spyOn(console) + `cmd.run({...} as never)` pattern plus the TS `noPropertyAccessFromIndexSignature` ↔ Biome `useLiteralKeys` conflict resolution; new `wiki/concepts/wiki-first-token-discipline.md` recording the user directive (2026-05-03 + 2026-05-06) with explicit question→page mapping and anti-patterns. `wiki/index.md` Concepts/Workflows sections + Quick-links table updated to reference the new pages.

## [2026-05-06] ingest | claude-code connector spec

Wrote `docs/superpowers/specs/2026-05-06-claude-code-connector-design.md` on `codex/connectors-claude-code`. Locked the first connector package as `@megasaver/connector-claude-code` at `packages/connectors/claude-code`: a HIGH-risk root `CLAUDE.md` adapter that manages one Mega Saver block bounded by HTML comment sentinels, validates caller-selected core `Project`/`Session`/`MemoryEntry` context, preserves human-authored content outside the block, and exposes pure parse/render/upsert/remove helpers plus narrow filesystem helpers. Seeded `wiki/entities/connectors-claude-code.md` as an info-carrier with public API names, block format, validation rules, error codes, and out-of-scope boundaries.

## [2026-05-06] ingest | claude-code connector plan

Wrote `docs/superpowers/plans/2026-05-06-claude-code-connector-plan.md` on `codex/connectors-claude-code`. The plan decomposes implementation into strict TDD tasks: package scaffold, typed connector errors, context schema, markdown render/parser/upsert/remove helpers, filesystem sync helpers, changeset/smoke verification, wiki evidence, and two-pass external review.

## [2026-05-07] schema | claude-code connector implemented

Implemented `@megasaver/connector-claude-code` on `codex/connectors-claude-code`: package scaffold, typed connector errors with Zod code schema, strict `ClaudeCodeContextSchema`, deterministic root `CLAUDE.md` managed-block renderer/parser/upsert/remove helpers, and filesystem helpers for reading/writing/syncing only root `CLAUDE.md`. Review fixes included lockfile importer, test-file typecheck inclusion, public-surface narrowing, memory entry IDs in bullets, exact render blank lines, spacing normalization around replaced blocks, preservation of human Markdown whitespace, hidden input types, and read-path TOCTOU removal. Evidence before final review: connector test/typecheck/build passed, `pnpm verify` passed across 4 packages with 205 total tests, and built-package smoke printed `true` / `true` for context sync and file write verification.

## [2026-05-07] schema | claude-code connector review passed

External review gate passed for `codex/connectors-claude-code` at commit `d447622`. Production reviewer approved after connector typecheck, build, test, and lint evidence. Critic reviewer approved after checking named public exports, built-package smoke coverage, generated declaration output, parser/updater/filesystem boundaries, and full `pnpm verify`. Final connector surface uses named exports only and hides internal input/options types. Evidence at review pass: connector suite passed 44 tests, full `pnpm verify` passed across 4 packages with 206 total tests, and built-package smoke printed `true` / `true`. Accepted v0.1 residual risks: no optimistic concurrency on `CLAUDE.md` writes, no file mode/xattr preservation guarantees, and no `.claude/CLAUDE.md` support.
