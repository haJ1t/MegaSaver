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

## [2026-05-07] schema | claude-code connector PR opened

Pushed `codex/connectors-claude-code` to `origin` and opened draft PR <https://github.com/haJ1t/MegaSaver/pull/6> targeting `main`. Worktree preserved for PR iteration. Connector is not merged yet.

## [2026-05-07] schema | claude-code connector merged

PR <https://github.com/haJ1t/MegaSaver/pull/6> merged into `main` on 2026-05-07. `@megasaver/connector-claude-code` is now part of `origin/main`: root `CLAUDE.md` managed block, context validation, markdown render/parse/upsert/remove helpers, filesystem read/write/sync helpers, changeset, and wiki entity coverage. Residual v0.1 risks remain unchanged: no optimistic concurrency on `CLAUDE.md` writes, no file mode/xattr preservation guarantees, and no `.claude/CLAUDE.md` support.

## [2026-05-07] docs | readme refreshed

Updated `README.md` on `codex/connectors-claude-code` to describe the current Mega Saver state: product mission, current packages, implemented bootstrap/shared/core/CLI/Claude connector slices, local development commands, wiki-first process, and not-yet-built v0.1 follow-ups. This is documentation-only and keeps the PR branch self-describing before merge review.

## [2026-05-07] docs | readme refresh PR opened

Rebased the README refresh onto current `origin/main`, cherry-picked it to `codex/readme-current-state`, pushed the branch, and opened draft PR <https://github.com/haJ1t/MegaSaver/pull/7>. Fresh evidence before PR: `pnpm verify` passed with lint clean, typecheck 4/4 packages, and test 8/8 turbo tasks.

## [2026-05-07] schema | generic-cli connector implemented

Implemented `@megasaver/connectors-shared` (block render/parse/upsert/remove + ConnectorContext schema + filesystem helpers) and `@megasaver/connector-generic-cli` (manifest-driven connector with `codexTarget` writing `AGENTS.md`). Refactored `@megasaver/connector-claude-code` to consume the shared helpers; render output byte-identical (regression fixture asserts). `AgentId` enum extended with `"codex"`. Plan executed via subagent-driven development across 28 tasks on `feat/generic-cli-connector`. Evidence before PR: `pnpm verify` green across 6 packages (12/12 turbo tasks), 45 claude-code tests, 21 generic-cli tests, plus shared/core/cli/connectors-shared suites. Tracked follow-ups for next slice: M1 unicode normalization, M2 advisory locking, M5 `mega connector sync` CLI spec, and Cursor/Aider target additions (R2/R3 in spec).

## [2026-05-07] schema | generic-cli connector merged

PR <https://github.com/haJ1t/MegaSaver/pull/8> merged into `main` (merge commit `8679c4c`). `@megasaver/connectors-shared`, `@megasaver/connector-generic-cli`, the refactored `@megasaver/connector-claude-code`, and the `AgentId` `"codex"` extension are all on `origin/main`. Two-stage external review (`code-reviewer` opus + `critic` opus) returned no Critical issues. Critic flagged one merge-blocker (changeset semver wrong because `agentId` field became required on `ClaudeCodeContextSchema`) — fixed in `18bcacf` by bumping `connector-claude-code` changeset from `patch` to `minor` with a BREAKING note. Worktree `.worktrees/generic-cli-connector` removed; local + remote `feat/generic-cli-connector` branch deleted. Tracked follow-ups F1–F10 captured for the next slice.

## [2026-05-08] schema | connector follow-ups + core M1/M2 merged

PR <https://github.com/haJ1t/MegaSaver/pull/9> merged into `main` (merge commit `0dc2e29`) on `feat/connector-followups`. Twelve fixes shipped together: F1 spec return-type alignment (`Promise<void>` → `Promise<string>` for `syncTargetBlock`/`syncGenericCliTarget`), F5 spec wording for manifest extensibility honesty, F4 dropped dead `_existingBlock` parameter, F2 dropped unused `target_unknown` error code, F6 `writeTargetFile` symlink lstat guard (refuse to replace symlinks), F7 `writeTargetFile` file-mode preservation, F8 `parseBlock` `block_conflict` error message now includes 1-indexed line numbers per offending sentinel, F9 `upsertBlock`/`removeBlock` preserve dominant EOL (CRLF/LF), F10 `containsSentinel` strips zero-width / bidi / BOM and NFKC-normalises before substring check (block Unicode lookalikes), F3 `assertProjectRoot` hoisted from claude-code + generic-cli into `connectors-shared` (DRY; per-connector wrappers preserve their error code mapping). Plus M2 added 5 failure-mode integration tests for `createJsonDirectoryCoreRegistry` (dir-shaped projects.json, invalid JSON, malformed entity, EACCES read, EACCES write — last two skip on root). Plus M1 added a sync `.projects.lock` file lock around create-style mutations (`createProject`/`createSession`/`createMemoryEntry`) using `openSync(... "wx")` + `Atomics.wait` 50ms backoff with 5s acquire timeout — closes the duplicate-name TOCTOU race. Registry interface stays sync. Test counts on `main`: core 96 (was 89), connectors-shared 56 (was 41), claude-code 45 (unchanged), generic-cli 21 (unchanged). Worktree `.worktrees/connector-followups` removed; local + remote `feat/connector-followups` branch deleted. New tracked follow-up: M3 stale-lock detection (PID-in-lock-file) for the M1 lock — accepted residual at v0.1 single-developer scale.

## [2026-05-08] schema | core M3 stale-lock + M4 NFC normalization implemented

Shipped on `feat/core-hardening-m3-m4`: M3 PID-in-`.projects.lock` plus `process.kill(pid, 0)` stale-holder detection (crashed-process recovery now <100ms instead of 5s timeout — smoke evidence: stale PID 99999999 recovers in 3ms), and M4 NFC normalization via Zod `.transform()` on `Project.name` and `Session.title` (NFD inputs round-trip to NFC post-parse; smoke evidence: NFD `café` parses to NFC `café`, length 4). `isLockHolderAlive` private helper (read lockfile → parse PID → `kill(0)` → ESRCH = stale, EPERM = conservative alive). Lazy NFD-to-NFC migration: existing on-disk NFD entries return NFC on read; subsequent writes persist NFC. Registry interface stays sync. No new external deps. Tests: core 96 → 106 (+3 lock recovery + 5 schema NFC + 2 registry-level migration). `pnpm verify` green across 6 packages, 12/12 turbo tasks. Tracked follow-ups for next slice: cross-host (NFS) lock semantics with hostname check, eager NFD-to-NFC migration command (`mega project compact`), `MemoryEntry.content` and `Project.rootPath` normalization scope expansion.

## [2026-05-08] schema | cli session CRUD

PR <https://github.com/haJ1t/MegaSaver/pull/11> merged into `main` (merge commit `9c5a388`): four new `mega session` subcommands (`create`, `list`, `show`, `end`). Core gains `CoreRegistry.endSession(id, { endedAt })` and `session_already_ended` error code. CLI errors module widened with `ZodContext` discriminated union (6 variants), 6 new helper functions, `as const satisfies` drift guards on `AGENT_VALUES`/`RISK_VALUES` against `@megasaver/shared`. Race-fallback in `runSessionEnd` re-throws on three-way race (concurrent process ends + deletes between pre-check and `endSession`) rather than fabricating a timestamp. Tests: 10 new core (4 in-memory parity + 4 json-directory happy/missing/already-ended/lock-released + 2 lock concurrency), 32 new CLI (20 session: 9 create / 3 list / 4 show / 4 end; +12 errors module). Two-stage external review per task (subagent-driven development) plus final critic (HIGH-risk holistic) returned 0 Blocking, 2 Important deferred to v0.2, 5 Minor. Tracked follow-ups for v0.2: I1 `MEGA_TEST_*` env-var injection cleanup (refactor session tests to project-test pattern OR gate on `NODE_ENV === "test"`), I2 explicit `session_already_ended` mapper case for the rare three-way-race fall-through, I3 dead `kind: "session"` mapper branch (delete or use), I4 spec §4 amendment for title control-char guard (drift), I5 split `commands/session.ts` (511 LOC > §8 300 threshold) when `update` lands, cross-process lock integration test, `atomicWriteFile` + `fsync` durability.

## [2026-05-09] schema | core M3+M4 merged

PR <https://github.com/haJ1t/MegaSaver/pull/10> merged into `main` (merge commit `ac27142`). `@megasaver/core` now has stale-lock detection (PID-in-`.projects.lock` + `kill(0)` ESRCH check) and NFC normalization on `Project.name` + `Session.title`. CLI gained matching NFC transform on `nameSchema` (PR #10 reviewer fix I1) so duplicate-name UX stays polished for NFD inputs; `apps/cli` test count 51 → 52. Two-stage external review (`code-reviewer` opus + `critic` opus) returned no Critical issues; reviewer fixes applied in `a5834f8` (CLI NFC + spec drift) and `ab37d80` (spec §3 stale claim retracted). Local `main` synced via `git pull --ff-only`; worktree `.worktrees/core-hardening-m3-m4` removed; local + remote `feat/core-hardening-m3-m4` branch deleted. Tracked follow-ups for next slice: M-1 v0.2 atomic `writeFileSync(... { flag: "wx" })` to close PID-write race window, m-1 stricter PID regex (`/^[1-9]\d*$/`), cross-host lock semantics (NFS hostname check), eager NFD compact command (`mega project compact`), `MemoryEntry.content` / `Project.rootPath` normalization scope, concurrency stress test (process fork) for the lock primitive, stale-lock recovery log notice (ops observability).

## [2026-05-09] chore | session CRUD critic followups (I2+I3+I4) merged

PR <https://github.com/haJ1t/MegaSaver/pull/12> merged into `main` (merge commit `5b3923a`). Three of seven critic-flagged v0.2 follow-ups closed: I2 added explicit `session_already_ended` mapper case in `apps/cli/src/errors.ts` (id-only form `error: session "<id>" already ended` — outer-catch fall-through has no `endedAt` in scope; rich form stays for pre-check + race-fallback paths). I3 outer catches in `runSessionShow` and `runSessionEnd` now pass `{ kind: "session", id }`, activating the previously-dead `session_not_found` mapper branch and routing the new I2 case. I4 spec §4 `--title` bullet amended with the C0/C1+DEL control-character guard sentence (drift correction for commit `b09b907`). One new errors-module test asserts the I2 case. CLI test totals 84 → 85; core unchanged at 116; full suite 344 → 345. Code-reviewer pass returned APPROVE with one pre-existing LOW observation (no action). Worktree removed; branch deleted. Open v0.2 items now: I1 `MEGA_TEST_*` env-var gate, I5 file split at `update` time, cross-process lock test, `atomicWriteFile` + `fsync`.

## [2026-05-09] schema | mega connector sync

PR <https://github.com/haJ1t/MegaSaver/pull/14> merged into `main` (merge commit `204f922`): new `mega connector sync <projectName>`
CLI command. Wires `@megasaver/connectors-shared` primitives
(`readTargetFile`, `upsertBlock`, `renderBlock`, `writeTargetFile`,
`assertProjectRoot`) into a per-target loop with five status
words (`wrote`, `noop`, `created`, `skipped`, `error`). Two known
targets in v0.1: `claude-code` (`CLAUDE.md`) and `codex`
(`AGENTS.md`). `--target <id>` opts in to seed a missing file.
CLI errors module gained the `ConnectorError` mapping branch + the
`{ kind: "connector"; targetId; relativePath }` `ZodContext`
variant + the `invalidTargetMessage` helper with a matching
`KNOWN_TARGET_IDS` drift guard. Tests: 14 new CLI (4 pre-target
gates + 3 skipped/created + 5 wrote/noop/agent-selection + 2
best-effort failure), 7 new errors-module. Two-stage external
review per task (subagent-driven development) returned 0 Blocking.
Tracked follow-ups for v0.2: `mega project create --root <dir>`
to remove the smoke flow's manual `projects.json` edit, `mega
connector status` (read-only), per-project manifest, MemoryEntry
CLI integration to populate the now-empty memory list, JSON output
flag pass, Cursor + Aider targets.

## [2026-05-09] chore | gate test env-vars on NODE_ENV (I1) merged

PR <https://github.com/haJ1t/MegaSaver/pull/13> merged into `main` (merge commit `0facd09`). Closes critic finding I1: `MEGA_TEST_SESSION_ID` and `MEGA_TEST_NOW` reads in `sessionCreateCommand.run` and `sessionEndCommand.run` are now gated by a new `readTestEnv(name)` helper that returns `undefined` unless `process.env["NODE_ENV"] === "test"`. Vitest sets NODE_ENV=test automatically, so existing tests pass without modification (20 session tests + 65 others = 85 CLI total, unchanged). Smoke evidence: in a clean shell with `MEGA_TEST_SESSION_ID="aaaaaaaa-..."` exported but `NODE_ENV` unset, `mega session create` emits a real `randomUUID()` rather than the injected value — gate effective. `wiki/workflows/cli-test-pattern.md` extended with a "Deterministic test injection" section documenting the helper, the save/restore `beforeEach`/`afterEach` pattern, and when NOT to use env-var injection (inner `runX` should accept `newId`/`now` directly). Net diff: 19 lines removed (four noisy inline ternaries with biome-ignore), 14 lines added (helper + doc). Code-reviewer pass returned APPROVE with 0 issues. Worktree removed; branch deleted. Open v0.2 items now: I5 file split when `update` lands, cross-process lock integration test (forked process), `atomicWriteFile` + `fsync` durability.

## [2026-05-09] schema | mega connector status

- Spec: `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-mega-connector-status-plan.md`
- Branch: `feat/mega-connector-status` (deleted post-merge)
- Result: `mega connector status <projectName> [--target <id>]` —
  read-only per-target report. 13 new tests (CLI 106 → 119, total
  366 → 379). Status words: in-sync | drift | no-block | missing |
  error. PR <https://github.com/haJ1t/MegaSaver/pull/15> merged into
  `main` (merge commit `b1a81cc`). Critic verdict
  APPROVED_WITH_FOLLOWUPS, S1–S12 backlog recorded in
  `wiki/index.md` Status section.

## [2026-05-09] schema | connector status S1+S2 followups

- Spec: `docs/superpowers/specs/2026-05-09-connector-status-followups-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-connector-status-followups-plan.md`
- Branch: `feat/connector-status-followups` (deleted post-merge)
- Result: closes critic findings S1 + S2 + S12 against PR #15.
  S1 swaps `pickLatestOpenSession` from lexicographic compare to
  `Date.parse` numeric compare (one line, both call sites — sync
  and status — fixed). S2 hoists `sessionLabel` above the
  per-target try/catch in `runConnectorStatus` so the `error`
  line carries `session=<id|none>` matching the other four
  status words. S12 closed by decision (the duplicate
  `pickLatestOpenSession` call inside `buildConnectorContext` is
  kept deliberately). 2 new CLI tests (offset-vs-instant
  ranking + error-line carries open-session id, the latter from
  inline G4 fix), 2 existing tests flip wording. CLI 119 → 121,
  total 379 → 381. PR <https://github.com/haJ1t/MegaSaver/pull/16>
  merged into `main` (merge commit `eb21060`). Critic re-pass on
  PR #16 returned APPROVED_WITH_FOLLOWUPS; T2 closed inline,
  T1 / T3–T8 recorded in `wiki/index.md` Status section.

## [2026-05-09] schema | cursor connector target

- Spec: `docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-cursor-connector-target-plan.md`
- Branch: `feat/cursor-target` (deleted post-merge)
- Result: `cursor` is now a v0.1 connector target alongside
  `claude-code` and `codex`. `agentIdSchema` widens to 4 members.
  `@megasaver/connector-generic-cli` ships `cursorTarget` and an
  optional `ConnectorTarget.header` field. `apps/cli`'s
  `KNOWN_TARGET_IDS` and `KNOWN_TARGETS` register cursor; sync
  prepends `target.header` once on first seed. Side fix: `AGENT_VALUES`
  in `apps/cli/src/errors.ts` updated to include cursor so the
  invalid-agent error message lists all four. Critic re-pass on
  PR #17 returned APPROVED_WITH_FOLLOWUPS; U1 (session help text
  drift) closed inline with snapshot test that derives the
  expected agent list from `agentIdSchema.options` so the next
  enum widening is mechanically caught. 14 new tests (2 shared +
  5 generic-cli + 7 cli — the +7 includes the inline U1 snapshot).
  shared 22 → 24, generic-cli 21 → 26, cli 121 → 128, total
  381 → 395. PR <https://github.com/haJ1t/MegaSaver/pull/17>
  merged into `main` (merge commit `f2d7f63`). U2–U10 backlog
  recorded in `wiki/index.md` Status section.

## [2026-05-09] schema | mega session update + I5 split

- Spec: `docs/superpowers/specs/2026-05-09-mega-session-update-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-mega-session-update-plan.md`
- Branch: `feat/session-update` (deleted post-merge)
- Result: `mega session update <sessionId> [--title …] [--risk …]
  [--agent …]` for partial open-session mutation. `@megasaver/core`
  ships `sessionUpdatePatchSchema` and `CoreRegistry.updateSession`
  on both in-memory and JSON-directory implementations. CLI's
  `commands/session.ts` (511 LOC) split into `commands/session/`
  directory; closes v0.1 backlog item I5. Final code-review pass
  identified IMPORTANT-1 (UX asymmetry between create/update for
  --risk/--agent error format) and V5 (--title control-char/newline
  guard bypass on update); both fixed inline pre-merge by parsing
  agentIdSchema/riskLevelSchema/titleSchema at the CLI boundary
  (mirrors create.ts pattern, drops `as never` casts) and
  extracting titleSchema into commands/session/shared.ts. 26 new
  tests (12 core + 14 cli — the +14 includes the inline V5
  newline-rejection test). core 116 → 128, cli 128 → 142, total
  395 → 421. PR <https://github.com/haJ1t/MegaSaver/pull/18>
  merged into `main` (merge commit `04987a8`). Critic verdict
  APPROVED_WITH_FOLLOWUPS, V1–V4 + V6–V9 backlog recorded in
  `wiki/index.md` Status section.

## [2026-05-09] schema | MemoryEntry CLI

- Spec: `docs/superpowers/specs/2026-05-09-memory-entry-cli-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-memory-entry-cli-plan.md`
- Branch: `feat/memory-cli` (deleted post-merge)
- Result: `mega memory create/list/show` lands as a thin CLI layer
  over the existing CoreRegistry surface. Append-only ledger; no
  delete/update. `--content` control-char guard at the CLI
  boundary; cross-field scope/session guard. Connector context
  wiring (sync/status reading real `listMemoryEntries`) deferred
  to a separate slot. Critic re-pass returned APPROVED_WITH_FOLLOWUPS
  with 3 IMPORTANT findings closed inline (`b186679`): I1
  `readTestEnv` deduplicated to canonical session/shared.ts copy;
  I2 `projectNameSchema` hoisted to `commands/shared/schemas.ts`
  (5 sites consolidated) + cross-command consistency test; I3
  `session_project_mismatch` mapper branch + cross-project create
  test. 27 new tests (19 memory + 5 errors + 3 critic-fix).
  cli 142 → 169, total 421 → 448. PR
  <https://github.com/haJ1t/MegaSaver/pull/19> merged into `main`
  (merge commit `7a199b6`). W4–W11 backlog recorded in
  `wiki/index.md` Status section.

## [2026-05-09] schema | connector memoryEntries wiring

- Spec: `docs/superpowers/specs/2026-05-09-connector-memory-wiring-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-connector-memory-wiring-plan.md`
- Branch: `feat/connector-memory-wiring` (deleted post-merge)
- Result: `mega connector sync` / `status` flow real memory
  entries through `buildConnectorContext`, filtered to
  "project-scoped + current-session-scoped" per target.
  Production change is one new helper + one signature widen + 2
  call site updates. 7 new tests (5 sync + 2 status) lock the
  filter contract end-to-end. Spec drift in
  `2026-05-09-mega-connector-sync-design.md` ("memory entries
  empty in v0.1") corrected. Closes critic backlog W11. Critic
  re-pass returned APPROVED_WITH_FOLLOWUPS with X1 (incomplete
  spec drift fix — 3 stale references in same file) + X2
  (`assertConnectorContext` re-validation §13 anti-pattern) both
  closed inline (`65cbd12`). cli 169 → 176, total 448 → 455.
  PR <https://github.com/haJ1t/MegaSaver/pull/20> merged into
  `main` (merge commit `b0e4382`). X4–X6 backlog recorded in
  `wiki/index.md` Status section.

## [2026-05-09] schema | aider connector target

- Spec: `docs/superpowers/specs/2026-05-09-aider-connector-target-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-aider-connector-target-plan.md`
- Branch: `feat/aider-target` (deleted post-merge)
- Result: 4th built-in connector target lands. `aider` writes
  to `CONVENTIONS.md` (plain markdown, no frontmatter — user
  wires `aider --read CONVENTIONS.md` themselves; auto-load
  via `.aider.conf.yml` is YAGNI per spec §2). Closes the
  v0.1 connector matrix promised in `CLAUDE.md §1`: claude-code
  + codex + cursor + aider all have working `mega connector
  sync --target <id>` and `mega session create --agent <id>`.
  `agentIdSchema` widens 4 → 5 members (alphabetic-first
  insert: aider, claude-code, codex, cursor, generic-cli);
  `aiderTarget` joins `builtinTargets` in launch order; CLI
  `KNOWN_TARGETS` and `KNOWN_TARGET_IDS` append `aider`. The
  cursor pattern was the line-for-line precedent — the new
  wrinkle is `header` field absent (plain markdown), proving
  the bare-target case of the `ConnectorTarget` interface.
  Critic re-pass found CRITICAL Y1: `AGENT_VALUES` in
  `apps/cli/src/errors.ts` was silently stale because
  `as const satisfies readonly AgentId[]` permits a narrower
  type than its target — the supposed tripwire failed open
  when `agentIdSchema` widened, leaving `mega session create
  --agent <typo>` to print `expected: claude-code | codex |
  cursor | generic-cli` (omitting aider). Tests at
  `errors.test.ts:175` and `session.test.ts:138` actively
  asserted the buggy 4-member string. Y1 closed inline in
  `585554f` (added `aider` to AGENT_VALUES alphabetic-first +
  honest comment + 2 test assertions updated). MAJOR Y2:
  parallel `apps/cli/src/commands/session/update.ts:134`
  `--agent` description still listed 4 agents; existing
  drift-guard test only covered `sessionCreateCommand`. Y2
  closed inline in `dbad49e` (description updated +
  drift-guard test extended to `sessionUpdateCommand`).
  Bonus stale-snapshot fix during Task 6 verify (`947ee8c`)
  caught a parallel `errors.test.ts:262` snapshot still
  pinned to 3-target `KNOWN_TARGET_IDS`. cli 176 → 183,
  total 455 → ~466. PR
  <https://github.com/haJ1t/MegaSaver/pull/21> merged into
  `main` (merge commit `184b13d`). Open Y-series backlog
  (Y3–Y7) recorded in `wiki/index.md` Status section: docs
  enumeration drift (CLAUDE.md/AGENTS.md/.cursor still list
  3 agent files), public-export aider assertion gap, noop +
  stale-block-replace coverage holes, repo-wide closed-enum
  drift-guard pattern refactor (the recurring cursor + aider
  fix-up cycle is the proof point), launch-order vs
  alphabetic ordering convention undocumented.

## [2026-05-09] schema | closed-enum tripwire refactor

- Spec: `docs/superpowers/specs/2026-05-09-closed-enum-tripwire-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-closed-enum-tripwire-plan.md`
- Branch: `feat/closed-enum-tripwire` (deleted post-merge)
- Result: Eliminates the `as const satisfies readonly T[]`
  tripwire pattern that produced two CRITICAL fix-ups in cursor
  PR #17 + aider PR #21 (the supposed tripwire failed open
  because `satisfies` permits a subset). 4 sites in
  `apps/cli/src/errors.ts` (`AGENT_VALUES`, `RISK_VALUES`,
  `KNOWN_SCOPE_IDS`, local `KNOWN_TARGET_IDS`) replaced with
  schema-derived sources: `agentIdSchema.options` /
  `riskLevelSchema.options` from `@megasaver/shared`,
  `memoryScopeSchema.options` from `@megasaver/core`,
  `KNOWN_TARGET_IDS` from a new `apps/cli/src/known-targets.ts`
  canonical registry (`KNOWN_TARGETS.map((t) => t.id)`). New
  file owns `CLAUDE_CODE_TARGET`, `KNOWN_TARGETS`,
  `KnownTargetId` literal union, `isKnownTargetId` helper.
  Duplicated `KNOWN_TARGET_IDS` in `apps/cli/src/commands/connector.ts`
  collapses to a single import. Individual `codexTarget`/
  `cursorTarget`/`aiderTarget` `: ConnectorTarget` annotations
  dropped (`packages/connectors/generic-cli/src/targets.ts`)
  so the tuple element types stay literal — empirically verified
  via `@ts-expect-error` probe that `KnownTargetId` resolves to
  `"claude-code" | "codex" | "cursor" | "aider"`. Drift impossible
  by construction (KNOWN_TARGET_IDS = KNOWN_TARGETS.map(...);
  consumer = schema.options). Behavior byte-identical: all 4
  smoke strings (`invalidAgentMessage` / `invalidRiskMessage` /
  `invalidScopeMessage` / `invalidTargetMessage`) match
  pre-refactor output verbatim. Mid-execution regression
  `43205c8` removed `as const` from `CLAUDE_CODE_TARGET` to
  satisfy `exactOptionalPropertyTypes`, silently widening
  `KnownTargetId` to `string` (vitest's `expectTypeOf` is
  runtime no-op without `vitest typecheck` mode); recovered in
  `79eb9d8` (revert + `Object.hasOwn(target, "header")` test
  pattern that doesn't require `.header` access on narrow
  types). Critic re-pass returned ACCEPT-WITH-RESERVATIONS.
  IMPORTANT-2 (loop-cast at `connector.ts:128` papering over
  type discrimination) + IMPORTANT-3 (expectTypeOf
  enforcement-channel clarification comment) closed inline
  (`67b6515`). cli 183 → 191, total 466 → 474 (+8 net: 5
  known-targets + 3 errors drift-guards). PR
  <https://github.com/haJ1t/MegaSaver/pull/22> merged into
  `main` (merge commit `489f7d0`). Z1–Z4 backlog recorded in
  `wiki/index.md` Status section. **Z1** is FIRST-CRITICAL:
  citty `description` strings in 3 files (`session/create.ts`,
  `session/update.ts`, `memory/create.ts`) still hand-mirror
  the same enum lists with "Keep in sync" comments — the bug
  class survives on the help-text surface and the next agent
  widening will recreate it.

## [2026-05-09] schema | citty description derive (Z1)

- Spec: `docs/superpowers/specs/2026-05-09-citty-description-derive-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-citty-description-derive-plan.md`
- Branch: `feat/citty-description-derive` (deleted post-merge)
- Result: Closes PR #22's bug class on the help-text surface.
  5 citty `description` strings in
  `apps/cli/src/commands/session/{create,update}.ts` and
  `apps/cli/src/commands/memory/create.ts` now derive from
  their source schemas (`agentIdSchema.options`,
  `riskLevelSchema.options`, `memoryScopeSchema.options`) via
  module-load template interpolation. All 5 "Keep in sync
  with X in Y" comments removed — derivation is its own
  documentation. After this slot, adding a member to any of
  the 3 schemas auto-updates BOTH the error messages (PR #22)
  AND the `--help` text (this slot). Recurrence-prevention
  promise structurally delivered for both surfaces. Critic
  re-pass returned ACCEPT-WITH-RESERVATIONS with two findings
  closed inline in `1cfb2d9`: CRITICAL #1 — PR body's
  "byte-identical" claim was false for the 2 `--agent`
  strings (member order shifted from brand-prominent
  `claude-code | codex | cursor | aider | generic-cli` to
  schema-canonical alphabetic `aider | claude-code | codex |
  cursor | generic-cli`, matching the convention PR #22
  established for `errors.ts`); PR body edited to honestly
  disclose. MAJOR AA1 — all 5 drift-guards (3 added by Z1 + 2
  inherited from Y1+Y2) used `toContain` loop pattern, which
  was tautological after the refactor and didn't catch
  format drift; replaced with `toBe` pinned-format
  assertions that catch both member drift AND format drift.
  cli 191 → 194, total 474 → 477 (+3 net drift-guards). PR
  <https://github.com/haJ1t/MegaSaver/pull/23> merged into
  `main` (merge commit `4722a3a`). Open AA-series backlog
  recorded in `wiki/index.md` Status section: AA2 derive
  `connector --target` description from `KNOWN_TARGET_IDS`;
  AA3 document schema member-ordering convention; AA4
  promote Z4 wiki documentation to higher priority.

## [2026-05-10] schema | second-day team batch (7 PRs)

- Same `megasaver-v02-parallel` team, second batch of work
  assigned after first batch's 3 PRs landed. Each teammate
  received a new slot brief via SendMessage; team-lead
  coordinated Q1 brainstorm answers in parallel; PRs landed
  sequentially with critic adversarial review.
- 7 PRs merged in this batch (chronological by merge):
  - **PR #27** (`7ba650b`) AA4 wiki schema-derived surfaces
  - **PR #28** (`e8cd129`) project test gap fixes
  - **PR #29** (`07aedfa`) Y5 aider sync coverage
  - **PR #30** (`68971ae`) `--json` for project commands
  - **PR #31** (`e7207ff`) `--json` for memory list/show
  - **PR #32** (`9711675`) `--json` for connector status
  - **PR #33** (`debfa93`) AA3 schema ordering convention
- Pattern proven: 4-teammate parallel team can sustain
  multiple sequential slot batches. Mid-batch reassignment
  via SendMessage works cleanly. Each PR went through full
  spec → plan → execute → critic → merge cycle.

## [2026-05-10] schema | AA4 wiki schema-derived surfaces (PR #27)

- Spec: `docs/superpowers/specs/2026-05-10-aa4-wiki-cli-surfaces-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-aa4-wiki-cli-surfaces-plan.md`
- Branch: `feat/aa4-wiki-cli-surfaces` (deleted post-merge)
- Result: `wiki/entities/cli.md` gains a new "Closed-set
  surface derivation" section mapping 4 closed-sets
  (`agentIdSchema`, `riskLevelSchema`, `memoryScopeSchema`,
  `KNOWN_TARGETS` registry) to their derived CLI surfaces
  with PR references (#22 errors.ts, #23 citty descriptions,
  #25 AA2 connector --target). Documents the two-layer
  drift-guard test pattern: `toBe` for description surfaces
  (PR #23 + #25), `toContain` for error-message surfaces
  (PR #22). Critic re-pass returned ACCEPT-WITH-RESERVATIONS.
  CRITICAL #1 closed inline (`c395ac6`):
  `memoryScopeSchema` source attribution corrected from
  `@megasaver/shared` to `@megasaver/core` in both wiki and
  spec. MAJOR #2 (`toBe` overgeneralization) + MAJOR #3
  (KNOWN_TARGETS row source/surface conflation) also closed
  inline. PR
  <https://github.com/haJ1t/MegaSaver/pull/27> merged into
  `main` (merge commit `7ba650b`).

## [2026-05-10] schema | project test gap fixes (PR #28)

- Spec: `docs/superpowers/specs/2026-05-10-project-root-test-gaps-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-project-root-test-gaps-plan.md`
- Branch: `feat/project-root-test-gaps` (deleted post-merge)
- Result: Closes 3 OBSERVATION-grade gaps from PR #26
  (project create --root flag) critic: `--root foo/bar`
  (relative without `./` prefix) → asserts
  `rootPath = join(cwd, "foo/bar")`; `--root /nonexistent`
  → asserts stored as-is + exit 0 (Option B contract);
  `--root ""` → asserts `rootPath = process.cwd()`
  (benign-but-pinned). All 3 tests use `.toBe()` exact
  equality. Zero production code change. Critic ACCEPT
  (THOROUGH mode, zero CRITICAL / HIGH / MAJOR), 2 MINOR
  (logSpy.toHaveBeenCalledTimes asymmetry, plan/spec date
  drift) — backlog. PR
  <https://github.com/haJ1t/MegaSaver/pull/28> merged into
  `main` (merge commit `e8cd129`).

## [2026-05-10] schema | Y5 aider sync coverage (PR #29)

- Spec: `docs/superpowers/specs/2026-05-10-y5-aider-sync-coverage-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-y5-aider-sync-coverage-plan.md`
- Branch: `feat/y5-aider-sync-coverage` (deleted post-merge)
- Result: Closes Y5 backlog from PR #21 critic. Two new
  tests in `apps/cli/test/connector.test.ts` covering aider
  sync paths previously uncovered: **noop** (sync `--target
  aider` twice in a row, second emits `aider CONVENTIONS.md
  noop`, file byte-identical) and **stale-block-replace**
  (pre-seed `CONVENTIONS.md` with stale Mega Saver block via
  `MEGA_BLOCK_PLACEHOLDER`, sync replaces block in-place,
  new project id present, stale id `not.toContain`). Tests
  use regex-anchored status assertions
  (`/^aider\s+CONVENTIONS\.md\s+(noop|wrote)$/`) — stricter
  than `toContain` precedent. Mirrors codex/claude-code
  precedents at `connector.test.ts` lines 298 + 347. Zero
  production code change — production already implements
  these paths correctly. Critic ACCEPT (THOROUGH mode, no
  CRITICAL / HIGH / MAJOR), 4 MINOR (preserve user content
  byte-check, stale-block session pin, SESS_CURSOR misnaming
  pre-existing, plan post-PR step) — backlog. PR
  <https://github.com/haJ1t/MegaSaver/pull/29> merged into
  `main` (merge commit `07aedfa`).

## [2026-05-10] schema | --json for project commands (PR #30)

- Spec: `docs/superpowers/specs/2026-05-10-json-project-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-json-project-plan.md`
- Branch: `feat/json-project` (deleted post-merge)
- Result: First slice of v0.2 `--json` flag pass. Adds
  optional `--json` flag to `mega project list` and
  `mega project create`. Default behavior byte-identical
  (existing `<id>  <name>` lines). With `--json`: compact
  1-line JSON (no pretty-print). `project list --json` emits
  `JSON.stringify(projects)` array; `project create demo
  --json` emits single JSON object. All 5 `Project` fields
  (id, name, rootPath, createdAt, updatedAt) — no curation.
  Empty-store divergence pinned in spec D4 + test: text
  mode → empty stdout, JSON mode → `[]`. 4 new tests (TDD
  RED→GREEN). cli 199 → 203. Critic ACCEPT-WITH-RESERVATIONS.
  4 MINOR backlog: stderr pinning gaps, --root + --json
  relative test, --json error-path tests. PR
  <https://github.com/haJ1t/MegaSaver/pull/30> merged into
  `main` (merge commit `68971ae`).

## [2026-05-10] schema | --json for memory list + show (PR #31)

- Spec: `docs/superpowers/specs/2026-05-10-json-memory-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-json-memory-plan.md`
- Branch: `feat/json-memory` (deleted post-merge)
- Result: Second slice of v0.2 `--json` flag pass (parallel
  with PR #30). Adds optional `--json` flag to
  `mega memory list` and `mega memory show`. Default text
  behavior byte-identical (no `formatMemoryListLine` /
  `formatMemoryShowLines` change). With `--json`: flat
  per-entry shape (id, projectId, scope, sessionId, content,
  createdAt) matching `MemoryEntry` schema; `null` for
  `sessionId` when scope=project (NOT `"-"`, NOT
  `"none"`); FULL content (not truncated to 60 chars like
  text mode `list`). Empty memory list `[]` divergence
  pinned. 3 new tests. cli 203 → 206. Critic ACCEPT
  (THOROUGH), 3 MINOR backlog: arg shape inconsistency
  with PR #30 (`!!args.json` vs `=== true`), explicit
  init-notice stderr pinning, --json failure-path smoke. PR
  <https://github.com/haJ1t/MegaSaver/pull/31> merged into
  `main` (merge commit `e7207ff`).

## [2026-05-10] schema | --json for connector status (PR #32)

- Spec: `docs/superpowers/specs/2026-05-10-json-connector-status-design.md`
- Plan: `docs/superpowers/plans/2026-05-10-json-connector-status-plan.md`
- Branch: `feat/json-connector-status` (deleted post-merge)
- Result: Third slice of v0.2 `--json` flag pass. Adds
  optional `--json` flag to `mega connector status` (NOT
  `connector sync` — write-side defers). Per-target
  collect-then-emit pattern: when `json: true`, accumulate
  records into array, emit `JSON.stringify(records)` after
  loop. Each record: `{id, relativePath, status, session}`
  where status ∈ `{in-sync | drift | no-block | missing |
  error}` and `session` is session id string or `null`
  (NOT `"none"`). Pre-loop failures (project not found,
  unknown target, rootPath missing) preserve existing
  text/stderr + exit 1 contract — no JSON emit on usage
  errors. Per-target errors (`status: "error"`) still
  emitted in JSON array with stderr text mirroring. cli
  204 → 207. Critic ACCEPT-WITH-RESERVATIONS, 4 MINOR
  backlog: missing `default: false` (inconsistency with PR
  #30/#31), no citty-wrapper test (only direct
  `runConnectorStatus` invocation), dead `memories.json`
  fixture, --json + pre-loop-failure regression test.
  Branch was forked from `7ba650b` (pre-PR #30/#31), no
  merge conflict because slots touched different files.
  PR <https://github.com/haJ1t/MegaSaver/pull/32> merged
  into `main` (merge commit `9711675`).

## [2026-05-10] schema | AA3 schema ordering convention (PR #33)

- Spec: `docs/superpowers/specs/2026-05-09-aa3-schema-ordering-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-aa3-schema-ordering.md`
- Branch: `feat/aa3-schema-ordering` (deleted post-merge)
- Result: Closes PR #23 critic AA1 backlog. Adds WHY
  comments to 3 schema declarations explaining canonical
  ordering convention:
  - `packages/shared/src/agent-id.ts`: alphabetic
    (schema-canonical for derived CLI strings)
  - `packages/shared/src/risk-level.ts`: severity-ascending
    (low → critical, semantic UX progression — do NOT
    alphabetize)
  - `packages/core/src/memory-entry.ts:4`: semantic
    project→session (containment hierarchy: sessions
    belong to projects)
  Plus 3 drift-guard tests in the existing schema test
  files using `.toEqual([...])` exact-match. Future "tidy"
  PR that reorders any of the 3 enums fails CI immediately.
  All test names cite "AA3 convention" for grep-anchor.
  shared 25 → 27 + core 128 → 129 = 156 total in the two
  packages. Critic ACCEPT (THOROUGH mode, zero
  CRITICAL/MAJOR), 2 MINOR (rebase wording cosmetic,
  squash candidate). The original AA3 slot was the
  longest-running of the 4 first-batch teammates due to
  rebase + Biome multi-line array format requirement, but
  delivered cleanly. PR
  <https://github.com/haJ1t/MegaSaver/pull/33> merged into
  `main` (merge commit `debfa93`).

## [2026-05-10] schema | parallel team batch (Y3 + AA2 + project-root)

- Team: `megasaver-v02-parallel` (config:
  `~/.claude/teams/megasaver-v02-parallel/config.json`)
- Spawned 4 teammates in parallel via TeamCreate + 4 Agent calls
  with `team_name` + `name`. Each teammate worked in own worktree
  (`.worktrees/{slot}`) on isolated branch (`feat/{slot}`),
  followed full superpowers chain (brainstorm Q1 → spec → plan →
  TDD execute → DoD gate → push → PR), and SendMessaged team-lead
  with PR URL when ready.
- 3 of 4 PRs merged in this batch:
  - **PR #24** (`f0135f7`) Y3 docs drift fix
  - **PR #25** (`a8fb044`) AA2 connector --target description derive
  - **PR #26** (`b20c9b6`) project create --root flag
- 4th teammate `aa3-schema-docs` still working on AA3 (schema
  member-ordering convention docs) at this batch close — will land
  separately.
- Inter-session communication: SendMessage tool, idle/awake
  lifecycle, shared TaskList. Team coordination patterns proven
  for further parallel slot batches.

## [2026-05-10] schema | Y3 docs drift fix (PR #24)

- Spec: `docs/superpowers/specs/2026-05-09-y3-docs-drift-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-y3-docs-drift-plan.md`
- Branch: `feat/y3-docs-drift` (deleted post-merge)
- Result: PR #21 (aider connector target) added a 4th built-in
  connector target (`aider` → `CONVENTIONS.md`), but governance
  docs still listed only 3 agent file scopes. Y3 closes the gap:
  `CLAUDE.md §7` (header callout + scope list), `AGENTS.md` (new
  Multi-Agent Dogfood section), `.cursor/rules/mega-context.mdc`,
  and new `docs/conventions/multi-agent-dogfood.md` (source-of-truth
  per §7's pointer rule) all enumerate 4 file scopes (CLAUDE.md,
  AGENTS.md, `.cursor/rules/*.mdc`, `CONVENTIONS.md`). Convention
  count updated 12 → 13 canonical files. Out of scope (per
  team-lead's clarifications): `.cursor/rules/megasaver.mdc`
  (connector-managed by PR #17 cursor target), `§2 repo layout
  CONVENTIONS.md` (connector output, not repo-tracked). Critic
  re-pass returned ACCEPT-WITH-RESERVATIONS with MAJOR #1 closed
  inline (`f7d07f6`): the deleted "§7 is the only section without
  its own conventions file" parenthetical was replaced with the
  new positive invariant "Thirteen canonical files, one per
  CLAUDE.md section §1-§13" — turning a now-stale negative claim
  into a forward-looking structural rule. PR
  <https://github.com/haJ1t/MegaSaver/pull/24> merged into `main`
  (merge commit `f0135f7`).

## [2026-05-10] schema | AA2 connector --target description derive (PR #25)

- Spec: `docs/superpowers/specs/2026-05-09-aa2-connector-target-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-aa2-connector-target-plan.md`
- Branch: `feat/aa2-connector-target` (deleted post-merge)
- Result: Extends PR #22 + PR #23's schema-derived pattern to the
  4th closed-enum surface (target IDs). Both
  `connectorSyncCommand.args.target.description` and
  `connectorStatusCommand.args.target.description` now derive from
  `KNOWN_TARGET_IDS.join(" | ")` (launch order from
  `KNOWN_TARGETS` in `apps/cli/src/known-targets.ts`). Resulting
  `--help` strings:
  - `Optional target id (claude-code | codex | cursor | aider) to seed when its file does not exist.`
  - `Optional target id (claude-code | codex | cursor | aider) to filter the report.`
  Adding a 5th target now requires editing only
  `apps/cli/src/known-targets.ts`'s `KNOWN_TARGETS` array — the
  description, validator (`isKnownTargetId`), error messages
  (PR #22), and `--help` text (this PR) all derive. +2 `toBe`
  pinned-format drift-guard tests in `apps/cli/test/connector.test.ts`
  parallel to PR #23's `session.test.ts:222` pattern. cli 194 →
  196. Critic returned ACCEPT (THOROUGH mode, no escalation), zero
  CRITICAL / HIGH / MAJOR / MEDIUM findings; OBSERVATION-grade
  notes only (commit subject lengths 54-56 chars exceeded the
  ≤ 50 cap; pre-existing `KNOWN_TARGET_IDS: readonly string[]`
  type widening from PR #22). PR
  <https://github.com/haJ1t/MegaSaver/pull/25> merged into `main`
  (merge commit `a8fb044`).

## [2026-05-10] schema | project create --root flag (PR #26)

- Spec: `docs/superpowers/specs/2026-05-09-project-create-root-flag-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-project-create-root-flag-plan.md`
- Branch: `feat/project-root-flag` (deleted post-merge)
- Result: Adds optional `--root <dir>` flag to `mega project
  create <name>`. Default behavior (omit `--root`) preserves
  byte-identical `rootPath = process.cwd()`. With `--root`:
  `rootPath = path.resolve(args.root)` (absolute path; supports
  relative inputs like `--root .`). No existence check at create
  time (Option B per teammate's brainstorm with team-lead) —
  downstream `assertProjectRoot` (called by `mega connector sync`)
  is the validation gate. Use case: register a project for a
  directory that will be cloned/scaffolded next; or invoke from
  one directory while pointing at another root. +3 tests
  (absolute pass-through, relative resolve via `path.resolve(".")`,
  omit-default regression guard byte-identical to pre-refactor).
  cli 196 → 199. Critic returned ACCEPT (THOROUGH mode, zero
  CRITICAL / HIGH / MAJOR), MINOR-grade backlog (commit subject
  lengths 52-53 chars; one noise format-fix commit; missing
  tests for `--root foo/bar` and `--root /nonexistent` —
  OBSERVATION-grade follow-ups). PR
  <https://github.com/haJ1t/MegaSaver/pull/26> merged into `main`
  (merge commit `b20c9b6`).

## [2026-05-10] schema | v0.2 critic-backlog cleanup batch (4 PRs)

Round 1 of follow-up backlog closure. 4 parallel teammates dispatched
on `c6c3288` HEAD, all merged 2026-05-10:

- PR #34 (`2d97b29`) — CC1 docs/wiki cleanup (9 items: S9/T7/T8/U4/
  U8/U10/V9/W8/X6). Critic 1 MAJOR (S9 example gutter still wrong
  for `error` line + §4 template) closed inline `84e8c61`.
- PR #35 (`8c6c0a2`) — CC2 `connector.ts` 419-LOC split into
  `connector/{sync,status,shared,index}.ts` mirroring PR #18
  pattern; +S3 prologue extract, +S6 byte-equality regression
  fixture (4 tests, 1 per known target). Critic ACCEPT.
- PR #36 (`4e6c84d`) — CC4 session/memory test coverage (V1-V8 +
  W10, 8 items). cli 214→218, core 129→134. V1 process-spawn
  concurrent-update, V2 `vi.mock("node:fs")` partial-write recovery,
  V3 fast-check property test. Critic ACCEPT-WITH-RESERVATIONS
  (V4 framing PIN-not-fix; PR body corrected pre-merge).
- PR #37 (`48cbcac`) — CC5 defensive + policy (8 items: U7/U9/W4/
  W5/W6/W9/X4/X5). Critic REJECT initial (4 CRITICAL: false GREEN
  claim, fake W6 session test using ASCII space, `vi.spyOn` frozen
  ESM module, X4 `entry-1` substring matched `entry-10`); all
  fixed in `34d60e2` + `856ab16`. Rebased onto CC2 split (manual
  port: U7 mkdir wrap → `connector/sync.ts`, X4 sort+slice →
  `connector/shared.ts`). User-locked policies: W4 reject ended-
  session memory create, X4 graceful filter-then-cap-by-recency
  (drops `.max(20)` hard-fail, sorts by `createdAt` desc, slices
  20 most-recent).

Closed ~28 critic-flagged follow-ups across 6 series (S/T/U/V/W/X).
Remaining: CC3 (T1/T3/T4/T5/S5/S7/S11/U2/U3/U5/U6 — 11 items)
inflight on `feat/cc3-connector-tests`, plus 5 deferred (T6 →
--json sync, S8 → AA2 orphan check, S10 → BB hardening, W7 v0.1
codepoint accept).

Method note: parallel 4-teammate dispatch from single `c6c3288`
HEAD, no team coordination needed (CC1/CC4/CC5 fully independent;
CC3 holds for CC2 merge; CC5 manually rebased onto CC2's split).
2/4 teammates landed mid-task (CC1 + CC5) — both required main-
thread completion. CC2 + CC4 finished autonomously.


## [2026-05-10] schema | CC3 connector test coverage (PR #39 in review)

CC3 amendment to the cleanup batch. All 11 critic-flagged connector
test coverage items closed on `feat/cc3-connector-tests`:

- T1: `pickLatestOpenSession` unit tests (5 cases: empty, 1 open,
  ended-skip, 2 open ranking, agentId filter).
- T3: same-instant tie-break — pinned "first encountered wins".
- T4: numeric UTC vs lex divergence — original timestamps shared
  `2026-03-13T` prefix so lex and numeric agreed; replaced with
  `10:00+02:00` (UTC 08:00) vs `09:00Z` (UTC 09:00) where lex and
  numeric disagree.
- T5: 1ms-precision test.
- S5: read-path symlink semantics documented in
  `packages/connectors/shared/test/filesystem.test.ts` (current
  behavior follows symlinks; security backlog tracked separately).
- S7: 3-session ordering test.
- S11: `targets.length>0` invariant after `--target` filter.
- U2: cursor-specific `no-block` status test.
- U3: cursor sync into existing user-content (`joinWithManagedBlock`).
- U5: cursor + claude-code multi-open-session no cross-leak.
- U6: chmod 0o500 on `.cursor` (r+x, no -w) reaches mkdir EACCES
  path. Initially deferred (incorrect "filesystem-only impossible"
  claim); reviewer's repro showed `0o500` is traversable so
  `readTargetFile` returns null on absent file, then mkdir fails
  with EACCES → U7 wrap → `file_write_failed`. Test restored.

CC5 yan-etki corrections (turbo cache masked at CC5 merge):
- `packages/connectors/shared/test/context.test.ts:26` — `.max(20)`
  rejection inverted (X4 dropped schema cap; cap is now policy in
  builder, not schema).
- `packages/connectors/shared/test/render.test.ts` + `packages/
  connectors/claude-code/test/markdown.test.ts` — continuation-indent
  tests deleted (X5 removed source path; multi-line content
  unreachable via `contentSchema`).

Critic REVISE round 1 closed inline (`c69423d`): T4 timestamps fix
+ U6 chmod 0o500 path + wiki update. cli 218 → 230 (10 new connector
+ U6); total 540 → 539 (-3 from CC5 cleanup, +2 from T4 + U6).

## [2026-05-10] schema | DD4 S8 closure — --target help-text divergence

**Backlog item:** S8 (from PR #15 critic, connector status slot).

**Finding:** Post-AA2 (PR #25, `a8fb044`), both `connectorSyncCommand`
and `connectorStatusCommand` `--target` descriptions correctly derive
their enum list from `KNOWN_TARGET_IDS.join(" | ")` and use distinct
accurate action phrases:
- `sync`: "to seed when its file does not exist." — precise: the
  sync loop iterates ALL `KNOWN_TARGETS`; `targetFlag` only suppresses
  the skip-when-missing guard for the named target.
- `status`: "to filter the report." — precise: status loop filters
  `KNOWN_TARGETS.filter((t) => t.id === input.targetFlag)`.

S8 divergence was fully resolved by AA2. No code change required.
**Status: CLOSED** (closed by AA2 / PR #25).

## [2026-05-10] schema | DD4 W7 closure — grapheme-aware truncation wontfix

**Backlog item:** W7 (from PR #19 critic, memory CLI slot).

**Decision (locked by user):** codepoint-only truncation in
`apps/cli/src/commands/memory/shared.ts::truncate()` accepted for
v0.1. `Intl.Segmenter` grapheme-aware splitting deferred; real-world
impact is low (edge case: emoji clusters or combining diacritics in
memory entry content). A one-line WHY comment added to the `truncate`
function explaining the codepoint policy.

**File touched:** `apps/cli/src/commands/memory/shared.ts`
**Status: CLOSED as WONT-DO (v0.1)**

## [2026-05-10] schema | DD4 T6 deferral note — sync error session suffix

**Backlog item:** T6 (from PR #16 critic, connector status S1+S2 followups slot).

**Decision:** T6 (sync error line carries `session=<id|none>` suffix
for cross-command symmetry with `connector status`) remains deferred.
Bundled with the `--json` write-side batch (session create/end/update,
memory create, connector sync). Adding the suffix requires locking the
full sync text-output format in tandem with its JSON representation;
out of scope for this docs-only DD4 batch.

**Status: STILL DEFERRED** (owned by future --json write-side batch)

## [2026-05-10] feat | DD2 BB hardening (PR #42)

`atomicWriteFile` durability + S10 spec stanza on
`feat/dd2-bb-hardening`:

- **Temp fsync BEFORE rename**: open temp fd (read), `fsyncSync`,
  close. POSIX best-practice — temp data is on disk before rename
  links it in. Crash here either preserves the original target
  (rename hadn't happened) or surfaces the new content (rename
  + previous fsync survived).
- **Dir fsync AFTER rename** with Windows-friendly degradation:
  open parent dir fd (read), `fsyncSync`, close. Catch swallows
  `EISDIR`/`EPERM`/`ENOTSUP` (Windows fs platforms where dir
  fsync isn't supported); other errors propagate.
- **S10 spec stanza** (`docs/superpowers/specs/2026-05-09-mega-
  connector-status-design.md` §11): policy doc — status is
  best-effort; concurrent sync may produce mixed in-sync/drift.
  §6 exit-code stanza now cross-references §11 to remove the
  silent contradiction.
- **Cross-process lock evidence**: V1 (CC4 PR #36) at `apps/cli/
  test/session/update-concurrency.test.ts` already exercises
  the lock primitive via spawn against `dist/cli.js`. Spec/plan
  cross-process-test step deferred (V1 sufficient for v0.1
  durability change; lock primitive unchanged in this slot).

`pnpm exec vitest run` worktree-wide: 540/540 passing (52 test
files). Critic round 1: REVISE for fabricated 552 count (actual
540), Windows guard divergence, §6/§11 silent contradiction —
all closed inline (`36bf561`).

## [2026-05-10] feat | DD1-DD4 hardening + cleanup round 2 (4 PRs)

Round 2 of follow-up backlog closure. 4 parallel teammates
dispatched on `188f1e0` HEAD (post-CC1-CC5+wiki batch); all
landed 2026-05-10:

- PR #40 (`88d9aa6`) — DD1 AA cleanup: explicit `default: false`
  on 3 boolean `--json` flags + citty-wrapper drift guards on 5
  commands + `--json` failure-path tests + init-notice exact-pin
  + dead memories.json fixture removed. All 5 `--json`
  descriptions aligned to "Emit JSON output." Critic ACCEPT-WITH-
  RESERVATIONS, 2 MAJOR closed inline (`2066979`).
- PR #41 (`bf582ae`) — DD4 deferred items: S8 closed (post-AA2
  help-text accurate); W7 wontfix-v0.1 (codepoint truncation
  comment in `memory/shared.ts`); T6 deferred to `--json` write-
  side batch with ownership note. Bonus: 3 pre-existing biome
  lint errors fixed.
- PR #42 (`82e6c7f`) — DD2 BB hardening (HIGH risk): atomicWriteFile
  + fsync (temp BEFORE rename, dir AFTER rename, Windows-friendly
  degradation). S10 spec §11 stanza on status concurrency.
  V1 (CC4 PR #36) cited as cross-process lock evidence. Critic
  REVISE round 1 (4 findings: fabricated 552 vs 540, Windows
  guard, §6/§11 contradiction, wiki entry); all closed inline
  (`36bf561` + `72dea63`).
- PR #43 (`0578ae1`) — DD3 Z2/Z3: vitest typecheck mode in 6
  packages + 4 `.test-d.ts` regression suites for closed enums.
  Critic REQUEST-CHANGES (CRITICAL stale base + HIGH false
  deferral note + HIGH typecheck wiring); rebased + deferral
  replaced with `@ts-expect-error` non-member guard (`d0c7a04`).

Closed: ~13 follow-up items (DD1: 5 MINORs, DD4: 3 deferreds,
DD2: 3 hardening, DD3: 2 type-safety). Schema-derived surfaces
+ closed-enum literal types now compile-time enforced via
`.test-d.ts` + vitest typecheck mode. atomicWriteFile durable
under POSIX crash semantics.

Method note: parallel 4-teammate dispatch from `188f1e0` HEAD
(separate worktrees, no team coordination). 2/4 teammates landed
mid-task (DD2 fsync TDD red, DD3 false deferral) — main-thread
completion. Critic round needed amendments on 3/4 PRs (DD1
ACCEPT-WITH-RESERVATIONS, DD2 REVISE, DD3 REQUEST-CHANGES);
DD4 APPROVE first round.

Total tests on main: 539 → ~575 (+13 DD1 + 1 DD2 + 9 DD3 +
3 net DD4 lint baselines).
