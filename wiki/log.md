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

## [2026-05-10] feat | --json write-side (PR #45) — v0.2 main feature

`--json` flag on 5 write-mutation commands shipped on
`feat/json-write-side` (merged at `89a25f9`):

- session create: emit full Session (was: id only)
- session end: emit ended Session (was: silent → text mode
  preserves silence; --json adds Session payload)
- session update: emit updated Session (was: silent)
- memory create: emit full MemoryEntry (was: id only)
- connector sync: emit per-target records [{id, relativePath,
  status, session}, ...] mirror connector status

T6 closure (PARTIAL): sync text `error` lines now carry
`session=<id|none>`. Non-error statuses (skipped/created/noop/
wrote) keep byte-compat 3-column format. Full symmetry with
`connector status` would break byte-compat for non-error lines
and is deferred per spec §2 trade-off. JSON mode carries
`session` on every record (full data symmetry).

Critic REVISE round 1 (2 CRITICAL + 3 MAJOR): T6 spec/code drift,
failure-path tests missing, !!args.json vs args.json === true
form drift (DD1 regression), §13 anti-pattern (getSession round-
trip + impossible-case fallback after endSession/updateSession),
test-count claim fabrication. All closed inline (`173d820`):
captured registry return values directly, dropped fallback,
aligned connector status to !!args.json (10/10 commands now
consistent), added 5 failure-path tests, documented T6 partial-
symmetry trade-off in spec + sync.ts comment.

cli 281 → 301 (+20: 5 success + 5 failure-path + 10 drift-guard).
Total repo: ~575 → 587 passed (587), 55 test files.

After PR #45:
- v0.2 main feature complete: read+write `--json` parity.
- All 10 `--json` commands consistent on type/default/description/
  consumption form.
- Failure-path policy enforced bidirectionally (12 tests).

Open: EE cleanup (tuple-ordering pin per AA3, dedicated core-
level cross-process lock test, JSON-failure policy doc); T6 full-
symmetry followup (deferred, would break byte-compat); FF full
Windows port.

## [2026-05-10] decision | FF Windows port deferred to v0.3

v0.2 ships graceful Windows degradation (dir fsync swallows
EISDIR/EPERM/ENOTSUP; data durable, rename durability reduced to
process-crash only). Full filesystem semantics audit (case-
insensitive paths, CRLF normalization, lock file behavior,
cross-platform CI gate) defers to v0.3 milestone. Spec at
docs/superpowers/specs/2026-05-10-windows-port-deferral.md.

## [2026-05-10] release | v0.2 SHIPPED

Final close-out batch (3 PRs, 2026-05-10):

- PR #47 (`9fa2414`) — FF Windows port deferral spec to v0.3.
- PR #48 (`c1c0389`) — T6 full sync text symmetry; byte-compat
  break: every connector sync line carries session=<id|none>.
- PR #49 (`460a66e`) — EE cleanup: tuple-ordering pins per AA3
  (3 schemas), RunConnectorSyncInput.json required, JSON output
  policy doc in wiki/entities/cli.md, pre-existing lint fixes.

v0.2 final state on main HEAD `460a66e`:

- 49 PRs merged from bootstrap (#1) to close-out (#49).
- 587 tests on 55 files; ~196 → 587 across v0.1 → v0.2.
- 4 connector targets, 11 CLI subcommands, 10 with --json (full
  read+write parity), 4 closed-enum literal types compile-time
  enforced, atomicWriteFile POSIX-durable, status concurrency
  policy documented.
- ~40+ critic follow-ups closed across S/T/U/V/W/X/Y/Z/AA/CC/
  DD/EE/FF/T6 series.

Deferred to v0.3:
- FF full Windows port (current: graceful no-op).
- mcp-bridge + skill-packs packages (scaffolded placeholders).
- GUI app (CLI-first per v0.1 decision).
- pnpm conventions:sync automation.

v0.2 closed.

## [2026-05-10] schema | GG real Windows durability — atomicWriteFile fsync platform branch

First v0.3 work item lands ahead of the rest of the FF Windows
port bundle. Replaced the reactive
`EISDIR`/`EPERM`/`ENOTSUP` try-catch around the parent-directory
fsync in `packages/core/src/json-directory-store.ts` with a
proactive `process.platform === "win32"` branch:

- `IS_WIN32` constant captured at module load (`process.platform`
  is immutable for the process lifetime).
- POSIX (macOS / Linux): unchanged — `openSync(parentDir, "r")`
  → `fsyncSync` → `closeSync` after the rename.
- Windows (NTFS): the dir fsync block is skipped entirely. NTFS
  journals rename metadata on transaction commit; `FlushFileBuffers`
  on a directory handle is a documented no-op (SQLite VFS,
  Microsoft Win32 docs). `openSync(dir, "r")` itself fails with
  `EISDIR` on Windows, so the v0.2 catch was firing on the open,
  not the fsync.

Behavioural delta vs v0.2:

- **Sandboxes / antivirus**: a real `EPERM` (Docker capability
  drop, seccomp, macOS SIP, Win AV) on the directory fsync now
  surfaces as `store_write_failed` instead of being silently
  swallowed.
- **Windows happy path**: identical — one less syscall, same
  durability (NTFS journal guarantees the rename).
- **POSIX**: zero change.

+1 test in `packages/core/test/json-directory-store.test.ts`
pins the win32 branch by stubbing `process.platform` via
`Object.defineProperty` + `vi.resetModules()` + dynamic
re-import so the module-load `IS_WIN32` constant is captured
under the stubbed platform. Asserts: temp file open + temp
fsync + rename happen exactly once each; parent-dir open and
fsync both happen **zero** times. The pre-existing POSIX
ordering test continues to gate macOS / Linux behaviour
unchanged.

CI scope unchanged (still Linux/macOS only). Windows correctness
is correct-by-construction: the win32 branch is exercised on
every PR via the stub, and the underlying NTFS semantics are
the same ones SQLite relies on across millions of Windows
installs.

Supersedes FF Windows port deferral spec §1 (fsync) only. The
other v0.3 deferrals remain open:
- Case-insensitive path resolution audit.
- CRLF normalization in connector outputs.
- Lock file semantics audit on Windows.
- Windows CI gate (GitHub Actions runner).

Spec: `docs/superpowers/specs/2026-05-10-gg-windows-port-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-gg-windows-port.md`.
Tests: 587 → 588 (+1). Biome clean. Risk HIGH (core durability
semantics).
## [2026-05-10] schema | HH mcp-bridge + skill-packs scaffolded

First v0.3 work: reserved the two `packages/*` slots called out
in `CLAUDE.md §2` but absent from the workspace until now.

- **`@megasaver/mcp-bridge`** — placeholder for the Model
  Context Protocol bridge. Public surface locked:
  `createBridge(config)` factory returning
  `{ transport, start(), stop() }`. Both `start()` and `stop()`
  reject with `McpBridgeError("not_implemented", ...)`. Closed
  enums: `McpTransport` = `["stdio", "sse"]` (launch order),
  `McpBridgeErrorCode` = `["not_implemented"]` (alphabetic).
  Tuple-ordering pins in `.test-d.ts` from day one (AA3
  convention). 24 tests (4 runtime + 5×4 type regressions +
  bridge smoke).
- **`@megasaver/skill-packs`** — placeholder for installable
  Mega-Saver-native skill bundles. Public surface locked:
  `loadPack(path)` factory rejecting with
  `SkillPackError("not_implemented", ...)`; manifest type +
  schema (`SkillPackManifest`, `SkillRef`,
  `skillPackManifestSchema`) parses a kebab name, SemVer
  version, kind, skills array, capabilities array, nullable
  description. Closed enums: `SkillPackKind` =
  `["prompt", "skill", "workflow"]`, `SkillPackCapability` =
  `["network", "read-memory", "write-memory"]`,
  `SkillPackErrorCode` = `["not_implemented"]` (all
  alphabetic). 38 tests (8 runtime + 5×3 type regressions +
  manifest validation).

Specs: `docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md`,
`docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-hh-mcp-skillpacks.md`.

Workspace now at 9 projects (was 7). Total tests on main:
587 → 599 (+12 runtime; type-regression `.test-d.ts` tests
run via vitest typecheck mode per-package and do not affect
the runtime total).

Drive-by: pre-existing biome line-width violations in
`apps/cli/test/connector.test.ts` (introduced by PR #48) were
auto-formatted (no behavior change) to unblock `pnpm verify`
in this PR.

Reserved future closed-enum surfaces (NOT in v0.3 schema,
documented in specs §7): mcp-bridge — `auth_failed`,
`resource_not_found`, `tool_invocation_failed`,
`tool_not_found`, `transport_closed`, `transport_failed`;
skill-packs — `manifest_invalid`, `manifest_missing`,
`pack_already_installed`, `pack_not_found`, `pack_path_escape`,
`pack_unreadable`, `skill_id_conflict`. Schemas widen +
tuple-ordering pins update when the real loaders land.

## [2026-05-10] feat | II — GUI app bootstrap (apps/gui)

Opened v0.3 II series. Bootstrapped `apps/gui` as a new workspace
package (`@megasaver/gui`, ESM, private).

**Framework decision:** Vite + React SPA + tiny `node:http` bridge.
Tauri (Rust toolchain dep) and Electron (heavy) rejected for
bootstrap. Bridge imports `@megasaver/core` directly — no subprocess
parsing, no CLI surface extension needed.

**What shipped:**
- `apps/gui/src/` — React SPA with two views: Sessions, Memory
  entries. View switcher via `ViewId` closed enum (alphabetic AA3
  convention). `VIEW_IDS = ["memory", "sessions"] as const`.
- `apps/gui/bridge/` — `node:http` server (port 5174) exposing
  `GET /api/health`, `GET /api/sessions`, `GET /api/memory`.
  Imports `createJsonDirectoryCoreRegistry` + `initStore` from
  `@megasaver/core`; iterates all projects via `listProjects()` and
  flatMaps per-project session/memory lists.
- `apps/gui/src/lib/api-client.ts` — typed `fetch` wrappers.
- `apps/gui/vitest.config.ts` — jsdom environment, typecheck mode.
- `apps/gui/vite.config.ts` — React plugin, proxy `/api` → port 5174.
- `apps/gui/index.html` — Vite entry.
- `apps/gui/test/app.test.tsx` — smoke test (4 assertions): both
  view buttons render, default view correct, click switches view,
  empty-state copy renders. `# @vitest-environment jsdom` header for
  repo-root vitest run.
- `apps/gui/test/view-id.test-d.ts` — tuple-ordering pin (2 type
  assertions).

**Scripts:**
- `pnpm --filter @megasaver/gui dev` — Vite dev server (port 5173)
- `pnpm --filter @megasaver/gui bridge` — Node bridge (port 5174)
- Run both for full local dev; one-command dev deferred to v0.4.

**Test counts:** 587 → 591 (+4 smoke assertions). 56 test files.
Biome: 177 files checked, 0 errors. Pre-existing `connector.test.ts`
formatter issue fixed inline.

**Closed:** wiki v0.3 GUI bootstrap slot (deferred from v0.2 close-out).

**Deferred to v0.4:**
- Project picker / filtering UI.
- Session and memory detail views.
- Write actions (create/end/update).
- Native window packaging (Tauri/Electron).
- Single-command `dev` (Vite + bridge under one process).
- `--store` flag at bridge CLI layer.

Spec: `docs/superpowers/specs/2026-05-10-ii-gui-app-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-ii-gui-app.md`.

## [2026-05-10] schema | JJ — pnpm conventions:sync automation (v0.3)

Shipped the convention sync script under `scripts/conventions-sync/` and wired it into the root `package.json` as `pnpm conventions:sync` (write mode) and `pnpm conventions:check` (default check mode, plumbed into `pnpm verify`). Implementation runs on Node's built-in `--experimental-strip-types`, so no extra runtime dependency was added beyond `citty` (already shipped for the CLI).

Source-of-truth decision: tagged-block mirroring. `docs/conventions/*.md` remain canonical. Each consumer file (`AGENTS.md` + three `.cursor/rules/*.mdc`) declares one `<!-- conventions:start id="<section>" source="<file>" -->` ... `<!-- conventions:end id="<section>" -->` block per pulled section. Content outside the sentinels is preserved verbatim, so `.mdc` frontmatter and `AGENTS.md` preamble survive a sync. Whole-file derivation was rejected because `AGENTS.md` is deliberately a slim mirror of CLAUDE.md (not byte-identical) and `.cursor/rules/*.mdc` carry per-file YAML.

Sentinel namespace differs from the connector's `MEGA_SAVER_BLOCK_*` pair on purpose — conventions sync manages the agent-config files themselves, while the connector manages memory-entry blocks injected at runtime. Two systems, two namespaces, no overlap.

First-run migration in the same PR: all four consumer files acquired sentinel blocks for the first time and `--write` populated them with the canonical body of each `docs/conventions/<file>.md`. CLAUDE.md is intentionally untouched — it stays as the long-form reference; managed blocks may follow in a later spec.

Closed-enum discipline: `MODES` and `CONSUMERS` are pinned with `.test-d.ts` tuple-ordering, matching the `KNOWN_TARGETS` precedent from `apps/cli/src/known-targets.ts`. The closed unions `Mode` and `ConsumerId` are asserted with `expectTypeOf` in `manifest.test.ts`.

Spec: `docs/superpowers/specs/2026-05-10-jj-conventions-sync-design.md`. Plan: `docs/superpowers/plans/2026-05-10-jj-conventions-sync.md`.

## [2026-05-10] release | v0.3 SHIPPED

First v0.3 batch closed in a single day. 4 PRs (#51 GG, #52 HH,
#53 II, #54 JJ) opened in parallel worktrees by 4 executor
teammates and merged sequentially via rebase chain (each follower
rebased through its predecessors' wiki/log.md conflicts).

Final main HEAD: `dff9575`. Tests on main: 587 (v0.2 baseline) →
626 passed (62 test files). Workspace 7 packages → 9 + 1 app =
10 buildable units.

What landed:

- **GG (PR #51, `e9ae54a`)** — `atomicWriteFile` real Windows
  durability. Replaces v0.2's reactive try-catch with a proactive
  `IS_WIN32` branch in `packages/core/src/json-directory-store.ts`.
  POSIX behavior bit-identical; on Windows the dir fsync is skipped
  (NTFS journals rename metadata; `FlushFileBuffers` on a directory
  handle is a documented no-op). `IS_WIN32` captured at module
  load — unit test pins the branch by stubbing `process.platform`.
  Real `EPERM` (sandbox / AV / seccomp) now surfaces as
  `store_write_failed` instead of being silently swallowed. Risk
  HIGH; supersedes FF deferral spec §1 (fsync only).
- **HH (PR #52, `c8cb6c5`)** — `@megasaver/mcp-bridge` and
  `@megasaver/skill-packs` placeholder packages. Public surfaces
  locked: `createBridge()` and `loadPack()` reject with structured
  `not_implemented` errors; `McpTransport`, `SkillPackKind`,
  `SkillPackCapability` closed enums pinned with `.test-d.ts`
  tuple-ordering from day one. Reserved future error codes
  documented in spec §7 for schema-widening when real loaders
  land. Workspace 7 → 9 packages.
- **II (PR #53, `d64a256`)** — `apps/gui` bootstrap (`@megasaver/gui`).
  Vite + React SPA + tiny `node:http` bridge importing
  `@megasaver/core` directly. Two views (Sessions / Memory entries),
  `ViewId = ["memory", "sessions"]` pinned. `pnpm --filter
  @megasaver/gui dev` (Vite, port 5173) + `pnpm --filter
  @megasaver/gui bridge` (port 5174). Tauri / Electron rejected for
  bootstrap.
- **JJ (PR #54, `dff9575`)** — `pnpm conventions:sync` automation.
  Tagged-block mirroring from `docs/conventions/*.md` into
  `AGENTS.md` + 3 `.cursor/rules/*.mdc`. `pnpm conventions:check`
  folded into `pnpm verify`; `MODES` and `CONSUMERS` closed enums
  pinned with `.test-d.ts`. CLAUDE.md preserved as long-form
  reference. Built on Node `--experimental-strip-types`.

Process notes:

- 4 parallel executor teammates dispatched in a single message; all
  ran on opus model. Each carried full superpowers chain (spec →
  plan → TDD → verify → push → PR) end-to-end without orchestrator
  intervention except for merge-time rebase resolution.
- Rebase chain: GG merged first (no conflict). HH/II/JJ each picked
  up a wiki/log.md conflict from the prior merge — resolution was
  mechanical (keep both blocks). JJ also had a duplicate biome-fix
  patch dropped during rebase (the same `connector.test.ts` format
  fix appeared in both HH and JJ commits; git auto-dropped the
  later one).
- Closed-enum tuple-ordering pin (AA3) discipline was upheld for
  every new enum surface introduced by all 4 PRs.

Deferred to v0.4: GUI v1 (project picker, detail views, write
actions, single-command dev, native packaging), `mcp-bridge` real
implementation (stdio, MCP tools/resources), `skill-packs` real
loader, Windows port remainder (case-insensitive paths, CRLF,
locks, Windows CI runner), CLAUDE.md tagged-block management,
aider connector sync end-to-end.

v0.3 closed.

## [2026-05-10] feat | LL — GUI v1 (picker, detail views, write actions, design pass)

First multi-agent ship of the v0.4 line. v0.3 GUI bootstrap (II / PR
#53) shipped two read-only tables; v1 turns it into a single-developer
console with a project picker, master-detail views for sessions and
memory entries, and three write flows (create session, end session,
update session, create memory entry). Risk MEDIUM.

What landed across four lanes (each in a fresh context per
`CLAUDE.md` §9 item 6):

- **Architect** — `docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md`.
  Locked: bridge API contract (8 endpoints), error envelope (10
  closed-enum codes), CORS posture (loopback only), Tailwind v3.4
  for the design system, `concurrently` for single-command dev,
  master-detail without a router, `localStorage` persistence with
  `megasaver:gui:v1:` namespace prefix.
- **Designer** — 14 components + Tailwind v3.4 token system.
  Direction: "Editorial Terminal" — DM Mono throughout, zinc / amber
  palette, light + dark via `prefers-color-scheme`. Tokens are CSS
  variables under `apps/gui/src/styles/tokens.css`; component
  styling lives in JSX class strings driven by
  `apps/gui/tailwind.config.js`.
- **Test-engineer** — 152 new tests across component, view,
  integration, bridge, and smoke layers. The bridge contract is
  pinned by 8 spec files in `apps/gui/test/bridge/` (handler,
  validation, CORS, conflicts, not-found, internal, error
  envelope) plus an in-process smoke test. Closed-enum surfaces
  (`WriteAction`, `BridgeErrorCode`) get `.test-d.ts` AA3
  assertions.
- **Executor** — `apps/gui/bridge/handler.ts` extracts the request
  router into `createBridgeHandler({ registry, ... })`; the
  production `server.ts` becomes a thin port-binding shim with
  graceful SIGINT/SIGTERM shutdown. 5 new bridge endpoints
  (`/api/projects`, POST/PATCH on sessions, POST/end, POST memory).
  Frontend write paths wired in `apps/gui/src/lib/api-client.ts`.
  `concurrently@^9.1` added to `apps/gui` devDeps so
  `pnpm --filter @megasaver/gui dev` boots Vite (5173) + bridge
  (5174) under one command with `--kill-others-on-fail`. Stale
  `apps/gui/test/app.test.tsx` (v0.3-shape) deleted; new
  integration tests cover its scope.

**Closed-enum surfaces** added (both AA3-pinned):

- `WriteAction = ["create-memory", "create-session", "end-session", "update-session"]`
- `BridgeErrorCode = ["internal_error", "method_not_allowed", "origin_forbidden", "project_not_found", "route_not_found", "session_already_ended", "session_not_found", "session_project_mismatch", "store_write_failed", "validation_failed"]`

**Test counts:** 626 (v0.3 baseline, 62 files) → 790 (164 in
`@megasaver/gui` alone, 26 files). Full GUI suite green via
`pnpm --filter @megasaver/gui test`.

**Risk** MEDIUM. v0.3 GUI bootstrap superseded; v0.3 deferred-list
"GUI v1" item closed.

Spec: `docs/superpowers/specs/2026-05-10-ll-gui-v1-design.md`.

## [2026-05-10] chore | MM — turbo ^build dep for vitest typecheck (#60)

Root cause of intermittent `pnpm exec turbo run test --force` failure
in `@megasaver/cli` vitest typecheck (`known-targets.test-d.ts:22`,
"Unused `@ts-expect-error`"): two compounding issues.

**A — `turbo.json` missing `^build`:** `test.dependsOn` was
`["build"]` (own-package build only). Turbo could schedule
`@megasaver/cli:test` before sibling connector builds completed,
leaving `dist/index.d.ts` absent for vitest typecheck.

**B — connector test scripts embedded `pnpm build &&`:** Three
connector packages (`connector-generic-cli`, `connector-claude-code`,
`connectors-shared`) had `"test": "pnpm build && vitest run"`. The
inline build called `tsup` with `clean: true`, wiping `dist/` inside
the test task and creating a ~1.5 s DTS-rebuild window that raced
with `cli:test` even after Part A ordering was satisfied.

**Fix (config-only):**
- `turbo.json`: `test.dependsOn` and `test:watch.dependsOn` →
  `["^build", "build"]`. Ensures all workspace deps' `dist/` is
  populated before any test task starts.
- 3 connector `package.json` scripts: `"test": "pnpm build &&
  vitest run"` → `"test": "vitest run"`. Removes redundant inline
  rebuild that was the actual race window.

**Evidence:** 3× `pnpm exec turbo run test --force` cold runs all
pass (18 successful, 18 total, exit 0). `pnpm verify` exit 0.

Spec: `docs/superpowers/specs/2026-05-10-mm-turbo-race-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-mm-turbo-race.md`.

## [2026-05-10] chore | NN — GUI v1.1 polish bundle (#61)

Five MIN/NIT fixes from the code-reviewer pass on PR #57 (`LL — GUI v1`),
bundled because each is small and shipping them individually is overhead.
Risk LOW.

- **a11y** — `<p className="...uppercase tracking-widest">New session</p>`
  in session-forms.tsx and memory-forms.tsx now `<h3>` (three call
  sites). Screen readers announce them as section starts; visual
  treatment preserved via `font-normal`.
- **dx** — `pnpm --filter @megasaver/gui dev` no longer spews the
  six `npm warn Unknown env config "..."` lines. Root cause was
  `concurrently`'s `npm:<script>` invoker syntax; swapped to
  `pnpm dev:vite` / `pnpm dev:bridge` so the workspace's actual
  package manager runs them.
- **cleanup** — `shortId()` hoisted from two views (`sessions-view.tsx`,
  `memory-view.tsx`) and one inline (`memory-forms.tsx`) into
  `apps/gui/src/lib/short-id.ts`. Single source.
- **diag** — `bridge/server.ts:39` forced-shutdown branch now writes
  `[bridge] forced shutdown after 1s grace period` to stderr before
  `process.exit(0)`. Silent hung-socket case becomes diagnosable.
- **security** — `apps/gui/bridge/handler.ts` `sendJson` adds
  `content-security-policy: default-src 'self'` to every JSON response.
  Loopback-only posture reinforced; one-line bridge test added in
  `apps/gui/test/bridge/handler.test.ts`.

**Test counts:** 854 (PR #57 baseline) → 855 (+1 CSP-header assertion).
Total tests 855 across 18/18 turbo tasks.

**Verify:** `pnpm verify` exit 0. Smoke: `curl -sI /api/health` shows
the CSP header; `grep -c "npm warn"` of the dev log is 0.

Spec: `docs/superpowers/specs/2026-05-10-nn-polish-bundle-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-nn-polish-bundle.md`.

## [2026-05-10] refactor | OO — split handler.ts + sessions-view.tsx per §8 file cap (#58)

Pure structural refactor. Two GUI files that breached CLAUDE.md §8
(file cap 300 LOC, one responsibility per file) are now decomposed:

**Bridge — `apps/gui/bridge/` shape:**

- `handler.ts` (178 LOC) — `createBridgeHandler({ registry, … })`
  entry + dispatch table + response helpers (`sendJson`, `sendError`,
  `parseUrl`). The `content-security-policy: default-src 'self'`
  header from #61 lives here on `sendJson` (preserved bit-for-bit).
- `cors.ts` (54 LOC) — `applyCorsPolicy(req, res, sendError)` returns
  `{ allowed: false } | { allowed: true; origin }`; `handleOptionsPreflight`.
- `error-mapping.ts` (58 LOC) — `mapCoreRegistryError`,
  `handleCaughtError` (Core error → Bridge `{status, code}`).
- `zod-schemas.ts` (76 LOC) — `TITLE_SCHEMA`, `CREATE_SESSION_BODY`,
  `END_SESSION_BODY`, `PATCH_SESSION_BODY`, `CREATE_MEMORY_BODY`,
  `zodErrorMessage`.
- `route-context.ts` (33 LOC) — `RouteContext`, `SendJson`, `SendError`.
- `routes/health.ts` (5), `routes/projects.ts` (14),
  `routes/sessions.ts` (177), `routes/memory.ts` (130),
  `routes/_body.ts` (24).

**View — `apps/gui/src/views/` shape:**

- `sessions-view.tsx` (187 LOC) — master shell + state + data
  loading + write-form orchestration. Composes `<SessionsList />`
  and `<SessionsDetail />`.
- `sessions-list.tsx` (83 LOC) — list pane: `role="listbox"` +
  rows, keyboard handler taken as a prop.
- `sessions-detail.tsx` (134 LOC) — detail pane: header, metadata
  grid (`<Field />`), end-action buttons, inline `<UpdateSessionForm>`.

**Behaviour preservation:** zero functional change. Same JSX, same
DOM events, same HTTP responses, same CSP header. All 165 GUI tests
green (165/165), 855/855 across 18/18 turbo tasks. Smoke:
`curl /api/health` returns 200 with CSP; `curl /api/projects` →
200; evil-origin → 403 `origin_forbidden`; OPTIONS preflight → 204.

**Lint posture:** `biome.json` `useSemanticElements` override extended
to include `apps/gui/src/views/sessions-list.tsx` (the `role="listbox"`
JSX moved there).

**No new deps. No changeset (private package).**

Spec: `docs/superpowers/specs/2026-05-10-oo-file-split-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-oo-file-split.md`.

## [2026-05-10] refactor | PP — hoist titleSchema to @megasaver/shared (#59)

Extracted the shared session title Zod schema from
`apps/cli/src/commands/session/shared.ts` into a new canonical module
`packages/shared/src/title.ts`. Both consumers (`@megasaver/cli` and
`apps/gui/bridge/zod-schemas.ts`) now import from `@megasaver/shared`.
Closes the silent-drift risk identified in code-reviewer finding M2 on PR #57.

Spec: `docs/superpowers/specs/2026-05-10-pp-titleschema-hoist-design.md`.
Plan: `docs/superpowers/plans/2026-05-10-pp-titleschema-hoist.md`.

## [2026-05-11] feat | BB1 — Session.tokenSaver schema + TokenSaverMode hoist (AA1 #1/11)

First sub-PR of the AA1 Context Gate epic
(`docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`).

`@megasaver/shared` gains a new closed enum `TokenSaverMode`
(`aggressive`, `balanced`, `safe`; AA3 alphabetic), its Zod
schema `tokenSaverModeSchema`, and `modeToBudget(mode): number`
(4_000 / 12_000 / 32_000 bytes). The mode lives in shared per
AA1 §2e (F-CRIT-1) so neither the GUI bridge nor
`@megasaver/output-filter` (future BB5) need to depend on
`@megasaver/core`. Tuple-ordering pinned in
`packages/shared/test/token-saver-mode.test-d.ts`.

`@megasaver/core` gains `tokenSaverSettingsSchema` +
`TokenSaverSettings` + `defaultTokenSaverSettings(now)` in a new
file `packages/core/src/token-saver.ts`. `sessionSchema` is
extended with an optional `tokenSaver` field. Backward compat is
hard-guaranteed via a fixture roundtrip
(`packages/core/test/fixtures/sessions-v0.4.json`, F-MED-5) —
pre-AA `sessions.json` rows parse cleanly with
`Session.tokenSaver === undefined`. `CoreRegistry` gains
`updateTokenSaver(sessionId, settings)` on both the in-memory
and the JSON-directory implementations (`session_not_found`
and `session_already_ended` error codes reused).

Risk LOW–MEDIUM. Additive schema delta, no behavior change for
existing surfaces. Blocks BB2 (`mega session saver`), BB5
(output-filter), BB6 (retrieval+stats), BB7a/b (orchestrator +
spawn), BB8 (mcp-bridge), BB10 (GUI panel), BB11 (doctor +
CONTEXT_GATE block).

## [2026-05-11] feat | BB2 — mega session saver CLI (AA1 #2/11)

Second sub-PR of the AA1 Context Gate epic. PR
<https://github.com/haJ1t/MegaSaver/pull/68> merged into `main`
(merge commit `4660d37`).

`mega session saver {enable,disable,status,stats}` ships under
`apps/cli/src/commands/session/saver/{enable,disable,status,stats,index}.ts`,
registered as the `saver` parent on the existing `session`
subcommand tree. All four take a positional `<session-id>`
parsed through `sessionIdSchema` at the CLI boundary; all four
carry `--store <dir>` + `--json` parity per §5a.

- `enable <id> --mode safe|balanced|aggressive` — calls
  `defaultTokenSaverSettings(now)` then overrides `enabled: true`,
  `mode`, `maxReturnedBytes: modeToBudget(mode)`, and persists via
  `CoreRegistry.updateTokenSaver` (BB1). `--mode` REQUIRED; invalid
  → `invalidModeMessage()` (new sibling of `invalidRiskMessage` in
  `apps/cli/src/errors.ts`, derived from
  `tokenSaverModeSchema.options`). Text line:
  `Mega Saver Mode enabled for <id> (<mode>; <bytes> B)`.
- `disable <id>` — rewrites the settings blob with `enabled: false`
  (BB7a's `disableContextGate` orchestrator was not yet available,
  so disable mutates the settings directly via `updateTokenSaver`).
- `status <id>` — reports current `tokenSaver` state (or
  not-enabled CTA when `session.tokenSaver === undefined`).
- `stats <id>` — reports the session token-saver stats. BB6 stats
  package not yet merged at BB2, so stats reads only what BB1
  persisted.

`--json` failure paths extended in
`apps/cli/test/json-failure-paths.test.ts` (invalid-mode,
missing-mode, not-found). Exit codes: 0 success, 1 expected error.
Risk MEDIUM. Depends on BB1; blocks BB10 (GUI consistency).

## [2026-05-11] feat | BB3 — @megasaver/policy package (AA1 #3/11)

Third sub-PR of the AA1 epic. PR
<https://github.com/haJ1t/MegaSaver/pull/69> merged into `main`
(merge commit `61efb28`).

New `packages/policy/` package — the security gate, promoted to
its own v0.5 package per AA1 §2b (NOT the v0.9 Advanced roadmap;
see [[decisions/policy-is-bb3]]). Two downstream consumers
(`output-filter` BB5 → `redact`, `mega output exec`/`mega_run_command`
→ `evaluateCommand`) need a single Zod-validated source of truth, so
hard-coding or deferred-TODO copies were rejected per `CLAUDE.md`
§13. Public surface (`packages/policy/src/index.ts`):

- `evaluateCommand(input): EvaluateCommandResult` — ALLOWED_COMMANDS
  allow-list + DANGEROUS_PATTERNS deny-list, matched against the
  full rendered command-line (`[command, ...args].join(" ")`). Carries
  the `MEGASAVER_ORIGIN_PID` env-marker re-entry guard (F-CRIT-3):
  an inherited marker that differs from `String(process.pid)` denies
  with `recursive_megasaver`.
- `evaluatePathRead(input): EvaluatePathReadResult` — default-deny
  secret-path denylist (`.env`, `.ssh/**`, `.aws/credentials`,
  `*.pem`, `*.key`, `id_rsa`, …). Added in Revision 2 (F-CRIT-2).
- `redact(text): RedactResult` — `{ redacted, count }` over the
  REDACTION_PATTERNS set (the actual regex corpus lives in BB5
  output-filter; policy owns the command/path gates and the redact
  entry-point).
- `policyDenyCodeSchema` / `PolicyDenyCode` — closed enum, 6 members
  alphabetic (AA3): `command_not_allowed`, `dangerous_pattern`,
  `intent_missing`, `path_denied`, `recursive_megasaver`,
  `secret_path_read`.

`loadProjectPermissions` / `ProjectPermissions` deliberately NOT
exported (F-MED-4 — no v0.5 consumer; the v0.9 permissions-file spec
adds them). Dependency: `@megasaver/shared` only (`ProjectId`);
dep-graph test enforces no core/output-filter import (§3c). Risk
HIGH — deny-list IS the contract; `architect` + `critic` mandatory.

## [2026-05-11] feat | BB5 — @megasaver/output-filter pipeline (AA1 #5/11)

Fifth sub-PR of the AA1 epic (merged before BB4 by PR number;
BB4 rebased on top — see BB4 entry). PR
<https://github.com/haJ1t/MegaSaver/pull/70> merged into `main`
(merge commit `ae41534`).

New `packages/output-filter/` package — the redaction-bearing
filter pipeline. `filterOutput(input): FilterOutputResult` is
**pure** (no IO): redact → normalize (strip ANSI, collapse CRLF) →
collapse repeated lines → chunk (`chunkByLines(40)` + specialised
test-output / ts-diagnostic / stacktrace parsers under
`src/parsers/`) → rank (`scoreChunk`) → dedupe (SimHash /
Hamming-distance, `src/simhash.ts`) → fit byte budget → summarize
(mode-dependent, deterministic, no LLM) → compose
(`bytesSaved`, `savingRatio`). Redact runs FIRST so secrets never
reach a persistence call (§11b critical ordering).

Public surface (`packages/output-filter/src/index.ts`):

- `filterOutput` + `filterOutputInputSchema` + `FilterOutputInput` /
  `FilterOutputResult` / `OutputExcerpt`. Input `mode` imports
  `tokenSaverModeSchema` from `@megasaver/shared` (the §2e cycle
  fix); `modeToBudget` is the single mode→cap source.
- `resolveSafeReadPath(input): ResolvedPath` — the structural
  sandbox gate (F-CRIT-2). Rejects symlink escapes, `..`-traversal,
  and absolute paths outside the project root; throws
  `OutputFilterError("path_unsafe")`. This is the only IO-touching
  export; callers compose it with `filterOutput`.
- `rankFeatureNameSchema` / `RankFeatureName` — 9-member closed enum
  alphabetic (AA3): `diagnosticScore`, `duplicatePenalty`,
  `errorScore`, `filePathScore`, `keywordScore`, `noisePenalty`,
  `recentFileScore`, `stackTraceScore`, `testFailureScore`.
- `outputSourceKindSchema` / `OutputSourceKind` — 4-member closed
  enum alphabetic: `command`, `fetch`, `file`, `grep`. The shared
  source discriminator consumed by `content-store` (BB4) and `stats`
  (BB6) — single source of truth, no local duplication.
- `OutputFilterError` + `outputFilterErrorCodeSchema`
  (`path_unsafe`, `validation_failed`) + `RankFeatures` / `RankedChunk`.

Imports `policy.redact` (BB3). Dependencies: `@megasaver/shared` +
`@megasaver/policy` — explicitly NOT `@megasaver/core` (§2e/§3c
cycle guard; dep-graph test enforces). Redaction tested by both a
fast-check property test and a fixture corpus (F-MED-1). Risk HIGH —
secret-leakage failure mode; `security-reviewer` audit mandatory.

## [2026-05-11] feat | BB6 — @megasaver/retrieval + @megasaver/stats (AA1 #6/11)

Sixth sub-PR of the AA1 epic — two packages in one PR. PR
<https://github.com/haJ1t/MegaSaver/pull/71> merged into `main`
(merge commit `6078dc9`).

**`packages/retrieval/`** — standalone, local-only retrieval (no
embedding API, no remote vector store per `CLAUDE.md` §1).

- `rankBm25(input): Bm25Result` — in-memory BM25 over chunked text;
  index built per-call (no persistent inverted index at v0.5,
  chunk counts < 1000). Inputs `Bm25Document` / `Bm25RankInput`.
- `deriveIntent(input): DerivedIntent` — `{ query, keywords, source }`
  with `derivedIntentSourceSchema` / `DerivedIntentSource` closed
  enum, 6 members alphabetic (AA3): `auto`, `command`, `explicit`,
  `file-path`, `recent-memory`, `session-title`. Precedence walk
  per §12c (explicit → session-title → recent-memory → command →
  file-path → auto).
- `RetrievalError` + `retrievalErrorCodeSchema` (`invalid_input`).
- Dependency: `@megasaver/shared` only (NOT policy, NOT core; §3c).

**`packages/stats/`** — token-saver event ledger + session summary.

- `appendEvent(input)` — append-only event written to
  `<store>/stats/<projectId>/<sessionId>.events.jsonl`.
- `readSummary(...)` / session summary at
  `<store>/stats/<projectId>/<sessionId>.json` (atomic write,
  own `src/atomic-write.ts` — no core import).
- `resetOnDisable(...)` — §13c reset semantics: keep events JSONL
  (audit trail), zero the session-summary totals.
- `tokenSaverEventSchema` / `TokenSaverEvent` and
  `sessionTokenSaverStatsSchema` / `SessionTokenSaverStats`. Event
  `sourceKind` type-imports `OutputSourceKind` from
  `@megasaver/output-filter` (F-MAJ-4; no local enum). `mode` imports
  `tokenSaverModeSchema` from `@megasaver/shared`.
- `StatsError` + `statsErrorCodeSchema` (`schema_invalid`,
  `store_corrupt`, `write_failed`).
- Dependencies: `@megasaver/shared` + `@megasaver/output-filter`
  (NOT policy, NOT core; §3c).

Risk MEDIUM. Both ship `dependency-graph.test.ts` per §3c.

## [2026-05-11] feat | BB4 — @megasaver/content-store (AA1 #4/11)

Fourth sub-PR of the AA1 epic. Merged AFTER BB5/BB6 by PR number
(it depends on BB5's `OutputSourceKind`, so it rebased on top). PR
<https://github.com/haJ1t/MegaSaver/pull/72> merged into `main`
(merge commit `a8b6531`).

New `packages/content-store/` package — ChunkSet persistence under
`<store>/content/<projectId>/<sessionId>/<chunkSetId>.json`. Public
surface (`packages/content-store/src/index.ts`):

- `saveChunkSet`, `loadChunkSet` (throws `ContentStoreError("not_found")`
  on miss), `listChunkSets`, `deleteChunkSet`, `pruneOlderThan` —
  callers pass the resolved `storeRoot` and an explicit clock for
  prune (no `Date.now()` at module level).
- `chunkSchema` / `Chunk`, `chunkSetSchema` / `ChunkSet`,
  `ChunkSetSummary`. The `ChunkSet.source` discriminated union uses
  `OutputSourceKind` imported from `@megasaver/output-filter` (§10d).
  The `redacted` boolean invariant: a chunkSet from a session with
  `redactSecrets === true` must be `true` (F-MAJ-3).
- `ContentStoreError` + `contentStoreErrorCodeSchema` — 4 members
  alphabetic (AA3): `not_found`, `schema_invalid`, `store_corrupt`,
  `write_failed`.

**Cycle fix (locked, §3c):** content-store does NOT import
`@megasaver/core`. Its atomic write is implemented in-package
(`src/atomic-write.ts`, ≈ 50 LOC mirroring `json-directory-store.ts`
semantics — POSIX dir-fsync, win32-aware) rather than reusing core's,
specifically so the `content-store → core` edge never closes. The
resolved `storeRoot` is passed in by the caller; content-store never
calls `resolveStorePaths` itself. See [[decisions/content-store-no-core-edge]].
Dependencies: `@megasaver/shared` + `@megasaver/output-filter`
(OutputSourceKind type). Risk MEDIUM; dep-graph test enforces the
no-core rule.

## [2026-05-11] feat | BB7a — mega output {file,filter,chunk} CLI (AA1 #7a/11)

Seventh sub-PR of the AA1 epic (BB7 was split into BB7a HIGH /
no-spawn and BB7b CRITICAL / spawn per Revision 2). PR
<https://github.com/haJ1t/MegaSaver/pull/73> merged into `main`
(merge commit `67d66dc`).

`mega output {file,filter,chunk}` ships under
`apps/cli/src/commands/output/{file,filter,chunk,index,shared,locate-chunk-set}.ts`,
registered as a new top-level `output` parent. `exec` (the only
spawning subcommand) is held for BB7b.

- `output file <id> --intent <s> <path>` — runs the two-gate read
  safety check then filters: `policy.evaluatePathRead` (denylist) →
  `outputFilter.resolveSafeReadPath` (sandbox) → `fs.readFile` →
  `filterOutput` → `contentStore.saveChunkSet`. Path-denial exits 1
  with `path_denied: <reason>`; sandbox throw exits 1 with
  `path_unsafe: <message>`.
- `output filter <id> --intent <s> --file <log-path>` — no-spawn
  variant over an existing log file (pipe `pnpm test > log.txt`).
- `output chunk <chunk-set-id> <chunk-id>` — returns a single stored
  chunk; no `--intent` (chunk-set ids are globally unique;
  `locate-chunk-set.ts` resolves ownership via the embedded
  project/session path).
- `--intent` REQUIRED for `file` / `filter` → `intent_required`
  otherwise. `--store` + `--json` parity; JSON failure paths
  extended in `apps/cli/test/json-failure-paths.test.ts`.

**Shipped-vs-spec deviation (noted):** AA1 §2a/§8d proposed a
`packages/core/src/context-gate/` orchestrator (`run.ts` etc.) shared
by CLI and MCP. As shipped, BB7a composes the pipeline CLI-side in
`apps/cli/src/commands/output/shared.ts` (`resolveEffectiveSettings`,
`runTwoGates`, `readAndFilter`, `persistChunkSet`) — there is no
`context-gate/` directory in core yet, and core gained no new package
deps (still `@megasaver/shared` + `zod` only). No `@megasaver/stats`
wiring in BB7a either (file/filter persist chunkSets but do not yet
append stats events). The shared-orchestrator extraction and stats
wiring are deferred to BB7b / BB8. Pre-AA sessions (no `tokenSaver`)
get read-only defaults (mode `balanced`) rather than a written record.
Risk HIGH.

## [2026-05-13] feat | CC — v1.0 closeout: e2e + docs + release tag (AA1 capstone)

Capstone PR for the AA1 epic. No feature code — proves the AA1 §1
v1.0 done-list end-to-end and prepares the `v1.0.0` tag.

- **e2e** — `apps/cli/test/e2e/v1-closeout-flow.test.ts` walks plan
  L1672–L1702: project+session → `session saver enable --mode balanced`
  → `output exec -- node …` (savingRatio present, chunkSet + stats
  written) → `mcp repair` + `connector sync` (CONTEXT_GATE block
  coexists with legacy block) → in-process GUI bridge serves
  `/token-saver/{status,stats}` and the AgentSetupDoctor `/api/mcp/*`
  leg. Shells the real built `apps/cli/dist/cli.js`. Live-adjusted
  (test-only) to merged behavior: literal `node` command (exact-string
  allow-list), positional `projectName` on connector sync/status,
  `{ enabled, settings }` status shape, `agentId`-keyed mcp-status
  array, connectorSynced via the agent's open session.
- **enum audit** — `apps/cli/test/enum-pin-audit.test.ts` asserts all
  8 AA1 §17 pin files present + non-empty (9 assertions).
- **docs** — README "Mega Saver Mode" section (modes, savings,
  raw/sent viewer, doctor, MCP tools); `mcp-bridge` folded out of
  Future packages. New `mcp-bridge` wiki entity page; AA1 subsections
  appended to `core`/`gui`/`cli`/`connectors-shared` (the stale
  core.md "as of BB7a" boundary note marked superseded by PR #75).
- **release** — coordinated `major` changeset
  (`.changeset/cc-v1-release.md`); `pnpm version-packages` →
  1.0.0 across 14 packages + per-package CHANGELOGs; `pnpm verify`
  green. Annotated tag `v1.0.0` is a user-gated step (parent runs it);
  publish deferred to CI (packages `private`, no registry auth).
- **§2a** — orchestrator extraction outcome recorded in
  `wiki/decisions/context-gate-extraction.md` (553 LOC > 500 →
  extraction queued as BB12).

## [2026-05-13] decision | Context Gate extraction (AA1 §2a) recorded

`wc -l packages/core/src/context-gate/*.ts` = 553 LOC (> 500) →
EXTRACT, queued as BB12 (deferred to its own PR; spec/plan landed in
PR #82). Recorded in `wiki/decisions/context-gate-extraction.md`.
PR #75 (extraction evaluation): MERGED — created the folded
`packages/core/src/context-gate/` directory.

---

## [2026-05-13] feat | BB7b + BB8 + BB11 epic ships (PRs #80, #83, #84) — critical path to v1.0.0

The three CRITICAL building blocks that complete the AA1 "Mega Saver
Mode" shipping arc (spec `docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`):

- **PR #80 — BB7b** (`mega output exec`): child-process spawn orchestrator
  (`runOutputExecCommand`) lands as the `exec` subcommand of the existing
  `output` tree. Env-marker `MEGASAVER_ORIGIN_PID` inserted into the
  spawned process's env to prevent recursive invocations (deny-before-spawn
  guard). Policy `evaluateCommand` fires BEFORE spawn; redact fires BEFORE
  store. Same `runOutputPipeline` used by `mega_run_command` (AA1 §8d
  "one orchestrator, two entry points").
- **PR #83 — BB8**: real `@megasaver/mcp-bridge` over `stdio`. Replaced the
  v0.3 `not_implemented` placeholder with a four-tool server:
  `mega_fetch_chunk`, `mega_read_file`, `mega_recall`, `mega_run_command`.
  CLI gains `mega mcp {install,repair,status,uninstall,serve}`.
  `buildMcpSetupOps` facade drives the setup surface. 16-member
  `McpBridgeErrorCode` replaces the single `not_implemented`. `McpToolName`
  (4-member) pinned in `.test-d.ts`.
- **PR #84 — BB11**: GUI `AgentSetupDoctor` view + additive
  `MEGA SAVER:CONTEXT_GATE` connector block. Bridge gains `/api/mcp/*`
  routes (`install`, `repair`, `status`, `uninstall`). Each agent row
  carries a `restartHint` string. `connectors-shared` renders the
  CONTEXT_GATE block coexisting with (not replacing) the legacy block.

## [2026-05-13] fix | WCAG AA contrast fixes — a11y (PRs #85, #87)

Two-PR accessibility sweep to bring all GUI text to ≥4.5:1 contrast ratio:

- **PR #85**: accent colour `#c4681a` → `#a25616`; muted text retuned.
- **PR #87**: active nav-item and chip text switched from accent to
  `text-primary`.

## [2026-05-13] release | v1.0.0 tagged (PR #86)

v1.0 closeout merge PR. Annotated tag `v1.0.0` created. End-to-end
acceptance tests [A1]–[A8] (AA1 §17). All 14 packages at 1.0.0.
`pnpm verify` green.

## [2026-06-03] feat | BB12 executed — @megasaver/context-gate extracted (PR #88)

BB12 performed the extraction queued by the v1.0 closeout decision.
The 605-LOC orchestrator directory moved from `packages/core/src/context-gate/`
to the new standalone `packages/context-gate/` package
(`@megasaver/context-gate@0.2.0`):

- `runOutputPipeline`, `runOutputExecCommand`, `fetchChunk`,
  `loadProjectPermissions` are the exported orchestration functions.
- `OrchestratorRegistry` is a structural port of the original
  `CoreRegistry` interface; `context-gate` never imports `@megasaver/core`
  (zero core dep — breaks the cycle AA1 §3c warned against).
- `@megasaver/core` re-exports the entire `context-gate` surface so
  all existing callers (`mega output exec`, `mega_run_command`, …) import
  via core unchanged.
- Dependency-direction guard (`dependency-graph.test.ts`) relocated to
  the new package.
- `context-gate` deps: `content-store`, `output-filter`, `policy`,
  `shared`, `stats`, `yaml`.

Source: [[decisions/context-gate-extraction]], [[entities/context-gate]].

## [2026-06-03] release | v1.0.1 tagged (PR #89)

Patch release bundling the a11y changesets (#85, #87) and the BB12
extraction changeset (#88). Annotated tag `v1.0.1` created.

## [2026-06-03] feat | CI pipeline + standalone bundle (PRs #90, #91, #93, #94)

Two interrelated infra tracks that close the distribution story:

**CI (PRs #90, #93):**

- **PR #90**: `.github/workflows/ci.yml` added — `pnpm verify` runs on
  every PR and push; Node 22; Turborepo cache. Closes MM#62 by wiring
  `turbo typecheck dependsOn ["^build"]` so cold `pnpm verify` is
  self-sufficient.
- **PR #93**: adds `build` to `typecheck dependsOn` (the `^build`
  covers deps, the naked `build` covers the package itself). Completes
  the MM#62/CC#90 family.

**Standalone bundle (PRs #91, #94):**

- **PR #91**: `apps/cli/dist-bundle/mega.mjs` built via a second tsup
  config (`tsup.bundle.config.ts`, `noExternal: [/.*/]`, `version-define`,
  `createRequire` banner). `.github/workflows/release.yml` uploads it to
  GitHub Releases on every `v*` tag. npm publish gated on `NPM_TOKEN`
  (maintainer secret). Strategy: published `@megasaver/cli` carries zero
  runtime deps; workspace internals stay private.
- **PR #94**: hardened version source (env→define, removed stray
  `MEGA_CLI_VERSION`); `prepack`/`postpack` strips workspace devDeps from
  the published manifest.

## [2026-06-03] feat | Advanced roadmap: parsers + ranker + permissions (PRs #92, #95, #96)

- **PR #92** (`output-filter` parsers): pytest/go/cargo/eslint format
  detection and parsing added under `src/parsers/`. These are ordered
  BEFORE the generic `test-output` parser in the `chunkByFormat` cascade,
  so language-specific structured output is parsed with higher fidelity.
- **PR #95** (`output-filter` ranker): `rank.ts` ERROR-signal matcher
  extended to recognise CamelCase `*Error` suffixes and the Rust/Go
  `panicked` signal. Failure chunks now score non-zero in the ranker.
- **PR #96** (`policy` permissions): `.megasaver/permissions.yaml`
  tighten-only project permission rules. `policy.parseProjectPermissions`
  (pure, Zod-validated) + `context-gate.loadProjectPermissions` (yaml@^2
  I/O). `policy_load_failed` deny-code added. Four invariants enforced:
  tighten-only, deny-precedence, fail-closed, path-glob. Adversarially
  security-reviewed (HIGH risk).

## [2026-06-04] feat | GUI observability (PR #97)

- Token-savings inline-SVG chart added to the `TokenSaverPanel`.
- Raw-output retention controls: `GET /api/sessions/:id/raw-output/summary`
  + two-click destructive clear (session-scoped). `<output>` element
  carries `aria-live` for screen-reader announcements.

## [2026-06-04] fix | CI hotfix (PR #98)

- Biome format fix for retention test code introduced in PR #97.
- `NPM_TOKEN` gate moved to a `gate` job at the job level (previously
  the step-level condition was evaluated too early). Restores main green.

## [2026-06-04] release | v1.1.0 tagged (PR #99)

Advanced-roadmap release. Bundles: parsers (#92), ranker (#95),
permissions (#96), GUI observability (#97). Annotated tag `v1.1.0`
created. Package versions: cli 1.0.2, core 1.0.2, context-gate 0.2.0,
mcp-bridge 1.0.2, output-filter 1.1.0, policy 1.1.0, gui 1.1.0,
stats 1.0.1, retrieval 1.0.0, content-store 1.0.1, shared 1.0.0.

## [2026-06-04] chore | tsup bundle config header fix (PR #100)

Corrected `tsup.bundle.config.ts` header comment — both
`tsup.config.ts` and `tsup.bundle.config.ts` inline the entire
workspace graph via `noExternal`. Docs-only; no behaviour change.

## [2026-06-10] feat | stats wiring completion (PR #102)

Gap A: runOutputPipeline now appends a sourceKind:"file" TokenSaverEvent
(mirrors exec path); RunOutputResult widened with store_write_failed
(also wraps the previously-unwrapped persistChunkSet throw); mapped in
mega output file/filter + MCP mega_read_file. Gap B: mega session saver
stats reads readSummary via core re-export (BB6 stub retired; text
totals + eventStats in --json). Core re-exports stats surface so
apps/cli keeps its dependency-graph pin. Spec/plan:
docs/superpowers/{specs,plans}/2026-06-10-stats-wiring-completion-*.md.
pnpm verify green; smoke: output file → saver stats shows events: 1.

## [2026-06-10] feat | skill-packs real implementation (PR #103)

Last placeholder subsystem made real (risk HIGH; architect pass
GO-WITH-CHANGES folded into spec). loadPack with containment +
symlink guards; discoverPacks (workspace beats global, skip+warn);
shadow-aware scanSkillIdConflicts; atomic installPack (.tmp staging);
removePack; `mega pack {install,list,remove,info}` CLI with --root +
--json parity. Error enum widened to 7 members (not_implemented
retired). apps/cli dependency allow-list admits skill-packs. 74 new
tests across library + CLI; pnpm verify green; e2e smoke round-trip
captured. Spec/plan: docs/superpowers/{specs,plans}/2026-06-10-skill-packs-real-*.md.

## [2026-06-11] feat | Windows port remainder COMPLETE (PRs #104–#108)

Full Windows support; deferral spec 2026-05-10-windows-port-deferral.md
superseded. Sub-PRs: #104 docs (spec+plan); #105 (B) CRLF mixed-EOL
drift fix (normalizeEol); #106 (C) lowercase id contract; #107 (A)
win32 store path (%LOCALAPPDATA%, HOME→USERPROFILE, readStoreEnv
boundary, ~19 call sites, GUI bridge + skill-packs resolvers); #108 (D)
windows-latest CI matrix. Audit found deferral-spec claims largely
stale (case-collision theoretical — lowercase UUIDs). The windows-latest
leg surfaced + fixed real Windows bugs only a real runner shows:
.gitattributes LF (biome/autocrlf), atomic-write open temp `r+` for
FlushFileBuffers (core/stats/content-store), POSIX-only dir-fsync test
guard, per-OS symlink/chmod test skips, host-independent path
assertions. HIGH risk; architect + critic (REVISE→ACCEPT on A). Both
CI legs green. Deferred follow-ups: 2-process lock test, tsconfig
test-typecheck, mcp HOME fallback. See concepts/windows-support.md.

## [2026-06-11] feat | mcp HOME→USERPROFILE fallback (PR #109)

`mega mcp {status,install,uninstall}` read `process.env.HOME ?? ""` with no
USERPROFILE fallback → empty/relative agent-config paths on Windows. Extracted
`resolveHomeDir(env)` into apps/cli/src/store.ts (HOME→USERPROFILE→""), reused
in readStoreEnv (DRY) + the 3 mcp boundaries. detect-agent.ts config paths are
uniform join(home, …) so no platform branch needed. Unit-tested; verify green
both CI legs.

## [2026-06-11] fix | test-typecheck no-op + 113 pre-existing errors (PR #110)

apps/cli + apps/gui tsconfig.test.json extended a base whose exclude:["test"]
was inherited (TS does not merge exclude across extends), so `tsc -p
tsconfig.test.json` checked ZERO test files — a silent no-op. Added
exclude:["dist","node_modules",".turbo"] (cli also "test/e2e/**") so include
wins. Surfaced 109 (cli) + 4 (gui) pre-existing type errors — all fixed in test
files (bracket access, branded `as`, narrow citty-arg casts, ambient .d.mts for
a .mjs script); no src changes, no any/@ts-ignore. e2e excluded (cross-package
source import via ../../../../apps/gui; still run by vitest). Now 33 cli + 38
gui test files actually type-checked. code-reviewer ready-to-merge; both CI
legs green.

## [2026-06-11] query | "update wiki incl. remaining roadmap" → updated post-v1.1-roadmap.md

Post-v1.1 arc summarized (PRs #102–#110 resolved). Remaining roadmap re-ranked:
(1) npm publish [needs maintainer NPM_TOKEN], (2) conventions:sync→CLAUDE.md,
(3) GUI native packaging, (4) i18n tr, (5) fikri §16 backlog. Deferred
follow-ups tracked (2-process lock test, e2e typecheck gap).

## [2026-06-11] housekeeping | roadmap remaining-items pass (wiki side)

User: "complete remaining roadmap items in order." Wiki-completable items done:
(1) wrote pending entity page entities/conventions-sync.md — scripts/conventions-sync/
CONSUMERS (AGENTS.md + 3 .cursor/rules/*.mdc), docs/conventions/ source-of-truth,
CLAUDE.md gap (#2), distinct from `mega connector sync --target aider` product
feature. (2) Fixed syntheses/mega-saver-product.md stale "plan execution pending"
→ v1.1-shipped reality. (3) Struck stale v0.3 "connector aider sync" (shipped PR
#21 184b13d + #29). Updated index.md (entities list + cleared pending note + date)
and roadmap housekeeping section. Code items #1–#5 NOT done here: #1 npm publish
BLOCKED on maintainer NPM_TOKEN; #2–#5 need superpowers chain (multi-session).

## [2026-06-11] lint | index.md v0.3 "open backlog" 4/5 stale → struck

Lint of index.md:244 "v0.3 — open backlog (deferred to v0.4)": mcp-bridge real
impl (shipped PR #83 0e9be7a BB8), skill-packs real impl (PR #103), Windows port
remainder (PRs #104–#108 + #109/#110), connector aider sync (PR #21+#29) all
struck with citations. Only "CLAUDE.md tagged blocks" (roadmap #2) remains open.
No contradictions introduced; all new `[[links]]` resolve; conventions-sync not an
orphan (inbound from index.md + roadmap).

## [2026-06-11] feature | roadmap #2 conventions:sync → CLAUDE.md (PR #112)

Made CLAUDE.md a managed conventions:sync consumer (§0 wiki-first + §1–§13,
placed first). Full superpowers chain: spec→plan→TDD→reconcile→verify→critic→PR.
KEY DISCOVERY: billed "small/cosmetic" but a normalized scan then a 13-agent
adversarial audit showed CLAUDE.md had drifted from docs/conventions/*.md;
sources were already a content SUPERSET for 11/13 sections (sim 0.35–1.00).
Real work = HIGH-risk per-section reconciliation. Enriched 2 sources
(stack-and-commands config filenames; multi-agent-dogfood source-of-truth +
synced-reality, dropping the now-false "CLAUDE.md canonical/manual" block).
Promoted hand-added §0 to agent-neutral wiki-first.md → regenerated into
CLAUDE.md + AGENTS.md. Engine fact: sync REPLACES existing sentinel blocks,
never inserts → one-time hand-bootstrap of 14 sentinel pairs then --write.
Evidence: conventions:test 53/53; pnpm verify green (30 turbo tasks +
conventions:check 5/5 ok); critic verdict ship (no content loss, no
agent-specific leak). Branch feat/conventions-sync-claude-md, 8 commits.

## [2026-06-11] merge | PR #112 conventions:sync → CLAUDE.md (main @ c2ee52a)

Roadmap #2 merged. CLAUDE.md is now a managed conventions:sync consumer; dogfood
drift fully closed (all agent files regenerate from docs/conventions/). Wiki
updated open→shipped: entities/conventions-sync, post-v1.1-roadmap, index.

## [2026-06-11] ingest+synth | Phase 0–10 strategic roadmap (DIMMEM/LAMR/FORGE)

Ingested ~/Desktop/MegaSaver_Roadmap.txt (Phase 0–10 product roadmap) and
produced planning artifacts (docs + wiki only, no code). Reconciled every phase
against shipped v1.1 via a 22-agent workflow (11 map + 11 adversarial verify).
RESULT done/partial/gap: P0 partial, P1 partial (DIMMEM enrichment net-new), P2
gap, P3 partial (LAMR task-aware net-new), P4 partial (4 tools locked by AA1;
wider surface rides on P1/2/5), P5 gap, P6 gap, P7 gap, P8 partial (token-byte
stats only), P9 partial, P10 gap. Verifier nuance captured: P1/P4 "done vs
locked v0.1/v1.0 spec" but "partial vs roadmap vision" — both framings
documented. Wrote: syntheses/contextops-roadmap (master), sources/roadmap-
phases-v2, concepts/{structured-memory-engine,semantic-repo-index,context-
pruning-engine}; full spec+plan for the 3 near-term gap phases (1 DIMMEM,
2 repo-index, 3 LAMR) under docs/superpowers/{specs,plans}/2026-06-11-phase{1,2,3}-*.
Phases 4–10 stay roadmap-level. index.md + post-v1.1-roadmap cross-linked.
Branch docs/contextops-roadmap-phases (PR #113). Process: brainstorming (scope
locked via AskUserQuestion: docs-only / master+near-term / reconcile) → authored
solo for cross-doc coherence after the parallel code audit.

## [2026-06-11] feat | Phase 1 DIMMEM memory engine (registry + CLI + MCP)

Roadmap Phase 1 read/write surface over the typed memory schema, on branch
feat/phase1-structured-memory (PR #114). THREE TDD slices + two review passes,
all green via pnpm verify (30/30 tasks; core 230, cli 469, mcp-bridge 68,
connectors-shared 74, gui 252).
- Core: CoreRegistry.updateMemoryEntry/deleteMemoryEntry/searchMemoryEntries
  (mutable-in-place; BM25 via @megasaver/retrieval over title+content+keywords;
  stale excluded by default). memory-search.ts + memoryEntryUpdatePatchSchema.
  Bug found+fixed by TDD: delete-all wrote a zero-byte JSONL that readJsonLines
  rejected → writeMemoryEntriesForProject now removes the file on empty.
- CLI: mega memory create typed flags (--type/--title/--keyword/--confidence/
  --source/--reason/--goal/--file/--expires, optional w/ neutral defaults) +
  new search/update/delete(--yes)/explain subcommands.
- MCP: save_memory, search_memory, get_relevant_memories (closed enum 4→7).
Smoke: real `mega` run of create→search→explain→update(stale)→delete loop
captured (stale excluded from default search; delete refuses without --yes).
Review: code-reviewer + critic both ship (fresh contexts); first pass fix-first
(boundary validation, backfill guard, rm-error) → confirming pass clean.

## [2026-06-11] feat | Phase 2 Semantic Repo Index (@megasaver/indexer)

Roadmap Phase 2 on branch feat/phase2-semantic-index. New leaf package
@megasaver/indexer + CLI surface, 6 TDD slices + 2 review passes, pnpm
verify green (32 tasks; indexer 33 tests). See [[entities/indexer]],
[[concepts/semantic-repo-index]] (status gap→shipped).
- CodeBlock schema (8 types) + CodeBlockId in shared.
- extractTs (TypeScript compiler API): fn/class/interface→schema/arrow;
  PascalCase+tsx→component; *.test→test. extractMd (ATX sections +
  (intro)), extractJson (top-level keys + package.json script:<name>,
  key-anchored lineOf).
- scanRepo: traversal-safe, never follows symlinks; always-ignore +
  .gitignore + .megaignore (ignore lib); skips secret/binary/oversized.
- buildIndex: atomic store (blocks.jsonl + manifest.json), contentHash
  incremental, self-heals corrupt/torn index by re-extracting.
- searchBlocks BM25 (in the package, NOT the CLI — §3c forbids a
  CLI→retrieval edge; dependency-graph guard updated to allow indexer).
- CLI mega scan + mega index build/status/search/show. typescript is a
  CLI runtime dep, externalized from the bundle (it uses __filename at
  load, cannot inline into ESM) — single-file bundle no longer strictly
  zero-dep for the index feature.
Smoke: dogfood on the indexer package itself — build added 21 files/71
blocks; search "extract typescript ast" ranked extractJson/Md/Ts first;
rebuild unchanged=21. Review: code-reviewer + critic fix-first
(self-heal, key-anchored lineOf, ENOENT-only ignore swallow) →
confirming pass + security-reviewer.

## [2026-06-11] feat | Phase 3 Context Pruning / LAMR (@megasaver/context-pruner)

Roadmap Phase 3 on branch feat/phase3-context-pruning. New leaf package
@megasaver/context-pruner + CLI + MCP, 6 TDD slices, pnpm verify green
(34 tasks). See [[entities/context-pruner]], [[concepts/context-pruning-engine]]
(status partial→shipped).
- score.ts: 8-factor model (semantic normalized-BM25, userMention
  near-decisive, testFailure/recentEdit/memory from passed-in file sets,
  stale/noise penalties) + named WEIGHTS; memory relevance is DATA in
  (no core edge, §3c).
- select.ts: force-include named/failing (safety invariant — never
  silently dropped; budget overflow reported via usedTokens), fill to
  limit under token budget (line-span estimate; blocks carry no text so
  spec's chars/4 N/A), dependency closure over `calls`.
- pack.ts buildContextPack + reasons; audit.ts savings (feeds Phase 8).
- CLI mega context build/explain/audit/export; MCP get_relevant_context
  /get_relevant_code_blocks/explain_context_selection/
  get_context_budget_report (closed enum 7→11).
Smoke ("fix the login bug"): login ranked #1 (named in task + cited by
memory + semantic), 5 blocks → 2 included, tokens 120→48, saved 60%.

## [2026-06-12] schema | Phase 9 multi-agent connectors

Branch `feat/phase9-connectors`. Spec:
`docs/superpowers/specs/2026-06-12-phase9-connectors-design.md`.
Plan: `docs/superpowers/plans/2026-06-12-phase9-connectors.md`.

Result: `pnpm verify` green (lint 704 files, typecheck all 17 packages,
541 cli tests / 46 test files, conventions:check ok). Task 8 required
no `main.ts` edit — `connector: connectorCommand` was already registered
and `list`/`doctor` were already wired in `connector/index.ts`.

Changes:
- `@megasaver/shared`: `agentIdSchema` 5→8 members (continue, gemini,
  windsurf; alphabetical). Both drift-guard test files updated.
- `@megasaver/connector-generic-cli`: `geminiTarget`, `windsurfTarget`,
  `continueTarget` frozen objects; `builtinTargets` 3→6.
- `@megasaver/cli`: `KNOWN_TARGETS` 4→7; `mega connector list` +
  `mega connector doctor` commands; cross-agent integration test proves
  project memory lands byte-identically in two agent files.
- `@megasaver/gui`: `AGENT_LABEL` record + `AGENT_IDS` tuple + bridge
  mirror updated for three new agents.

Wiki pages updated: `entities/connectors-generic-cli`,
`entities/shared`, `entities/cli`, `syntheses/contextops-roadmap`
(Phase 9 partial→done), `index.md` (Phase 9 status block).

## [2026-06-12] feat | Phase 10 Team/Cloud (local approval slice)

MemoryEntry.approval (suggested|approved|rejected), backfill→approved.
Gate: search (incl. relevant/context-pack) + buildConnectorContext (CLI
+GUI) + get_project_context + mega_recall. CLI approve/reject + --all;
approve_memory MCP tool (24→25); buildPrMemoryComment + mega github
pr-comment. Team = shared store + gate. Cloud/auth/deploy/org/hosted-
audit/web-UI/visibility deferred. Spec+plan 2026-06-12-phase10-team-cloud.

Roadmap complete through all 10 phases.

Wiki pages updated: `entities/core` (approval field + gate point 1 +
buildPrMemoryComment), `entities/mcp-bridge` (25 tools, approve_memory,
gated tools), `entities/cli` (approve/reject, --all, github pr-comment,
connector gate), `syntheses/contextops-roadmap` (Phase 10 done, roadmap
complete, deferred-cloud items recorded), `index.md` (Phase 10 status block).

## [2026-06-12] docs | README + wiki refresh for completed 10-phase ContextOps roadmap

Documentation-only pass on branch `docs/readme-wiki-roadmap-complete`
(off main `f1fe1d3`, all 10 phases merged). No code changes.

README.md:
- Status line → all 10 ContextOps phases complete on `main` (PRs
  #114–#123); kept package versions (cli 1.0.2, gui 1.1.0, core 1.0.2).
- New "The ContextOps layer" section (per-phase engine table) + TOC entry.
- New "MCP tools" section listing all **25** tools grouped (memory /
  context / rules-failures / tasks / routing-audit), descriptions copied
  verbatim from `packages/mcp-bridge/src/server.ts` `TOOL_DEFS`.
- CLI reference: added memory (approve/reject/search --all/update/delete/
  explain), scan, index, context, fail, rules, learn, task, tools, audit,
  connector list/doctor, github pr-comment — all from `apps/cli` source.
- Connectors: 4 → **7** targets (added gemini/windsurf/continue);
  vscode/jetbrains + `mega connect` noted deferred.
- Architecture diagram + repo-layout + Mega Saver Mode MCP note updated
  (indexer, context-pruner, 25 tools). Roadmap section: all 10 phases
  shipped + deferred cloud-SaaS slice listed.

Wiki:
- `syntheses/contextops-roadmap.md`: reconciliation table now shows all
  10 phases `done` + PR refs + concept links (kept the original audit
  done/partial/gap framing as a second column); phase-detail headings
  4–8 → "done (was …)" with shipped notes; planning-artifacts now lists
  all 10 specs; build-order section reframed past-tense.
- New concept pages (matching existing style): `failed-run-learning`
  (FORGE), `task-engine`, `tool-router`, `audit-dashboard`,
  `memory-approval`. Cross-linked into index + roadmap synthesis.
- Entity consistency fixes — the phase batches had updated entities for
  Phases 9–10 only: added Phase 1/5/6/7 entity summary to
  `entities/core.md`, Phase 2/3/5–8 command groups to `entities/cli.md`,
  Phase 8 audit section to `entities/stats.md`. Confirmed
  `entities/{mcp-bridge,shared,connectors-generic-cli}` already accurate
  (25 tools / 8 agent ids / 6 generic-cli targets).
- `index.md`: 5 new concept links, quick-links rows, synthesis blurb,
  date bump.

Verify: `pnpm conventions:check` green (README + wiki are not
conventions-managed; ran to confirm CLAUDE.md/AGENTS.md/.cursor untouched).

## [2026-06-12] lint | dead wiki-link sweep

Scanned all 425 `[[wiki-links]]` across `wiki/`. One genuine broken
target: `index.md` linked `[[specs/2026-05-10-windows-port-deferral]]`
(no `wiki/specs/` folder — the doc lives at
`docs/superpowers/specs/2026-05-10-windows-port-deferral.md`). Fixed to
the backtick path, matching the same doc's two other references in
`index.md` (lines 312, 351). The other two `[[...]]` matches are false
positives that render as code, not links: the prose word `[[links]]`
in an older log line and the syntax example `[[wiki-link]]` in
`wiki/CLAUDE.md` §page-format. All real wiki-links now resolve.

## [2026-06-14] feat | Proxy Mode v1.2 — 7 phases shipped

Implemented the full Proxy Mode v1.2 roadmap (spec+plan vendored to
docs/superpowers/{specs,plans}/2026-06-12-proxy-mode-v1.2-*). Branch
feat/proxy-mode-v1.2, 7 commits, each TDD → pnpm verify green → external
review → changeset. Full verify 30/30 tasks, 1828 tests.
Phases: P0 tool naming mode (49b002e), P1 output classifier (c356e04),
P2 vitest/tsc compressors + passthrough (6f65d10), P3 proxy_search_code
(31bd0d7), P4 flagged engine-aware ranking (7a3c85b), P5 hook installer +
adoption/interception metrics + connector bias (07040de), P6 replay trace
(3873ae0). Reconciliations (repo vs spec, "confirm in repo" resolved):
grep not rg (LOCKED allowlist; rg/index-first → v1.3), retrieval = in-memory
BM25 (no persistent index), no P0 stubs (§13), mega_recall unrenamed,
MEGASAVER_ENGINE_RANKING default off. P3/P5 implemented via delegated
executor agents, independently re-verified + reviewed (P3 +path-traversal
guard, P5 +security review). New page concepts/proxy-mode. CLI smoke
captured: mega hooks install idempotent into temp settings, logger exit 0,
unknown target exit 1.

## [2026-06-14] merge | Proxy Mode v1.2 ← origin/main Phase 0–10 ContextOps

Merged origin/main (all 10 ContextOps phases, MCP 4→25 tools) into the v1.2
Proxy Mode branch. UNION resolution — nothing lost from either side. mcp-bridge
now exposes 26 tools (25 ContextOps + proxy_search_code); McpToolName is a
26-member enum. tool naming layer (tool-naming.ts) renames only
mega_read_file/mega_run_command/mega_fetch_chunk → proxy_* and passes every
other name through in both modes. CLI registers all Phase 0–10 subcommands plus
the hooks group. stats exports both the v1.2 proxy metrics and the Phase 8
AuditEvent family. README kept at the v1.2 version.

## [2026-06-15] feature | GUI workspace-scoped Saver Mode activation

Re-hosted token-saver activation after the live-first pivot (PR #134) orphaned
it. Investigation: `tokenSaver.enabled` is NOT a runtime compression gate —
runtime compression (`filterOutput`) keys on `mode`/budget only; `enabled` is
read solely by `connectors-shared/context-gate-block.ts` to decide whether to
render the `CONTEXT_GATE` block into `<cwd>/CLAUDE.md`. So real activation is
inherently per-workspace (cwd), not per Claude session (the MCP bridge never
receives a Claude session id per call → no per-session runtime isolation).

Shipped (Engine Option A — render-in-bridge): connectors-shared
`renderContextGateBlockText` + `upsertContextGateBlockText` (CG-only, no
ConnectorContext); GUI bridge route
`/api/claude-sessions/:dir/:id/token-saver/workspace` (cwd server-derived,
writes CLAUDE.md via sentinel-bounded atomic helpers, reports `mcpInstalled`);
GUI `ws-token-saver` "Saver Mode" workspace panel. Followed full superpowers
chain (HIGH risk, worktree, spec+plan, TDD, two-stage subagent review).
Follow-up tracked: explicit `ConnectorError` mapping in bridge error-mapping.
Spec: docs/superpowers/specs/2026-06-14-gui-workspace-token-saver-activation-design.md.

## [2026-06-15] ci | fix pre-existing Windows verify failures (PR #136)

`verify (windows-latest)` had accumulated pre-existing failures (masked while
earlier PRs merged via owner CI-bypass; the Windows build failed first). After
#135 fixed the build (shared `@types/node`) and a path assertion
(workspace-resolver), Windows surfaced timeout-class failures one package at a
time — windows-latest fs is slow, so fs-heavy suites exceeded vitest's default
5000ms `testTimeout` (e.g. skill-packs `discover.test.ts` at 10800ms). Fix:
raised `testTimeout` + `hookTimeout` to 30s in all 14 package `vitest.config.ts`.
Audited path-assertion and `file://` classes too — assertions are symmetric
`resolve`/`join` or string passthroughs, and file URLs use `fileURLToPath(new
URL(...))` (win32-safe), so timeouts were the only remaining class. Both
`verify (ubuntu-latest)` and `verify (windows-latest)` now green — first
fully-green CI on both platforms (no bypass). See [[concepts/windows-support]].

## [2026-06-15] refactor | merge Saver Mode tab into Token saver tab

Per user request, collapsed the two cockpit tabs into one. The standalone
`ws-token-saver` "Saver Mode" workspace tab is removed; its controls now render
as a `SaverModeActivation` sub-component inside the single `token-saver` "Token
saver" tab (activation on top, this-session stats below). Both client calls key
on (dir,id) so no new props. Sub-headings keep the scope distinction explicit
(activation = workspace-wide; stats = this session). GUI-only; bridge routes and
client functions unchanged. See [[entities/gui]].

## [2026-06-15] feature | realized Saver Mode PostToolUse hook

Wired the previously-unbuilt overlay-stats producer so the live Token saver tab
actually populates AND Saver Mode realizes token savings. New `mega hooks saver`
PostToolUse hook: on an eligible native tool (Read/Bash/Grep/Glob/LS) in a
Saver-Mode-enabled workspace, when output exceeds the mode budget, it
evidence-preservingly compresses the output (filterOutput), stores the FULL
redacted output as a recoverable chunk, records the per-session overlay event
keyed by (workspaceKey=encode(cwd), liveSessionId=session_id — the hook's
session_id is the missing key the MCP bridge never had), and returns
`updatedToolOutput` so the model ingests the compressed result. New context-gate
primitive `recordAndFilterOverlayOutput`. `mega hooks install` now installs both
PreToolUse (telemetry) + PostToolUse (saver). SAFETY: always exit 0; any error /
multi-modal (text+image) output ⇒ original untouched (passthrough); full output
recoverable via proxy_expand_chunk. HIGH risk, full superpowers chain (spec/plan/
TDD/two-stage subagent review incl. opus safety pass). See [[entities/cli]],
[[entities/context-gate]]. Spec: docs/superpowers/specs/2026-06-15-realized-saver-hook-design.md.

## [2026-06-15] fix | chunk-set source maps to sourceKind (PR #140)

`recordAndFilterOverlayOutput` stored every overlay chunk-set with
`source: {kind:"file", path:label}` regardless of tool, so a Bash command/grep
was recorded as a file path. Now maps `input.sourceKind` → the matching
`OverlayChunkSet["source"]` variant (`command`/`grep`/`fetch`/`file`) via an
exhaustive switch. Cosmetic metadata only — hook behaviour + lossless recovery
unaffected; the overlay event already carried the right `sourceKind`. TDD; merged
via squash to main (commit 7c916db). See [[entities/context-gate]].

## [2026-06-15] feature | Connect Saver hook GUI toggle (PR #141)

In-app toggle to install/uninstall the GLOBAL Claude Code Mega Saver hooks
(`~/.claude/settings.json`), replacing terminal-only `mega hooks install`.
Hook-settings logic MOVED into `@megasaver/connector-claude-code` (single source
for CLI + GUI; `apps/gui` cannot import `apps/cli`) with new `uninstall` + status
fns and ATOMIC writes (temp+rename). New CLI `mega hooks uninstall claude-code`.
Global bridge route `GET|POST|DELETE /api/hooks/claude-code` (injectable
`claudeSettingsPath`). `HookConnection` toggle in the Token saver panel, honestly
labelled global, confirm-on-disconnect. HIGH risk, full superpowers chain;
executed as a 6-task subagent workflow (per-task spec+quality review). Critic
review caught a CRITICAL pre-merge bug: uninstall filtered whole entries by
command → would delete co-located unrelated user hooks; fixed to command-level
strip + regression test, critic re-verified (27/27 adversarial probes). Squash-
merged to main (commit a71f06e). See [[entities/gui]], [[entities/connectors-claude-code]],
[[entities/cli]]. Spec: docs/superpowers/specs/2026-06-15-gui-connect-saver-hook-design.md.

## [2026-06-16] finding | saver activation mechanics (operational)

While verifying live saving on the dev machine, captured the gotchas that make
"enabled but not saving" the default surprise:
(1) Claude Code loads hooks at **session start** — a hook connected mid-session
takes effect only after `/hooks` review or a NEW session.
(2) The installed hook command `mega hooks saver` must resolve on **PATH** — if
`mega` is absent the hook fails silently (always exit 0) → passthrough, zero
events. `pnpm link --global` needs `PNPM_HOME`/`pnpm setup`; fallback is a symlink
of `dist-bundle/mega.mjs` into a PATH dir (e.g. `~/.local/bin`). The on-disk
bundle must be rebuilt (`pnpm --filter @megasaver/cli bundle`) to include the
saver hook.
(3) Hook **install** (global, `settings.json`) and per-workspace **enable**
(`stats/<wk>/workspace-token-saver.json`, keyed by `encodeWorkspaceKey(cwd)`) are
ORTHOGONAL — both required, plus output > mode budget (safe 32000 / balanced 12000
/ aggressive 4000 B). Verified end-to-end: `mega hooks saver` compressed a 72000 B
payload → 44 B (99.94%), recording the overlay event. See [[entities/connectors-claude-code]],
[[entities/cli]], [[entities/gui]].

## [2026-06-16] architecture note | DFMT comparison direction

User shared Claude Code's DFMT comparison and asked whether MegaSaver should avoid
becoming a DFMT clone. Read [[concepts/agent-agnostic-core]],
[[concepts/contextops-roadmap]], [[concepts/proxy-mode]],
[[concepts/context-gate-pipeline]], and [[entities/mcp-bridge]]. Assessment:
Claude's timing diagnosis is directionally right — PostToolUse is a fallback and
MCP/proxy tools are the reliable pre-context hot path — but MegaSaver's
differentiator should be a broader ContextOps Gateway: agent-agnostic proxy
tools + optional hot local data plane + memory/repo/failure-aware ranking +
policy/redaction + replay/audit + expansion handles. This keeps DFMT's useful
"raw output never enters context first" lesson without copying its product shape.

## [2026-06-16] spec | Context Ledger reliable save architecture

User approved a save-first architecture target: cover all save error classes
(false memory, overwrite/conflict, secrets, broken agent config) with save as the
main focus, while targeting roughly 10% returned context / ~90% savings on
eligible MegaSaver-mediated large outputs. Wrote
`docs/superpowers/specs/2026-06-16-context-ledger-reliable-save-design.md` and
new concept page [[concepts/context-ledger-architecture]]. Core decision:
agent `save_memory` creates a candidate, not approved memory; evidence ledger +
validator + conflict checker + approval policy decide whether memory can enter
agent projections.

## [2026-06-16] review | Context Ledger spec split after Claude review

Claude Code review found real draft blockers: unpurgeable missed secrets in an
append-only ledger, silent Phase-10 `save_memory` contract change, candidate/raw
evidence MCP leak paths, 90% metric gaming, missing sufficiency metric, unbounded
retention, replay-vs-GC contradiction, and an over-broad one-plan scope. Revised
the design by marking the original umbrella spec superseded and splitting the
work into two narrower specs:
`2026-06-16-contextgate-honest-90-design.md` and
`2026-06-16-reliable-save-ledger-design.md`. Key corrections: ContextGate naming
only; token-weighted savings + eligible/mediated fractions; evidence sufficiency
counter-metrics; redaction revocation/tombstones; retention/pinning semantics;
candidate == existing Phase-10 suggested MemoryEntry; agent-facing MCP leak
invariant; per-connector projection matrix including Aider/Gemini/Windsurf/
Continue.

## [2026-06-16] review | Evidence Ledger residuals resolved

Second Claude Code re-check marked all prior blockers resolved and approved the
split direction, with two plan-blocking residuals: shared ledger schema ownership
and an overstrong `crypto-shred` phrase against the plaintext content-store.
Added `docs/superpowers/specs/2026-06-16-evidence-ledger-interface-design.md`
as the canonical package/schema/revocation/retention interface. Revised
ContextGate to consume that interface and describe secret purge honestly as
logical tombstone + best-effort local delete unless future encrypted-at-rest
storage lands. Also folded minor review items into Reliable Save: sidecar
atomicity, per-workspace/CAS approval serialization, and connector projection
validation staying out of Core.

## [2026-06-16] plan+review | Evidence Ledger plan + security review

Wrote `docs/superpowers/plans/2026-06-16-evidence-ledger.md` (13-task TDD plan
for the `@megasaver/evidence-ledger` leaf, grounded in the content-store
template + dependency-graph guard). Ran code-reviewer + adversarial critic.
BLOCKING finding: revoke does not actually remove a leaked secret — it survives
in `sourceRef` (command/url/query), in caller-supplied `rawDigest` (oracle), and
in a redundant `events.jsonl` sidecar; revoke tests passed without asserting the
secret was gone (false confidence). Plus compile/lint blockers (branded
`WorkspaceKey` param vs string literals; duplicate `node:fs` imports) and
integrity gaps (no atomicity between record write + event append; revoke deletes
chunk before tombstone; `retentionClass: pinned` survives revoke). Handed
spec-contract deltas to Codex via `wiki/agent-channel.md` (redact `sourceRef`,
ledger-computed + revoke-nulled digests, drop events sidecar, GC-exempt
`manual_hold`, boundary `workspaceKey` validation). Next: Codex amends interface
spec → Claude revises plan + re-checks. CLAUDE.md gained a hand-kept Session
Directives block (superpowers-for-everything + caveman ultra) outside managed
sentinels.

## [2026-06-16] spec | Evidence Ledger security amendments

Amended `2026-06-16-evidence-ledger-interface-design.md` from the plan-review
handoff. Spec now treats `sourceRef` as secret-bearing: redact at append time and
scrub to a non-reversible label on revoke. Digests are ledger-computed over
post-redaction content only, never caller-supplied, and are nulled on revoke.
Revocation atomically tombstones the record before best-effort raw chunk delete,
uses in-record `transitions[]` as the only audit trail, and explicitly drops
plaintext `events.jsonl`. Retention coherence added: pinned requires available,
manual_hold and pinned are GC-exempt, GC degrades only transient/session evidence,
pin/unpin is session→pinned→session, and IO validates `workspaceKey` at the
boundary while asserting loaded records match the requested workspace.

## [2026-06-16] plan-v2 | Evidence Ledger plan revised + re-verified

Codex hardened the interface spec (commit cd6b634); Claude revised
`docs/superpowers/plans/2026-06-16-evidence-ledger.md` to match: digests are
ledger-computed from passed post-redaction content (input carries no digest) and
nulled on revoke; revoke scrubs `sourceRef` + clears pins + resets retention,
tombstoning atomically BEFORE best-effort chunk delete; `events.jsonl` removed
(audit = in-record `transitions[]`); `workspaceKey` params are plain strings
parsed at the boundary with a record-match guard; pin is legal only from
`session`; GC exempts `manual_hold`; planted-secret purge tests added (assert
`JSON.stringify(record)` no longer contains the secret). Independent critic
re-verification confirmed all 8 prior blockers CLOSED, and found 2 new
compile/lint blockers (`nowTransition` violating `exactOptionalPropertyTypes`;
`store.ts` biome import order) + 1 minor — all fixed with the critic's verified
forms. Plan ready to execute. Next: execute Plan 1 in a worktree, or author
Plan 2 (ContextGate) + Plan 3 (Reliable Save).

## [2026-06-16] plans | ContextGate honest-90 + Reliable Save plans written

Wrote two more implementation plans (explore-grounded against real surfaces).
`docs/superpowers/plans/2026-06-16-contextgate-honest-90.md` — honest-metrics
engine in `@megasaver/stats`: token-weighted eligible reduction + eligible/
proxied/passthrough/mediated fractions + GA gate pairing reduction with a
sufficiency floor + `mega audit honest`. Critic found 2 blockers (persisted
overlay events carry no mediation/decision → loader can't honestly source
observations; unused `estimateTokens` import) + 2 important (threshold invariant
undocumented; load-bearing decision default) — all FIXED: mediation now assigned
by log source via a tested `recordedEventsFromLogs` projection, decision required,
threshold invariant documented. Sufficiency fixtures / evidence-write / MCP
expansion scoped as Plans 2b/2c/2d.
`docs/superpowers/plans/2026-06-16-reliable-save-ledger.md` — validator + conflict
checker + approval gate in `@megasaver/core` (candidate == suggested; no parallel
entity; MemoryValidation sidecar; deterministic hard checks + advisory heuristics;
dup/supersession/contradiction; approve_memory gated). Discovered MCP leak (§10) +
connector approval gate (§11) are ALREADY enforced today — plan locks them with a
regression test rather than rebuilding. Found a spec error: reliable-save §11 calls
Aider CONVENTIONS.md "full-file no sentinel" but shipped `aiderTarget` is
sentinel-based — flagged to Codex via agent-channel; Plan 3c (projection conformance)
+ Plan 3b (evidence linkage, needs Plan 1) scoped as follow-ons. Plan 3 critic pass
still pending.

## [2026-06-17] plan-review | Reliable Save plan critic + fixes

Independent critic on the Reliable Save plan found 3 blockers + 5 important/minor,
all FIXED: (1) approving an exact duplicate of an approved memory now REJECTS the
suggested row instead of creating a second approved row (spec §8) + test; (2)
`ApproveMemoryResult` extension specified concretely (optional `validation`/
`conflict`) instead of prose; (3) exact insertion anchor given (real handler has no
`approval==="approved"` branch — gate inserted after the no-op equality check,
before the flip); (4) §8 per-workspace serialization/CAS flagged as deferred to 3b
(in-memory registry makes sequential approval safe); (5) dead/speculative
`MemoryValidation` sidecar dropped — only the `validationStatus` enum ships (full
sidecar = 3b where it's read); (6) changeset states the unresolved-secret gate is
inert until 3b (evidence-presence gate active); (7) contradiction test assertion
tightened; (8) conflict-check precedence documented. All three plans (evidence-ledger,
contextgate-honest-90, reliable-save) now critic-verified and execution-ready;
follow-ons 2b/2c/2d/3b/3c named. Pending: Codex §11 Aider matrix correction.

## [2026-06-17] implement | Evidence Ledger package shipped → PR #143

Executed Plan 1 subagent-driven in an isolated worktree (`feat/evidence-ledger`, off
`main`). `@megasaver/evidence-ledger` built TDD across 14 commits: enums, sub-schemas
(+ sourceRef scrub), evidence record schema with revoke/pin/GC superRefine invariants,
read-boundary backfill, errors + ledger digest + ChunkDeletePort, atomic-write +
boundary workspaceKey parse, append-only store with ledger-computed digests +
workspace-match guard, list/pin/unpin/revoke(tombstone-before-delete)/explain/gc,
public surface + changeset. Implementer hit + correctly resolved 3 strict-TS/tooling
deviations (backfill TS4111+useLiteralKeys → named-interface cast; test-d describe
wrapper; store.ts single-write). Two-stage review: spec-compliance PASS (all 8
security invariants, file:line evidence, secret-purge test confirms revoked JSON has
no planted secret) + code-quality APPROVED-WITH-NITS (2 nits fixed: honest
`scrubSourceRef()` signature, restored atomic-write Windows-durability WHY comments).
Gates: 58/58 tests, tsc clean, biome clean, `pnpm verify` green. Deps exactly
{shared, zod} (dependency-graph test enforces no core/content-store edge). Pushed +
PR https://github.com/haJ1t/MegaSaver/pull/143 (base main).
**MERGED** (squash `9fc766e`) after CI green on ubuntu + windows-latest (the windows
verify validates the `IS_WIN32` atomic-write paths); remote branch + worktree cleaned
up. `@megasaver/evidence-ledger` (25 files) now on `main`. Next: wire
ChunkDeletePort→content-store in ContextGate (Plan 2c), then execute Plan 2 / Plan 3.

## [2026-06-17] implement | ContextGate honest-90 metrics shipped → PR #144

Executed Plan 2 subagent-driven in worktree (`feat/contextgate-honest-90`, off `main`).
`@megasaver/stats/src/honest-metrics.ts` (8 TDD commits): token-weighted
`eligibleReduction = 1 − Σreturned/Σraw` over the eligible set + eligible/proxied/
passthrough/mediated fractions (no per-output-mean gaming), `classifyObservation`
(passthrough/light/native never create savings), `recordedEventsFromLogs` (mediation
assigned by log source: overlay→saver_hook, session→proxy, hook→native), `meetsGaGate`
(reduction AND sufficiency floor), and a `mega audit honest` CLI. CLI reaches stats via
`@megasaver/core` re-export (CLI→core→stats; direct CLI→stats forbidden by the cycle
guard). Two-stage review: spec found + fixed a `--json` stdout-corruption bug (caveat
now gated behind `!args.json`); code-quality APPROVED-WITH-NITS, fixed (trimmed core
re-export 13→4 symbols, stale audit description, tautological token test made
load-bearing). Gates: stats 116 + cli 628 tests, tsc + biome clean, `pnpm verify`
36/36. **MERGED** (squash `62b3c65`) after CI green ubuntu + windows. `mega audit honest`
ships wired+tested but reports an empty set until Plan 2c supplies the
liveSessionId→workspaceKey loader (named-deferral, no silent cap). Deferred: 2b
(sufficiency fixtures), 2c (evidence-write + loader), 2d (MCP expansion). Next: Plan 3
(Reliable Save) — validator/conflict/approve-gate in core; Codex §11 Aider matrix fix
still pending.

## [2026-06-17] implement | Reliable Save validator+conflict+gate shipped → PR #145

Executed Plan 3 subagent-driven in worktree (`feat/reliable-save-ledger`, off `main`),
with superpowers skills invoked properly per step (using-git-worktrees →
subagent-driven-development → finishing-a-development-branch) after the operator flagged
that Plan 2 reused the pattern without re-invoking. 10 commits in `@megasaver/core` +
`@megasaver/mcp-bridge`: `validation-status` enum, `save-validator` (fail-closed hard
checks + downgrade-only advisory heuristics), `conflict-checker` (deterministic
dup/supersession/contradiction, precedence-ordered), exports, and the `approve_memory`
gate (runs validate+conflict before the suggested→approved flip; exact duplicate of an
approved memory → suggested row REJECTED, never a second approved row; non-valid/
conflicted → stays suggested with reasons). Two-stage review: spec PASS (all 6
invariants; the agent-no-evidence BLOCK path confirmed tested) + a completeness gap
fixed (MCP leak lock extended from 2→4 tools: search_memory, get_relevant_memories,
mega_recall, get_project_context — all pass against existing gates, regression lock).
Code-quality APPROVED-WITH-NITS, fixed (hoist NEGATIONS, document conflict precedence,
single-source duplicate reason). Gates: core 467 + mcp-bridge 183 tests, tsc + biome
clean, verify 36/36. **MERGED** (squash `f46ce66`) after CI green ubuntu + windows.
Known limitation (in changeset): `unresolvedSecret` defaults false → secret gate inert
until Plan 3b wires evidence ports; evidence-presence gate active. Deferred: 3b
(evidence linkage + workspace identity + approval serialization/CAS + `mega memory
review`/`explain`), 3c (projection conformance — needs Codex §11 Aider matrix fix
first). All three context-ledger implementation plans now on `main` (#143/#144/#145).

## [2026-06-17] implement | Context-ledger follow-ons shipped via dynamic workflow → PR #146

Ran a dynamic Workflow (18 agents: parallel design → sequential TDD build → per-slice
adversarial review) on a main-based worktree to finish the full remaining follow-on
scope. Six slices, all merged (squash `c25cadf`): 2b sufficiency counter-metrics +
fixture corpus (stats); 2d MCP expansion guard (`expansion_blocked`); 2c ContextGate
evidence-write wiring + honest-audit `liveSessionId→workspaceKey` loader (`mega audit
honest` now reports real numbers); 3b evidence linkage that ACTIVATES the secret gate
(evidence-resolver + workspace match + revoked/missing block); 3b approval
serialization (critical-section re-check); 3b `mega memory review`/`explain` +
persisted MemoryValidation sidecar. CRITICAL LESSON: `pnpm verify` was 36/36 green but
the per-slice adversarial reviewers caught THREE fail-open security gaps green tests
missed — (1) `sourceRef.label` persisted unredacted (secret leak), (2) unconsumed
`missingIds` (a memory citing a non-existent evidenceId approved), (3) the MCP
expansion guard never wired into the production `createBridge` path (agent could browse
any chunkSet). A focused opus security-fix pass closed all three with RED→GREEN tests
on the real path (e6cfc55 redact label, 6fd50ed block missing evidence, 5d941c4
per-server returnedChunkSetIds set); an independent security verification confirmed
closure, no new fail-open/over-block. Gates: `pnpm verify` 36/36 green, CI green ubuntu
+ windows. Two latent residuals filed as a follow-up task (appendEvidence should redact
sourceRef itself, not rely on the caller; expansion guard set is per-server not
per-session + unbounded). 3c (projection conformance) still deferred — blocked on Codex
§11 Aider-matrix fix (agent-channel). Context Ledger architecture now fully implemented
on `main` except 3c. Takeaway: green gates ≠ secure; adversarial review after green is
load-bearing, especially for evidence/secret-handling code.

## [2026-06-17] fix | Evidence sourceRef redaction + bounded expansion guard → PR #147

Closed the two latent defense-in-depth residuals from #146 (subagent-driven, worktree
off main, skills invoked per step). `fix(evidence-ledger)` (`da9d3a7` squash): `appendEvidence`
now takes a REQUIRED `redactSourceRef: SourceRefRedactor` port applied to `record.sourceRef`
before schema-parse + persist — compile-time fail-closed, leaf stays policy-free, spec §3
redaction now enforced at the append boundary instead of relying on the caller; the
ContextGate composer wires `policy.redact` over command/args/url/query/path/label (single
redaction source, removed the e6cfc55 call-site dup). `fix(mcp-bridge)`: expansion-guard
`returnedChunkSetIds` is now a `BoundedSet` (FIFO cap 4096); per-session keying deferred (the
`mega_fetch_chunk` wire carries no sessionId; stdio is single-session-per-process — documented).
RED empirically reproduced (planted marker in all 6 sourceRef fields survived without the port).
Adversarial review: Part A CLOSED (no production identity-redactor bypass, no regression),
Part B SOUND. Gates: pnpm verify 36/36, CI green ubuntu+windows. Review surfaced a NEW
pre-existing out-of-scope leak (filed as task chip): the raw `label` (command/url/path) still
reaches `OverlayChunkSet.source` + the overlay stats event UNREDACTED on the shipping saver
path — separate code path, not an evidence-ledger regression. Five context-ledger PRs now on
main (#143–#147). Still open: 3c projection conformance (Codex §11 blocker) + the overlay-source
label-redaction follow-up.

## [2026-06-17] fix | Overlay source-label redaction → PR #148

Closed the overlay-source label-redaction leak flagged by #147's adversarial review (worktree
off main, full superpowers chain, skills invoked per step). `fix(context-gate)` (`97ccb98`
squash): `recordAndFilterOverlayOutput` persisted the RAW `label` to two on-disk sinks — the
overlay chunk-set `source` (command/url/grep-query/file-path, via `chunkSetSource` →
content-store) and the overlay stats event `label` (→ @megasaver/stats) — so a credential-bearing
command line, token-bearing fetch URL, or secret path landed unredacted even though the chunk
CONTENT was redacted. Fix computes `redactedLabel = redact(input.label).redacted` once (same
`@megasaver/policy` `redact` as content) and feeds both sinks; evidence `sourceRef` untouched
(redacts via its own #147 port). TDD: 3 RED tests (secret in command/event/fetch-URL → present
on disk) + 2 contract-lock tests (grep/file) — all assert on the reloaded on-disk artifact, not
in-memory. Empirically confirmed a redacted fetch URL still passes `overlayChunkSetSchema`
`z.string().url()`. Gates: pnpm verify 36/36, CI green ubuntu(2m55s)+windows(4m48s). Adversarial
review (3 lenses + synthesis): APPROVE, no must-fix; surfaced honest residuals → (a) tightened
changeset wording (redact only catches prefix/structure-shaped secrets, not bare `?token=<hex>`
or `user:pass@host` — same blind spot as content path); (b) NEW follow-up task chip
(`task_18423994`): the parallel saver paths still leak raw command/args/path —
`run-command.ts` (the LIVE `proxy_run_command`, persists the real `args` array so a bearer token
in `-H` lands in `source.args`), `run.ts:207`, `read.ts:213`; pre-existing, untouched here.
Six context-ledger PRs now on main (#143–#148). Still open: 3c projection conformance (Codex §11
blocker) + the parallel-path label leak (`task_18423994`). Takeaway reconfirmed: adversarial
review after green gates is load-bearing — it caught the changeset overstatement AND a more
severe sibling leak (raw args on the live MCP command path) that the green suite never touched.

## [2026-06-17] fix | Parallel saver-path label redaction → PR #149

Closed the parallel-path label leak (`task_18423994`) flagged by #148's review (worktree off
main, full superpowers chain, skills per step). `fix(context-gate)` (`aa42dbd` squash): #148 only
redacted the label inside `recordAndFilterOverlayOutput`; the other live saver paths still wrote
the RAW label to disk — `run-command.ts` (`runOutputExecCommand` legacy + `runOverlayOutputExecCommand`
overlay, the latter behind `proxy_run_command`) persisted `source.command`, `source.args`, and the
event `label` raw (it stores the REAL args array → a `curl -H "Authorization: Bearer ..."` token
landed in `source.args` on disk); `run.ts` (legacy+overlay file pipelines) persisted the file
`path` raw in the event label; `read.ts` `persistChunkSet` + `persistOverlayChunkSet` persisted
the file `path` raw in `source.path`. Fix applies `@megasaver/policy` `redact` (same detector as
content) at every sink: command+args redacted element-wise, the event label rebuilt from the
redacted parts, the file path redacted at the `persist*` sink (covers all callers of the exported
fns) + the `run.ts` event label. TDD: 4 RED on-disk round-trip tests (legacy+overlay × command+file,
assert secret body absent + `[REDACTED]` marker on the persisted chunk JSON + events.jsonl) → GREEN.
Gates: pnpm verify 36/36, 55/55 context-gate, CI green ubuntu+windows. Adversarial review (3 lenses
+ synthesis): APPROVE, no must-fix; acted pre-merge on its findings → reverted a no-op `redact` the
initial `replace_all` over-applied to `readAndFilter`'s `filterOutput` call (not a persistence sink;
`filterOutput` reads `source` only for command-classification), strengthened the 2 legacy tests with
positive `[REDACTED]` marker assertions. Seven context-ledger PRs now on main (#143–#149). Known
limits (tracked, not regressions): `redact` misses bare `?token=<hex>` / `user:pass@host` (detector
blind spot, shared with content path → `redaction-patterns.ts` hardening follow-up); `secretsRedacted`
metric undercounts secrets that appear only in label/args/path. Still open: 3c projection conformance
(Codex §11 blocker) + redactor-pattern hardening. The secret-on-disk leak class across the saver
persistence paths is now closed for all structurally-detectable secrets.

## [2026-06-17] feat | Contextual no-prefix secret redaction → PR #150

Closed the redactor detector blind spot (`task_00c4363d`) flagged across #148/#149 reviews
(worktree off main, full superpowers chain). `feat(policy)` (`b2e39cd` squash): `redact()` —
the SINGLE detector shared by chunk content + every saver sink + evidence sourceRef — matched
only prefix/structure-shaped secrets, so contextual secrets (secret-named URL query/fragment
param, userinfo creds on non-db schemes, secret CLI flag value, api-key/Basic header) passed
through verbatim and reached disk. Added 5 LOOKBEHIND patterns after the locked baseline
(additive-only, baseline untouched; backrefs avoided because `redact()` applies replacements via
a function → `$1` would be literal): `url_basic_auth`, `url_query_secret` (query+fragment),
`cli_secret_flag_eq` + `cli_secret_flag_spaced` (quoted-only), `api_key_header`,
`basic_auth_header`. A generic high-entropy matcher for CONTEXTLESS opaque tokens was
deliberately omitted (indistinguishable from SHAs/UUIDs/hashes → mass false positives).

**Adversarial review earned its keep — BLOCK → fix → re-APPROVE.** First 3-lens review (false-
positive / coverage / regression+ReDoS) BLOCKED with 4 verified defects the green suite missed:
(C1 critical) OAuth **fragment** tokens `#access_token=` leaked (lookbehind took only `[?&]`);
(C2 critical) `url_basic_auth` forbade `/` in the password → slash-passwords leaked the whole
cred, strictly weaker than the baseline `db_url` it copied; (I1 important) the cli flag space
form ate the next token / prose / shell operators (`&&`,`|`,`>`) → corrupted the first-failure
evidence the saver preserves; (I2 important) empty-username userinfo (`redis://:pw@`) leaked.
All fixed via TDD (RED tests for each leak + each over-redaction negative): `[?&]`→`[?&#]`,
basic-auth class `[^\s/@]*:[^\s@]+(?=@)`, cli flag SPLIT into `=`-form (unquoted) + space-form
(quoted-only). A focused 2-lens re-review empirically confirmed all 4 CLOSED + no new
leak/false-positive (17-case benign battery clean, no ReDoS <5ms/500KB, every redacted URL still
passes `z.string().url()`). Gates: pnpm verify 36/36, policy 143/143, context-gate 15/15, CI green
ubuntu+windows. Documented minors (non-leaks): `@`-in-password short tail (RFC requires
%-encoding; first-`@` anchor), baseline-shaped query value double-counted, `Authorization: Basic
<prose-word>` cosmetic over-redaction. Eight context-ledger PRs now on main (#143–#150). Still
open: 3c projection conformance (Codex §11 blocker). Takeaway, reconfirmed hardest here:
adversarial review after green is load-bearing — green `pnpm verify` shipped 2 CRITICAL credential
leaks (OAuth fragment, slash-password) that only the adversarial pass caught.

## [2026-06-18] feat | Token-saver completion (4 slices, dynamic workflow) → PR #151

Closed the buildable gaps keeping the auto-saver (`mega hooks saver` PostToolUse) from being fully
usable end-to-end. Built as ONE dynamic Workflow: sequential TDD implement (4 slices share
`apps/cli/src/hooks/saver.ts` → serialized, subagent-driven, git-safe) + parallel per-slice
adversarial review + full verify. `feat(cli)` (`1565d40` squash, 4 commits, 695+/7−, surgical):
- **S1 activation CLI** (`ab988a4`): `mega session saver workspace enable|disable [--mode]` writes/
  toggles `<storeRoot>/stats/<wk>/workspace-token-saver.json` (exact `z.object({enabled,mode})` the
  hook reads, atomic, `--mode` validated) → saver usable WITHOUT the GUI (was GUI-only). New
  `workspace` subgroup to avoid colliding with the session-scoped `enable/disable`.
- **S2 evidence wire** (`20bb885`, HIGH): live saver now passes `evidenceStoreRoot: deps.storeRoot`
  into `recordAndFilterOverlayOutput` → evidence-ledger rows written on the AUTO path, not only MCP/
  memory. Same `<storeRoot>/evidence/<wk>/` convention; best-effort intact (4-line prod change).
- **S3 honest token metrics** (`3a5b35d`): inline pointer + `session saver stats` now report
  token-weighted savings (`~A→B tokens, P%`) via the `@megasaver/stats` estimator (was byte-only);
  `--json` additive/backward-compatible.
- **S4 truncation-honest recovery** (`be6684b`): if input pre-truncated by the harness (end-anchored
  marker, low false-positive), pointer says recovered chunk is PARTIAL instead of lying "Full output
  recoverable" — the buildable core of the native-truncation shadowing finding.
Final pointer composes all three saver.ts slices:
`[Mega Saver: compressed X→Y B (~A→B tokens, P%). <Full output recoverable | PARTIAL note>.]`
Gates: 4/4 slice reviews APPROVE (only cosmetic minors), self-run `pnpm verify` exit 0, CI green
ubuntu(3m5s)+windows(4m48s). Workflow note: first run failed on a paren bug in the review phase
(`(await parallel(...).filter(...))` → `await` bound to the Promise, not the array) AFTER all 4
implements had committed; fixed paren + resumed with `resumeFromRunId` → implements returned cached,
review+verify ran live. Nine context-ledger/saver PRs now on main (#143–#151).

**Out of scope (stated, not buildable here):** npm publish (`NPM_TOKEN` maintainer secret) · GUI
approval UX (v0.3+ deferred) · 3c projection conformance (Codex §11 Aider-matrix blocker, pending).
Token saver now works end-to-end in-session: enable via the CLI, compress + redact (#147–#150) +
evidence (#143) + honest token metrics + honest partial-recovery signal.

## [2026-06-18] spec | Aider projection matrix corrected

Addressed Claude Code's 3c blocker in
`docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md` §11. Verified
`packages/connectors/generic-cli/src/targets.ts`: `aiderTarget` is in
`builtinTargets` with no special full-file path, so it uses the shared
`MEGA_SAVER:BEGIN` / `MEGA_SAVER:END` sentinel block like Codex, Gemini,
Windsurf, and Continue. Spec now marks Aider `CONVENTIONS.md` as sentinel-based;
Cursor remains the only current generic target with header/frontmatter outside
the sentinel block.

## [2026-06-18] feat | Plan 3c projection conformance → PR #152 (LAST platform item)

Codex corrected §11 (`43e9709`: all connector targets sentinel-based; only Cursor carries
frontmatter outside the sentinel) → 3c unblocked, executed end-to-end under the full chain
(worktree off main, writing-plans, TDD, adversarial review). `feat(connectors)` (`1db07df` squash):
added `projectionPreflight(content, {expectHeader})` in `@megasaver/connectors-shared` — validates
the FINAL rendered connector output before the atomic write (exactly one balanced managed sentinel
block via `parseBlock`, balanced `CONTEXT_GATE` block when present, seed-path-only Cursor frontmatter
survival). New `projection_invalid` error code mapped in all three exhaustive `ConnectorErrorCode`
consumers (generic-cli + claude-code `mapSharedErrorCode` → block-conflict, completeness-only since
preflight lives in the CLI; apps/cli message map). Wired into `connector sync` before each write
(seed + update); a `projection_invalid` throw hits the existing per-target try/catch → only that
connector's write aborts, store + other targets intact, exit 1 (spec §11/§14). Agent-agnostic (no
`ConnectorTarget` import; core untouched). Conformance matrix across all 7 targets + corrupt-isolation
+ a `vi.mock` call-site abort test proving the guard fires + disk unchanged. Self-verify caught a real
regression MID-BUILD: initial `expectHeader`-on-update falsely aborted a header-less Cursor re-sync
(broke U5) → fixed seed-only (header prepended only on seed; out-of-block text is user-owned on
update). Adversarial review (2 lenses + synthesis): APPROVE, no must-fix; acted pre-merge on minor
coverage findings. Gates: pnpm verify 36/36, CI green ubuntu(3m11s)+windows(4m29s). Ten PRs on main
(#143–#152).

**Platform status: all buildable items shipped.** Remaining non-code items are maintainer-only: npm
publish (`NPM_TOKEN` secret + `@megasaver` scope claim — verified publish-ready) and the GUI (v0.3+
deferred; saver activation already covered by the #151 CLI). Context-ledger + reliable-save +
token-saver arc complete.

## [2026-06-18] release | @megasaver/cli@1.0.2 PUBLISHED to npm

`@megasaver/cli@1.0.2` is live on npm (`registry.npmjs.org/@megasaver/cli/1.0.2`) — installable
via `npm i -g @megasaver/cli` (`mega` bin). Closes the MVP→installable-product gap (post-v1.1
roadmap #1). Maintainer claimed the `@megasaver` org/scope + write token + `NPM_TOKEN` secret;
`v1.0.2` tag triggered `release.yml`. CI npm-publish could NOT pass 2FA: account/org enforces
2FA-for-writes; granular token + account "auth only" still EOTP; maintainer uses a security key
(FIDO/WebAuthn) not TOTP, so `--otp` is impossible in CI. Resolution: `npm pack` the released `main`
code into a tarball, then `npm publish <tarball> --access public` LOCALLY, completing the
security-key 2FA in the browser. For hands-off CI releases later: disable 2FA-for-writes at the ORG
level (per-account change was overridden by org enforcement) or use a 2FA-bypass token. Bundle is
self-contained (single ~11MB `dist-bundle/mega.mjs`, 0 workspace refs). Ten PRs (#143–#152) + this
release: the context-ledger / reliable-save / token-saver arc is complete AND shipped to npm.

## [2026-06-22] feature | agent-office Phase 0 (engine data layer)

New feature **Agent Office** (spec docs/superpowers/specs/2026-06-22-agent-office-design.md,
plan docs/superpowers/plans/2026-06-22-agent-office-phase0-engine.md). Brainstorming locked:
hybrid launch+track; four agent kinds by interface with claude-code adapter first; rich roles
(persona+model+tools/skills+permission+workdir, seeded from CLAUDE.md §6 + custom); per-agent
task queue with lifecycle; headless `claude -p --resume` execution; engine package + GUI board +
thin `mega office` CLI; safety risk CRITICAL — safe-by-default (`plan`), opt-in writes per role,
workdir confinement, evidence-ledger audit (user sign-off recorded in spec frontmatter).

Phase 0 shipped on branch `worktree-feat+agent-office`: new agent-agnostic package
`@megasaver/agent-office` (deps: `@megasaver/shared` + zod only; no core edge yet). Delivered the
data layer — zod `.strict()` schemas `Role`/`OfficeAgent`/`OfficeTask` (+ enums), new shared
branded ids `roleId`/`officeAgentId`/`officeTaskId`, atomic-json stores mirroring content-store
(temp→fsync→rename, `assertSafeSegment` incl. NUL guard, typed `AgentOfficeError`), and
`buildPredefinedRoles` (13 seed roles, ALL `permissionMode: plan`). 57 tests, `pnpm verify` green.
Built subagent-driven (4 batches, two-stage spec+quality review each). New entity page
[[entities/agent-office]]. Phases 1-5 (launcher → supervisor → bridge → GUI → CLI) deferred to
their own specs; the CRITICAL spawning lands in Phases 1-2. Follow-ups noted: tighten
`workspaceKey` to the branded schema in Phase 2; harden `atomicWriteFile` dir-fsync edge across
content-store + agent-office.

## [2026-06-22] feature | agent-office Phase 1 (launcher capability)

Shipped the spawning capability on branch `worktree-feat+agent-office-phase1` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase1-launcher-design.md, plan
.../plans/2026-06-22-agent-office-phase1-launcher.md). Grounded against installed `claude`
2.1.177: all assumed flags exist; persona via `--append-system-prompt`, session continuity via
`--session-id` (new) / `--resume` (later); permission map plan→plan, acceptEdits→acceptEdits,
full→bypassPermissions.

Added agent-agnostic `AgentLauncher` interface + `LauncherError` + `launcherPermissionMode`/
`launcherModel` zod schemas to `@megasaver/connectors-shared`, and the claude-code adapter
(`buildClaudeArgs` pure builder + `createClaudeCodeLauncher` with injectable spawn,
StringDecoder-based UTF-8-safe stdout line parsing, one-shot onExit latch, SIGTERM cancel) to
`@megasaver/connector-claude-code`. Workdir confinement (cwd only, no --add-dir); argv array (no
shell injection). Risk HIGH; every test injects a fake spawn — no real `claude` spawned.

Built subagent-driven; reviewed by code-reviewer + adversarial critic. Critic caught two real bugs
fixed before merge: double `onExit` on ENOENT (error+close both fire) and UTF-8 multibyte
chunk-split corruption — both now have regression tests. `pnpm verify` green; changeset minor×2.
Phase 2 carry-overs recorded on [[entities/agent-office]]: event buffering for async subscribers,
SIGKILL escalation, gate full/bypassPermissions, listener teardown, brand `workspaceKey`.

## [2026-06-22] feature | agent-office Phase 2 (supervisor)

Wired the launcher into the office on branch `worktree-feat+agent-office-phase2` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase2-supervisor-design.md). `@megasaver/agent-office`
now deps `core` + `connectors-shared`. Added: `resolveLauncherPermission` (safe-by-default gate —
`full` refused unless `allowFull` explicitly granted), `createLauncherRegistry`, an append-only
office audit log, and `createSupervisor` (processNextTask/drainAgent/runWorkspace). Branded
`workspaceKey` on agent/task schemas; added `cancel(signal?)` to the launcher handle.

Decision: used a lightweight dedicated audit log instead of `@megasaver/evidence-ledger` — the
ledger's appendEvidence is content-redaction-shaped (redactSourceRef/redactedRawContent/policyVersion),
a poor fit for spawn events. Full ledger integration deferred.

Risk CRITICAL. Reviewed by code-reviewer + critic + security-reviewer. security-reviewer: PASS — the
safe-by-default permission gate is airtight (impossible to spawn bypassPermissions without
allowFull), workdir confinement holds (cwd only, no --add-dir, argv array), audit metadata complete.
critic first returned DO NOT SHIP on failure-path correctness; fixed before merge: try/catch settles
task→failed + agent→error on ANY throw (no poisoned running/working persisted state), endSession
exactly once, terminal audit row per spawn, `taskTimeoutMs` (30 min default) SIGKILLs a hung child,
agent→error persisted first on double-fault, claudeSessionId persisted on failure too. Also closed a
cleartext-secret sink (core Session title no longer the instruction → `Office: <role>`). Crash-injection
+ hang tests added; critic re-verify: SHIP. 105 agent-office tests; `pnpm verify` green; changeset
minor×3. Tests use a fake launcher + in-memory CoreRegistry — no real `claude` spawned.

## [2026-06-22] feature | agent-office Phase 3 (bridge /api/office)

Exposed the office over the GUI bridge on branch `worktree-feat+agent-office-phase3` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase3-bridge-design.md). Added `/api/office/*` REST
routes (role/agent/task CRUD, run, control, audit, status, audit-tail SSE) in `apps/gui/bridge`,
HTTP-boundary zod validation, dispatch wiring, and production server deps (json-directory core +
claude-code launcher registry + `MEGA_OFFICE_ALLOW_FULL` env). `apps/gui` gained deps on
agent-office + connector-claude-code (lockfile committed).

Risk HIGH. Reviewed by code-reviewer + critic + security-reviewer. critic returned DO NOT SHIP on a
PROVEN production-breaker: `OFFICE_PROJECT_ID` was never created as a Project, so the json-directory
`createSession` throws `project_not_found` → every office task fails in prod; the run test missed it
(fire-and-forget, never awaited the drain). Fixed: `ensureOfficeProject` seeds the office Project at
server startup + a real integration test awaits `drainAgent` and asserts task `done` + spawn/task_done
audit. Also fixed: concurrent-run guard (no double-spawn), `wk`/`agentId` validation at the route
layer (400/404, closes a 500+segment-echo + an SSE watch-path traversal gap), SSE cleanup armed before
the snapshot await, DELETE→204, drain-rejection logged, and the `allowedTools` leading-`-` flag-guard
hoisted into `roleSchema` (launcher trust boundary). security-reviewer: PASS with remediations —
safe-by-default holds over HTTP (allowFull env-only/default-off, full fails closed, no flag injection,
instruction kept out of cleartext sinks). Documented localhost/no-auth + unconfined-`workdir` posture
and that `control stop` doesn't cancel an in-flight spawn (Phase 4). gui 318 / agent-office 107 tests;
`pnpm verify` green; no real claude/HTTP in tests.

## [2026-06-22] feature | agent-office Phase 4 (GUI office board)

Added the `agent-office` GUI view on branch `worktree-feat+agent-office-phase4` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase4-gui-design.md). `apps/gui/src`: workspace
selector + global role manager (CRUD, full-permission warning) + per-workspace agent board
(AgentCard with status dot/current task/last event + run/pause/resume/stop/remove/assign +
add-agent), a `lib/office-client.ts` wrapping the Phase 3 API + `openOfficeStream` SSE (disposer),
and live board updates on the SSE `status` event. Built consistent with the existing utilitarian GUI;
a dedicated visual-design pass (huashu/taste) is a noted follow-up.

Risk MEDIUM. Reviewed by code-reviewer + critic (UI). critic found two reproduced UX-correctness bugs,
fixed before merge: (1) stale-response overwrite race — a late `fetchOfficeStatus` for a previous
workspace could overwrite the current board (fixed with a per-effect-run ignore flag gating
setBoardStatus/setStatusError, and an ignoreRef on the manual refresh path; closeStreamRef removed as
redundant); (2) sticky "Live stream disconnected" banner — EventSource auto-reconnects but the banner
never cleared (now cleared on every successful status push). Both regression-tested (verified
fail-without-fix). Also cleaned dead imports/test vars + a loadRoles spurious-refetch. 360 gui tests;
`pnpm verify` green; tests stub fetch + EventSource (no real bridge/claude). Phase 5 (CLI `mega office`)
remains.

## [2026-06-22] feature | agent-office Phase 5 (CLI) — feature complete

Added `mega office` CLI on branch `worktree-feat+agent-office-phase5` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase5-cli-design.md): Citty subcommands
role/agent CRUD, assign, run (drives the supervisor, awaits drainAgent, exit 1 on failure),
status, logs, pause/resume/stop — thin handlers over the engine, mirroring the memory command
pattern. wk = encodeWorkspaceKey(cwd); roles global. Hoisted OFFICE_PROJECT_ID + ensureOfficeProject
from the bridge into @megasaver/agent-office (engine) so CLI + bridge share one canonical office
project id; bridge re-exports them. apps/cli gained agent-office + connector-claude-code devDeps
(bundled by tsup; lockfile committed).

Risk HIGH. Reviewed by code-reviewer (APPROVED) + critic (SHIP WITH FIXES) + security-reviewer (PASS).
Safe-by-default holds: allowFull only via --allow-full / MEGA_OFFICE_ALLOW_FULL=1 (default off),
full fails closed with no spawn (test-asserted launcher-not-called); allowedTools leading-`-` guard
inherited from roleSchema (triple-layered); argv-array spawn (no shell injection); assertSafeSegment
on all paths; instruction kept out of the audit store. Critic-found fixes applied before merge:
office-specific ZodError messages (bad agent id no longer says "name must be non-empty"); run/assign
report "agent not found" (not "task not found"); assign prechecks the agent exists (no orphan tasks);
instruction trimmed (z.string().trim().min(1)); run prints a note when nothing drains. cli 719 /
agent-office 113 / gui 360 tests; pnpm verify green; fake launcher + in-memory core (no real claude).

**Agent Office is feature-complete: Phases 0-5 all on `main`** (engine → launcher → supervisor →
bridge → GUI → CLI). Usable end to end. Follow-ups tracked on [[entities/agent-office]].

## [2026-06-22] feature | agent-office predefined roles from addyosmani/agent-skills

Replaced the 13 generic predefined roles with a 24-role catalog modeled on
https://github.com/addyosmani/agent-skills (one role per skill, grouped by lifecycle phase:
Define/Plan/Build/Verify/Review/Ship/Meta) on branch `worktree-feat+agent-office-skill-roles` (spec
docs/superpowers/specs/2026-06-22-agent-office-skill-roles-design.md). Each role: kind claude-code,
permissionMode plan (safe-by-default), allowedTools [], skillPacks [skill-slug], persona from the
skill's purpose, model tiered (opus reasoning / sonnet build / haiku docs).

Found + fixed a latent gap while verifying in the running GUI: `buildPredefinedRoles` was exported +
tested but NEVER called at runtime (Phase 0 deferred seeding-to-disk to a phase that never landed), so
the office showed zero roles. Added `ensurePredefinedRoles` (idempotent — no-op once any role exists),
wired into the bridge startup (server.ts) + a new `mega office role seed` CLI command. Now the roster
appears in the GUI role manager + `mega office role list` on first run. agent-office 117 / cli 721 /
gui tests green; changeset minor (agent-office, cli) + patch (gui).

## [2026-06-22] feature | office auto agent workdir

Agent `workdir` now derived from the project dir, not user-chosen. CLI dropped
`office agent create --workdir` (uses cwd); GUI add-agent dropped its workdir
input (uses selected workspace label); bridge enforces `encodeWorkspaceKey(workdir)
=== wk`. Branch `feat/office-auto-workdir`, 4 commits, `pnpm verify` green
(cli 721 / gui tests pass), CLI smoke confirms no `--workdir` flag + workdir===cwd.
role.defaultWorkdir left inert (follow-up).

## [2026-06-23] feature | office live transcript (Phase A)

Click an office agent → live read-only feed of its activity. Captured the
launcher stream-json events the supervisor was dropping (`onEvent(()=>{})`):
`projectEvent` → compact `TranscriptEntry` → per-agent `transcript-store` →
bridge backlog GET + SSE (`office-transcript-bus`, in-process) → GUI
`TranscriptPanel` (click-to-open). New `officeTranscriptId` brand. Branch
`feat/office-agent-transcript`, 8 commits, TDD, `pnpm verify` green
(agent-office + gui 108 office tests). Phase B (talk to agent) deferred.

## [2026-06-23] feature | agent chat (Phase B)

Talk to an office agent: message box in the transcript panel → `POST .../chat` →
`user` turn + queued task + drain (resumes claude session for continuity) → reply
streams into the Phase A feed. Per-agent drain serializer (in-process Map) fixes
double-spawn TOCTOU + stranded chat follow-ups; 409 on non-runnable agent; server
trims blank messages. Branch `feat/office-agent-chat`; reviewed by code-reviewer +
critic (3 race findings fixed); `pnpm verify` green; agent-office + gui tests pass.

## [2026-06-24] feature | local llm-proxy Phase 0

New @megasaver/llm-proxy + `mega proxy start`: opt-in transparent local Anthropic
proxy (127.0.0.1) that forwards verbatim + meters real token usage per /v1/messages
(counts only — never prompts/responses/keys). Foundation for conversation-token
saving (compression = Phase 1). Relaxed mission §1 ("not a model proxy" → opt-in
allowed) via conventions:sync. Risk CRITICAL; security+critic+code reviews applied
(SSE-undercount + backpressure + loopback fixes). Branch feat/llm-proxy-phase0.

## [2026-06-26] feature | 3 ContextOps features shipped (#2→#1→#3)

Three features built (brainstorm→spec→plan→TDD→verify→adversarial review per
feature; #1/#3 via dynamic multi-agent workflows) and merged to main in the
recommended build order:
- **intent-aware hook** (Phase 6b, PR #180) — UserPromptSubmit hook `mega hooks
  intent` writes the redacted prompt to `session-intent.json`; saver hook
  fill-gap-injects it as ranking intent. Risk MEDIUM. See [[concepts/intent-aware-hook]].
- **diff-on-reread** (PR #181) — unchanged re-reads return a lossless
  `unchanged-marker` (prior chunkSetId) via a per-session sha256 read-index,
  skipping re-filter/re-persist. Risk HIGH. See [[concepts/diff-on-reread]].
- **semantic AST read** (PR #182) — source files chunk on AST boundaries (reuses
  [[entities/indexer]] extractors), line-chunk fallback otherwise. Risk HIGH. The
  indexer is lazy dynamic-imported so the TS compiler stays off the hot path
  (filterOutput is now async) — see [[decisions/lazy-load-heavy-deps]] and
  [[concepts/semantic-ast-read]]. Two CI failures caught + fixed before merge
  (ubuntu eager-load timeout; windows ESM-URL guard test).

## [2026-06-26] update | wiki sync for the 3 features

Updated 10 pages (entities output-filter/context-gate/cli/content-store/
connectors-claude-code/indexer; concepts context-gate-pipeline/context-pruning-engine/
semantic-repo-index; synthesis post-v1.1-roadmap), created 5 (concepts
intent-aware-hook/diff-on-reread/semantic-ast-read; decision lazy-load-heavy-deps;
source post-v1.1-features), and catalogued the new pages in index.md.

## [2026-06-29] feature | outline-first-read

Spec + plan authored, 7-task subagent-driven implementation across 4 packages
(`@megasaver/output-filter`, `context-gate`, `daemon`, `mcp-bridge`): `outlineFile`
parser, `partitionFile(Infinity)` bodies-as-chunks persist, `\0outline` read-index
key, daemon forwarding, e2e round-trip test. Lossless skeleton reads — agents
expand only the bodies they need via `mega_fetch_chunk`.

## [2026-06-29] review | outline-first-read final pass

code-reviewer (ready-to-merge) + adversarial critic. Critic blocker fixed:
co-located decls sharing a line collapsed to duplicate `#id`s + inflated count
→ dedupe skeleton by chunk id (`fix(output-filter): dedupe co-located decls`).
Verified safe: redaction (skeleton + bodies on post-redact text), fetch-id
ordering, `\0outline` slot isolation, line coverage. Known limitation (opt-in):
skeleton may exceed raw bytes on tiny/dense files; no size-threshold fallback.

## [2026-06-29] feat | outline size floor

Closed the "skeleton may exceed raw bytes" limitation above. `filterOutput`
now takes the outline branch only when `skeletonBytes < 0.9 * rawBytes`
(`OUTLINE_MAX_SKELETON_RATIO`); otherwise falls through to the normal
rank/fit read (lossless — it persists its own chunks). TDD: tiny/dense file
falls back, body-dominant file still outlines. Reviewer: 1 redundant-decl
cleanup + 1 test-assertion tightened (assert the 0.9 ratio, not just <raw).
`pnpm verify` green (44/44). patch changeset @megasaver/output-filter.

## [2026-06-29] feat | context-pruner git co-change ranking signal

Added a deterministic git-history co-change factor to the LAMR scorer
(spec: docs/superpowers/specs/2026-06-29-context-pruner-cochange-signal-design.md,
risk MEDIUM). New `packages/context-pruner/src/cochange.ts`:
`parseNumstat(raw)` builds a per-file co-change map + churn + global
peak from `git log --numstat` text; `coChangeStrength(map, file,
changedFiles)` scores co-evolution with the edit site, normalized 0..1
by the global peak. Wired `coChangeRelevance` into `ScoreFactors`
(strict schema), `scoreBlocks`, `finalScore`, with `WEIGHTS.coChange =
0.5` (below `dependency`). Raw text injected via
`ScoreInput.coChangeLog`, memoized per process (no shell-out in the
scored core — pure/no-LLM/no-I/O). No-op on empty/absent history:
factor 0, ranking byte-identical, never throws. TDD: 10 new tests
(map+churn from a fixture numstat string, factor raises a co-changing
block's score, unrelated file stays 0, empty history no-op).
context-pruner suite 54/54 green; typecheck + biome green; downstream
mcp-bridge/cli typecheck green (optional field, backward compatible).
minor changeset @megasaver/context-pruner.

## [2026-06-29] fix | wire git co-change into production callers (review)

Review caught the signal was inert end-to-end: the engine was correct
but no shipped caller passed `coChangeLog`, so `coChangeRelevance` was 0
in every production path. Added the I/O edge
`packages/context-pruner/src/read-cochange-log.ts` —
`readCoChangeLog(cwd)` shells out `git log --max-count=1000 --numstat`
once per cwd (memoized via a `Map`), returns `""` on any failure (not a
git repo / git missing / empty history) so the scorer treats it exactly
like an absent log. Kept out of the scored core (`score.ts` stays pure).
Wired into the MCP `packFor` (`project.rootPath`) and CLI `loadPack`
(`ctx.project.rootPath`). GUI `workspace-context` route intentionally
left unwired with a `ponytail:` note: the workspace key is a one-way
FNV hash (encodeWorkspaceKey) with no cwd reverse-lookup, so there is no
repo path to run `git log` against — deferred to Phase 4 cwd-scoped work
(same blocker as memoryFiles). Integration test added to
`packages/mcp-bridge/test/tools/context-tools.test.ts`: a real temp git
repo whose `migrations/001.md` co-changes with `src/auth.ts` across 3
commits proves the migration's `coChangeRelevance > 0` through
`handleGetRelevantContext` (the MCP entrypoint), vs 0 for the no-git
baseline. context-pruner 54/54, mcp-bridge 238/238, typecheck + biome
green on changed files. changeset updated to note the new
`readCoChangeLog` export.

## [2026-06-30] feat | WS2 cross-file call resolution (import bindings)

Branch `feat/indexer-binding-resolution`. Added light import-binding
call resolution to `@megasaver/indexer` (no `ts.Program`): `resolve-fqn.ts`
(`resolveModulePath`/`resolveCallFqn`/`blockFqn`), `extractTs` now attaches
a transient per-file `importBindings` map, `buildIndex` writes additive
optional `resolvedCalls`/`resolvedCalledBy` FQN edges on `CodeBlock`.
FQN `<module>#<name>`: relative specifier → repo file path
(`.ts/.tsx/.mts/.cts/.js/.jsx` + `/index.*`), bare npm specifier kept,
local call upgraded to same-file FQN. Two same-named functions in
different files now disambiguate → no false cross-file `calledBy`.
Consumers (context-pruner `selectImpact`, `selectPack`) prefer resolved
edges via a `byFqn` map, fall back to name-based when absent (py/go/rust
+ old indexes unaffected). Proof test: name-based `calledBy` lists BOTH
useA+useB on each same-named `parse` (the bug); `resolvedCalledBy` lists
only the true caller. Incremental rebuild keeps resolved edges on reused
blocks. `pnpm verify` green (46/46 turbo tasks, exit 0); indexer 97+2skip,
context-pruner 61, mcp-bridge impact 4. Deferred to full-LSP:
re-exports/barrels, dynamic import, namespace-member calls, path aliases.
Spec: docs/superpowers/specs/2026-06-30-binding-resolution-design.md.
Updated entities/indexer.md + entities/context-pruner.md.

## [2026-06-30] review | WS2 per-edge name fallback fix

Code review (cavecrew-reviewer) caught 2 reds: (1) namespace-member
calls (`ns.run()`) extract bare `run`, binding is `ns`, so the FQN stays
unresolved `#run`; (2) a present-but-incomplete `resolvedCalls`/
`resolvedCalledBy` suppressed the name fallback → lost edges the name
path had (recall regression). Root-cause fix: build records unresolved
caller edges under `#<name>` and unions that bucket into the callee's
`resolvedCalledBy`; select.ts resolves each FQN edge with a PER-EDGE
`byName(nameFromFqn)` fallback. Invariant: resolved mode is a refinement
of name mode (removes false same-name edges only, never true ones).
New regression tests: indexer namespace end-to-end + pruner per-edge
fallback. verify green exit 0.

## [2026-06-30] fix | WS2 recall-safe reverse call resolution

Independent critic found 2 CRITICAL recall-loss bugs (true callers
DROPPED from mega_impact), both reproduced RED end-to-end. Root cause
(asymmetry): reverse traversal uses build-time-materialized
`resolvedCalledBy`; an edge resolving to an FQN that owns no current
block landed in no readable bucket → caller lost once another caller
populated the bucket. C1: NodeNext `.js` ESM specifiers (`./m.js` for
source `m.ts`) didn't resolve. C2: incremental staleness — a reused
caller keeps a stale resolvedCalls FQN after its target file is renamed.
Fixes: (1) resolveModulePath remaps `.js/.jsx/.mjs/.cjs` → TS-source
suffix so idiomatic `.js` imports resolve PRECISELY; (2) build invert
pass buckets any DANGLING edge (FQN owns no current block) under the
`#name` floor, recovered by select.ts per-edge byName fallback. Precise
edges stay precise → false same-name cross-file edges still excluded (not
a blunt name-union, which the critic verified breaks impact-resolved).
Invariant: resolvedCalledBy ⊇ all true callers. 2 RED→GREEN e2e repros
+ a `.js`-precise disambiguation test in
packages/context-pruner/test/impact-recall-e2e.test.ts; impact-resolved
stays green. verify exit 0 (indexer 98+2skip, context-pruner 65,
mcp-bridge impact 4). Updated build.ts ponytail comment to reflect real
dangling-edge behavior.

## [2026-06-30] feat | WS3 memory superset increment 1

Built three additive layers on the existing memory stack (DIMMEM +
memory-graph + embeddings substrate); kept the moat (evidence ledger +
approval gate + agent-agnostic shared + lossless local). Spec:
`docs/superpowers/specs/2026-06-30-memory-superset-design.md` (HIGH risk;
feature matrix vs mem0/Letta/Zep/Cognee/Memori/claude-mem; layers 3-6
deferred as named sub-specs). New wiki page [[concepts/memory-superset]].
(1) Semantic recall: per-project sidecar
`<storeRoot>/memory/<projectId>.embeddings.jsonl` keyed by memory id
(`embedMemoryEntries` in packages/core/src/embed-memory.ts), incremental
by a title+content hash, opt-in (no model on import). New
`searchMemoryEntriesSemantic` ALONGSIDE BM25; `get_relevant_memories`
boundary-embeds the task best-effort, semantic-ranks when a sidecar
exists, else falls back to BM25 (never throws). Mirrors the WS1
embed-blocks / context-pruning pattern. (2) memoryRelevance wiring: CLI
(apps/cli/.../context/shared.ts) + MCP (context-pruning.ts) now feed the
pruner factor from ALL approved non-stale memories' relatedFiles
(`approvedMemoryFiles`) instead of a BM25-narrowed subset that silently
dropped approved memories whose prose missed the task. (3) Entity layer:
`entity` node kind + `entity-mention` edge kind in memory-graph;
deterministic (NO LLM) extraction from relatedSymbols/relatedFiles
(`entity:symbol:` / `entity:file:` prefixes). CI model-free: vectors
injected in tests, real embed() gated `it.skipIf(!MEGA_EMBED_E2E)`;
`pnpm verify` exit 0 under `TRANSFORMERS_OFFLINE=1` (46/46 tasks; core
488, memory-graph 58, context-pruner 65, mcp-bridge 244, cli 739).
MEGA_EMBED_E2E=1 smoke passed (real multi-dim vector written). Changeset
minor: core, memory-graph, mcp-bridge.

## [2026-06-30] fix | WS3 partial-sidecar silent recall loss (critic BLOCKER)

Independent HIGH-risk critic caught a Critical recall-loss bug (same class
as the WS2 reverse-call bug) in `semanticMemoryRanking`
(packages/mcp-bridge/src/tools/get-relevant-memories.ts). It fell back to
BM25 only when the sidecar was ABSENT or empty; a PARTIAL sidecar (vectors
for some approved memories, not all) proceeded to semantic ranking, which
drops any memory whose vector is missing → a true approved memory silently
vanished, reported as success. This is the DEFAULT steady state: no
production path embeds on write, so any memory created/approved after the
last manual sidecar build is un-vectored. Fix: a full-coverage guard at
the existing decision point — if any approved non-stale candidate lacks a
vector in the loaded map, return null → BM25 fallback (returns all
matches). Net guarantee: results are full-coverage semantic OR BM25, never
a silently-truncated mix. Surgical (one filter + one guard, +17/-5 lines,
no new abstraction). Regression test (RED→GREEN): 3 approved memories all
matching, sidecar covers 2 → handler returns all 3 (pre-fix returned 2).
Kept: full-coverage sidecar → semantic ranking; no sidecar → BM25. Attack
B (all-approved-memory memoryRelevance wiring) ruled acceptable for v1 by
the critic (binary per file, weight 0.7, bounded) — noted in the spec as a
known imprecision to re-scope to task-relevant memories in a follow-up.
`pnpm verify` exit 0 under `TRANSFORMERS_OFFLINE=1` (46/46; mcp-bridge now
245). Spec 1A + 1B updated with the coverage guard + the imprecision note.

## [2026-06-30] feat | WS3 inc-2: memory index build (semantic recall goes live)

`embedMemoryEntries` had zero production callers, so the memory-vector
sidecar was never populated and `get_relevant_memories` always tripped its
full-coverage guard → BM25. Added the missing on-demand build (mirrors
`mega index build` for code, NOT auto-embed on save — that would load the
~50MB model on the memory write hot path).

- `@megasaver/core`: `buildMemoryIndex(storeRoot, projectId, entries,
  embedFn=embed)` (packages/core/src/embed-memory.ts). The vector sidecar
  stores `{id, vector}` only (no hash), so incrementality needs a manifest
  the way blocks have one: added a tiny id→hash sidecar
  `<projectId>.embeddings.hashes.json`, written after each build, read back
  as `priorHashById` next build. Unchanged memory (vector present AND hash
  matches) carries forward; only new/changed re-embed. Returns
  `{ embedded, carried, total }`.
- CLI `mega memory index <project>` (apps/cli/src/commands/memory/index-build.ts).
- MCP `mega_index_memory` (packages/mcp-bridge/src/tools/index-memory.ts +
  server.ts dispatch + tool-name.ts; tool enum 27→28, no proxy twin).

End-to-end gap-closed proof (model-free, fake embed): before a build,
`handleGetRelevantMemories` returns the BM25 fallback (a lexical-only
memory); after `handleIndexMemory`, full coverage exists → semantic path
returns a vector-ranked order BM25 cannot produce. TDD red→green. Per-pkg
suites green: core 492, cli 742, mcp-bridge 247. `embedFn` injected in
tests; real embed E2E-gated (MEGA_EMBED_E2E) so CI loads no model.
Changeset minor: core, cli, mcp-bridge.

## [2026-06-30] feat | M1: bi-temporal memory validity (Zep/Graphiti-class)

Sub-spec 3 of the memory superset, shipped. Two time axes: transaction
time (`createdAt`/`updatedAt`, already existed) and valid time (new). A
fact can be superseded by a newer one without deleting the old one — the
lossless moat (audit / time-travel preserved).

- `@megasaver/core` (memory-entry.ts): additive optional `validFrom`,
  `validTo` (null/absent = still valid), `supersedesId` on `MemoryEntry`
  AND `overlayMemoryEntrySchema`; `validTo` added to the update patch.
  `isCurrent(memory, asOf)` = `validFrom <= asOf && (validTo == null ||
  asOf < validTo)` (half-open upper bound). Rows without the fields read
  as current → old stores load unchanged (back-compat).
- Recall (memory-search.ts + memory-search-semantic.ts): both filter to
  `isCurrent(entry, asOf ?? now)` alongside the existing approved/non-
  stale gates; both gained an optional `asOf` time-travel parameter.
- Supersede gate (mcp-bridge/approve-memory.ts): approving a memory whose
  `supersedesId` is set closes the superseded memory's `validTo = now`
  (kept, not deleted). `save_memory` accepts `supersedesId`; `recall` /
  `get_relevant_memories` thread `asOf`.
- Graph: the pre-existing `supersede` edge kind is now emitted from the
  recorded `supersedesId` by the CLI (graph.ts) and GUI overlay
  (memory-graph route) builders — no change to memory-graph/src.

Deterministic, no LLM, no embeddings for this layer. TDD red→green:
isCurrent bounds, supersede+time-travel (asOf before the close still
returns the old fact; supersede edge present), back-compat (no-bounds =
current). `pnpm verify` green (46/46 tasks); per-pkg: core 509, memory-
graph 58, mcp-bridge 250, cli 743. Changeset minor: core, mcp-bridge,
cli. Recall-loss check: a CURRENT memory cannot be wrongly dropped —
absent bounds ⇒ current, so every legacy + normal-new memory stays.

## [2026-06-30] fix | M1 review: centralize current-filter + validate supersedesId

Two independent reviews found the current-by-default filter was
re-implemented in 4 recall surfaces and 2 were missed — so a superseded
memory still returned on every path except the in-process MCP one.

- ROOT-CAUSE FIX: added ONE shared predicate `isRecallable(memory, asOf)`
  = `approval === "approved" && isCurrent(memory, asOf)` in
  `core/memory-entry.ts`, exported from core. Routed ALL recall surfaces
  through it: `memory-search.ts`, `memory-search-semantic.ts`, MCP
  `recall.ts`, daemon `handlers-registry.ts` (recallRegistryHandler), GUI
  `connector-context.ts`. Surfaces can no longer drift.
- BLOCKER 1+2 (daemon): `recallRegistryRequestSchema` was `.strict()`
  without `asOf` (a forwarded asOf → 400 → silent fallback) AND the
  handler filtered approval+scope only, never isCurrent — so with a
  daemon running, a closed-validTo memory STILL returned. Added `asOf`
  to the schema; filter via isRecallable(m, asOf ?? now). New daemon
  tests: closed memory filtered out of default recall; asOf round-trips
  (time-travel before the close returns the old fact).
- BLOCKER 3 (supersedesId tamper): supersedesId is agent-controlled
  (save_memory passes it; only UUID-shape checked). The approve gate now
  closes a target ONLY if it is a DIFFERENT memory in the SAME
  project+scope that exists and is still open. Prevents (a) closing a
  current memory in another project, (b) self-reference closing its own
  validity (approved-yet-vanished). New tests: cross-project not closed;
  self-reference stays current.
- MAJOR 4 (connector-context): wrote superseded memories into per-agent
  connector CONFIG FILES; now gated by isRecallable.
- MINOR 5: get-relevant-memories passed UNFILTERED entries to the
  semantic search while gating coverage on the filtered candidates; now
  passes `candidates` so gate and ranked-input are the same set.
- TEST-GAP: pinned the flaky default-recall test (it relied on wall-clock
  now > 2026-06-20, the fixture close date — would have failed in CI
  before that); added a clock-independent default-now case; added an
  isCurrent offset-format (`+03:00` vs `Z`) equivalence assertion; added
  isRecallable unit tests.

`pnpm verify` green (46/46). Per-pkg: core 514, daemon 107, mcp-bridge
252. Changeset now minor: core, mcp-bridge, daemon, cli.

## [2026-06-30] feat | M2: tiered memory + decay (Letta/MemGPT-class)

Built on M1. Deterministic, no LLM, no background timer; additive +
backward-compatible. Marks superset sub-spec 4 DONE.

- **Schema (`packages/core/src/memory-entry.ts`).** Optional `tier`
  (`working` | `recall` | `archival`) on `memoryEntrySchema`, the
  overlay variant, and the update patch. Absent ⇒ `recall` via the one
  `tierOf` helper, so legacy/normal rows keep their behavior. `tier` is
  patchable so the sweep can demote it.
- **Tier rides the centralized predicate.** `isRecallable(memory, asOf,
  { includeArchival? })` now excludes `archival` by default (sibling
  `isArchived`). All four isRecallable surfaces (MCP recall,
  get_relevant_memories, daemon recall, GUI connector-context) inherit it
  for free — no per-surface drift (the thing M1 fixed). The two search
  surfaces (`searchMemoryEntries` / `searchMemoryEntriesSemantic`) gained
  a matching `includeArchival` + archival field-filter.
- **Decay = read-time pure fn.** `effectiveConfidence(memory, now)` =
  baseWeight(confidence) × ageDecay(now − updatedAt, 30-day half-life) ×
  tierWeight(tier, working +10%). Wired into `searchMemoryEntries` as a
  multiplier on BM25 scores → aged/low ranks below recent/high. ADDITIVE:
  always > 0, only down-ranks, never drops a current memory.
- **Sweep = the ONLY mutation.** `mega memory sweep <project>` CLI +
  `mega_memory_sweep` MCP tool (registered in tool-name.ts/server.ts,
  bumping the closed tool set 28→29 and its drift guards). Deterministic,
  lossless policy: closed/superseded OR stale OR (low confidence AND
  inactive ≥ 90d) → `tier=archival` via `updateMemoryEntry`. Working tier
  never swept. `--json` ⇒ `{archived, scanned}`; idempotent.
- **RECALL-SAFETY** test (`memory-tier-decay.test.ts`): a current
  working/recall memory is recallable, has effectiveConfidence > 0, and is
  never a sweep candidate — even old + low. All time pinned (no
  wall-clock), avoiding the M1 flake class.

Per-pkg green: core 67 files / 539 (+2 skip), mcp-bridge 39 / 255,
daemon 10 / 107, cli 75 / 747. Changeset minor: core, mcp-bridge, cli,
daemon (daemon re-exports core).

## [2026-06-30] feat | M3: semantic canonicalization on approve (mem0/Cognee-class)

Sub-spec 5 of the memory-superset design, marked DONE. SURFACE-only
near-duplicate detection at the approval gate — never auto-block, never
auto-mutate; the human + the M1 supersede gate do the canonicalizing.

- **Where.** `packages/mcp-bridge/src/tools/approve-memory.ts`, on the
  approve SUCCESS path only, AFTER the existing exact-dup hard-reject and
  the validation/conflict gate. The memory has already flipped to
  `approved`, so a near-dup is SURFACED on a still-successful approval.
- **Pass.** `semanticDuplicates(env, candidate)`: read the memory-vector
  sidecar (`memoryEmbeddingsSidecarPath`), embed the candidate's
  `title+content` (`memoryEmbedText`), cosine-compare to the sidecar
  vectors of the OTHER approved+current (`isRecallable`) memories.
  `cosine >= NEAR_DUP_THRESHOLD` (0.95, deterministic const) ⇒ collect id.
  Archival / closed / unapproved memories are NOT targets.
- **Surface.** A match writes a `semantic-duplicate` reason + the matched
  id(s) in the validation sidecar's `conflictIds` (status stays `valid`),
  and the same is returned in the result so the human sees it. They then
  re-approve with `supersedesId` (M1) to merge. One threshold, one reason.
- **Best-effort / graceful.** No sidecar / no candidate vector / `embed`
  throws ⇒ the pass yields no matches; approval and the exact-dup behaviour
  stay byte-identical and NEVER throw. Mirrors get-relevant-memories'
  semantic pass (try/catch-returns-empty). `ApproveMemoryEnv` gains an
  optional injectable `embedFn` (defaults to real `embed`); the server
  does not pass it ⇒ production uses the real model, CI uses injected
  vectors (model-free).
- **TDD (model-free).** New `approve-memory-canonicalization.test.ts`:
  near-dup surfaced (approval succeeds + reason + matched id), far ⇒ no
  reason, no sidecar ⇒ graceful, archival target ignored, embed-throws ⇒
  approval unaffected. Real-embed E2E gated `MEGA_EMBED_E2E` (verified once
  manually: model loaded, near-identical memory surfaced end-to-end). Time
  pinned, no wall-clock.

Full `pnpm verify` green (46/46 turbo tasks, model-free) — covers the
daemon's dist-resolution of core. mcp-bridge 40 files / 260 (+5 new,
1 E2E skip). Changeset minor: mcp-bridge (only `ApproveMemoryEnv` public
shape changed).

## [2026-06-30] feat | M4: transcript→memory (claude-mem-class, deterministic)

Realizes the deferred memory-superset roadmap item 6 — session distillation
— DETERMINISTICALLY, no LLM (overrides the spec's "LLM opt-in" framing for
this increment). Spec:
`docs/superpowers/specs/2026-06-30-memory-from-session-design.md`.
Branch `feat/memory-from-session`.

- **Source = FailedAttempt rows, not raw chunk-sets.** A session's recorded
  failures already live in the registry as `FailedAttempt` (keyed by
  sessionId, with structured `task`/`failedStep`/`errorOutput`/`relatedFiles`/
  `suspectedCause`). The output-filter parsers (`parseTestOutput`,
  `parseTsDiagnostic`, `parseStacktrace`) return bare `Chunk[]`
  (`{ text, startLine, endLine }`) — classified TEXT, no structured fields —
  so re-parsing them would reimplement what FORGE structured at record time.
  Reuse the structured rows instead.
- **Extractor** (`packages/core/src/session-memory.ts`, pure):
  `extractSessionMemories({ sessionId, projectId, failedAttempts })`. Test-
  shaped failure → `test_behavior`, else `bug` (source `test_failure`);
  `DECISION:`/`decided to` marker → `decision` (source `session_summary`).
  Each candidate: `scope:"session"`, `confidence:"low"`, `approval:"suggested"`,
  title from `failedStep` first-line, content = step + first error line +
  suspected cause, relatedFiles carried. Dedupe within session by contentHash
  (sha256 of type+title+content, 16 hex). `dedupeKey = failureId:contentHash`.
- **CLI** `mega memory from-session <session>` + **MCP** `mega_memory_from_session`
  ({ sessionId } → { suggested, skipped }). Resolve session→project via
  `getSession`, filter `listFailedAttempts` to the session, create suggested
  memories, print `suggested=N skipped=M` (--json). Never auto-approves.
- **Idempotent.** Each staged memory carries `from-session:<dedupeKey>` in its
  keywords; the command skips a candidate whose dedupeKey is already staged on
  the project. Re-run ⇒ `suggested=0 skipped=N`. Lossless (never deletes).
- **Recall-safe.** Suggested memories fail `isRecallable` and are excluded from
  `searchMemoryEntries` (only `includeUnapproved` surfaces them) — they don't
  leak into recall until a human approves. M3 then surfaces semantic dups at
  the approve gate.
- **TDD, model-free.** core: 6 tests (classify, dedupe-collapse, decision,
  empty, NOT-recallable-until-approved). cli: 4 (stage + dup collapse +
  cross-session filter, idempotent, --json, unknown-session). mcp: 4 (stage,
  idempotent, unknown-session, malformed). Tool-count regression tests bumped
  29→30 (+`mega_memory_from_session`, no proxy twin). Time/ids pinned.
- **Smoke:** built CLI run twice on a seeded store ⇒ `suggested=2 skipped=0`
  then `{"suggested":0,"skipped":2}`; staged rows are `suggested` test_behavior
  + bug; `memory search` surfaces neither.

Changeset minor (core + cli + mcp-bridge public surface). Additive — no change
to the memory data model, approval gate, or FORGE/learn behaviour.

## [2026-06-30] feat | M5: task-scope memoryRelevance (final memory-depth layer)

Closes the WS3-inc1 §1B "Known imprecision (v1, accepted)" follow-up. Both
context-pruning boundaries fed ALL approved memory's `relatedFiles` to the
`memoryRelevance` factor, boosting every memory-touched file on every task
regardless of task relevance (broad, signal-diluting). Spec follow-up marked
DONE: `docs/superpowers/specs/2026-06-30-memory-superset-design.md` §1B.
Branch `feat/memory-relevance-taskscope`.

- **Pure core helper** (`packages/core/src/task-relevant-memory-files.ts`):
  `taskRelevantMemoryFiles(memories, { taskVector, memoryVectors, topK, floor })`
  ranks approved, non-stale memories that have a sidecar vector by
  `cosine(taskVector, memoryVector)`, keeps the top-K (default 10) above a small
  floor (0.1), returns the deduped, order-stable union of THEIR `relatedFiles`.
  The narrowed counterpart of `approvedMemoryFiles`. **Eligibility mirrors
  `approvedMemoryFiles` EXACTLY** (`approval === "approved" && !stale`, no
  validity/tier gating) so the scoped set is always a task-filtered SUBSET of the
  fallback — never stricter — and the signal cannot flip on whether a sidecar
  exists (review fix; the first pass over-gated via `isRecallable`, which excluded
  expired/archival approved memories the no-sidecar fallback would include).
  Deterministic: ties break by id.
- **Best-effort orchestrator** (same file): `taskScopedMemoryFiles({ storeRoot,
  projectId, memories, task, taskVector?, topK?, floor?, embedFn? })` loads the
  memory-vector sidecar via `readVectors(memoryEmbeddingsSidecarPath(...))`, uses
  the INJECTED task vector (reused) or embeds `task`, calls the pure helper.
  Returns null on no/empty sidecar, no task vector, or ANY failure → never throws.
  Mirrors `get-relevant-memories.ts` / `embeddingSignalFor`.
- **Both boundaries** now `taskScopedMemoryFiles(...) ?? approvedMemoryFiles(...)`:
  - MCP `context-pruning.ts`: threaded an optional `embedFn` into
    `ContextToolEnv` + `embeddingSignalFor`; REUSES the task vector the
    code-block `embeddingRelevance` signal already computes (no double-embed).
  - CLI `context/shared.ts`: no pre-computed task vector → orchestrator embeds
    best-effort via core's real `embed` only when a sidecar exists; CLI gains NO
    new `@megasaver/embeddings` dep edge (the embed lives inside core).
  - `staleMemoryFiles` unchanged.
- **Recall-safe.** No-sidecar / no-task-vector / embed-failure all fall back to
  the all-approved set → today's behavior is byte-identical; a genuinely
  task-relevant memory's file is never dropped.
- **TDD, model-free.** core: 10 tests (pure: near-in/far-out, topK, dedupe,
  approved+non-stale gating, EXPIRED-included [eligibility mirrors
  `approvedMemoryFiles`, not stricter], recall-safety; orchestrator: scoped with
  sidecar+injected vector, null no-sidecar, embeds when no vector injected,
  null/no-throw on embed failure). mcp: +4 (irrelevant-not-boosted with sidecar,
  relevant-boosted, fallback-identical no-sidecar, fallback-on-embed-failure).
  cli: +2 (all-approved fallback boost no-sidecar, never-throws). Injected
  vectors; real `embed()` E2E-gated. Daemon resolves core from dist → core
  rebuilt before mcp/cli tests.

Changeset minor (core + mcp-bridge + cli public surface). Additive, surgical,
best-effort, deterministic, CI model-free.

**Review fix (2026-06-30, target-set asymmetry).** Both the spawned reviewer and
the coordinator's independent critic flagged one Important finding: the scoped
helper's eligibility gate (`isRecallable || stale`) applied bi-temporal validity
+ archival-tier filters that the fallback `approvedMemoryFiles` (`approved &&
!stale`) does not, so an approved+non-stale-but-EXPIRED/ARCHIVAL memory's files
were dropped from the scoped set but kept in the fallback — the `memoryRelevance`
signal flipped on whether `mega memory index` had run. Fixed: scoped gate now
mirrors `approvedMemoryFiles` exactly; task ranking (cosine top-K) is the only
narrowing. `asOf` dropped from both helper signatures (unused after the fix).
+1 core test (EXPIRED-included). Full `pnpm verify` green (46/46), model-free.

## [2026-07-01] fix | v1.2.1: externalize transformers from CLI bundle

- **Bug (published v1.2.0).** `@megasaver/cli@1.2.0` shipped at 15.7MB:
  `apps/cli/tsup.bundle.config.ts`'s `noExternal:[/.*/]` inlined
  `@huggingface/transformers`, so esbuild copied six `onnxruntime_binding-*.node`
  natives (CI-built for one OS) into the tarball — dead weight off that OS, and
  embeddings broke on every other platform (the inlined natives were the wrong ABI).
- **Fix (PR #209).** Externalize the `@huggingface/transformers` + `onnxruntime-node`
  chain; declare transformers an `optionalDependency` so npm pulls the host-platform
  native. tsup's `noExternal` beats esbuild's `external`, so the blanket rule became a
  negative lookahead excluding the chain. typescript stays inlined (static import, no
  graceful fallback) so standalone `mega index` still runs. See
  [[decisions/bundle-externalize-native-chain]].
- **Guard (TDD).** `bundle-smoke.test.ts`: no `.node` files, no `onnxruntime_binding`
  inline, `mega.mjs` < 12MB. RED (13.2MB/6 natives) → GREEN (11.2MB/0).
- **Verification.** `pnpm verify` green (756 CLI tests); CI green ubuntu + windows;
  standalone bundle runs `doctor` with transformers absent; embed paths degrade
  clean. Adversarial critic verdict SAFE TO PUBLISH; diff review clean.
- **Shipped.** v1.2.1 published to npm: **3 files, 0 natives**, 1.9MB tarball,
  `optionalDependencies` present. Install smoke on darwin: `mega memory index` →
  `embedded=1` — embeddings restored on the platform v1.2.0 broke.

## [2026-07-02] query | frontend GUI bug hunt completed

Fixed stale-response race conditions in `apps/gui` data-fetching components:
- `WorkspaceSessionList` polling guard + retry via `refreshNonce`.
- `MemoryPanel`, `TasksPanel` effect guards via `live` flag + `refreshNonce`.
- `TokenSaverPanel` polling guard + retry via `refreshNonce`.
- `WorkspaceContextPanel` submit guard via monotonic request ID ref.

Added regression tests for each scenario. `pnpm verify` green (lint, typecheck, test, conventions). Bridge runtime smoke returned `{"ok":true}`.

Spec: `docs/superpowers/specs/2026-07-01-frontend-gui-bug-hunt-design.md` (on `main`).
Plan: `docs/superpowers/plans/2026-07-01-frontend-gui-bug-hunt-plan.md`.
Branch: `worktree-frontend-gui-bug-hunt`.

## [2026-07-02] lint | Agent Setup functional fix

Made the GUI `Agent Setup` view functional end-to-end:
- Added `GET /api/projects` bridge route so the doctor can list persisted projects.
- Updated `AgentSetupDoctor` to load projects, auto-select a single project, render a `<select>` for multiple projects, and pass the selected project name to `installMcp`/`repairMcp`.
- Fixed `createMcpOps.connectorSyncedResolver` to scan all projects for the connector block instead of requiring an open session for the agent.
- Guarded the doctor's status fetch with a request-id / unmount flag to prevent stale responses.
- Added/updated regression tests: `projects-route.test.ts`, `mcp-ops.test.ts`, `agent-setup-doctor.test.tsx`, `agent-setup-row.test.tsx`.

Verification: `pnpm verify` green (lint, typecheck, test, conventions). CLI e2e `v1-closeout-flow.test.ts` 5/5 pass. Bridge smoke returned the project list and MCP status correctly.

Spec: `docs/superpowers/specs/2026-07-02-agent-setup-functional-design.md`.
Plan: `docs/superpowers/plans/2026-07-02-agent-setup-functional-plan.md`.
Branch: `feat/agent-setup-functional-fix`.

## [2026-07-02] diagnose | token-saver "savings not increasing" live investigation

Live diagnosis of frozen saved-tokens counter (session 45479c3f). Findings:
1. Pipeline HEALTHY: synthetic PostToolUse payload through `mega hooks saver`
   (cwd=MegaSaver, enabled workspace e02b98f66e82b6b9) compressed 138000→89 B
   and wrote events.jsonl. Daemon (pid 64943) + store + compressor all work.
2. verifywise worktree session (workspace e7fc032a769ee0a5 =
   fnv1a("/Users/halitozger/Desktop/verifywise/.claude/worktrees/practical-euler"))
   has NO workspace-token-saver.json → saver passthrough by design
   (saver-run.ts readSettings null gate). Per-cwd workspace key means enabling
   the main repo dir does NOT cover its worktrees — product design gap.
3. Claude Code hooks stopped executing in Desktop-app MegaSaver sessions after
   2026-07-01 17:32 local: zero PreToolUse log entries, zero saver events, zero
   compression markers (main + 144 subagent transcripts) since — despite >4KB
   eligible outputs and enabled+aggressive settings (updated 2026-07-02 13:20).
   Session 90550bc0 got 4 user prompts on 07-02 but intent hook never wrote →
   hooks dead in that live session; ~/.claude/settings.json rewritten 13:19
   (GUI Connect Saver hook toggle). Restarting the session should reload hooks.
4. No model dependence in saver (bytes/4 estimator) — claude-fable-5 does not
   affect savings accounting.
5. `mega proxy` (pid 83857) up but proxy-usage/usage.jsonl last written
   06-24: no agent points ANTHROPIC_BASE_URL at it.

## [2026-07-02] design | persistent proxy routing + saver inheritance

Opened two linked designs from the live token-saver diagnosis:

- CRITICAL persistent proxy routing: dedicated `proxy supervise` service,
  shared CLI/GUI control state, nonce health + route lease, foreign-value guard,
  LaunchAgent migration/rollback, drain-safe stop, and honest traffic/hook
  status.
- HIGH Saver activation inheritance: exact → Git common-dir family → verified
  legacy root → explicit global default, with metadata-only hook heartbeats.

Independent architect and adversarial critic passes returned APPROVE after
blocking lifecycle, ownership, migration, worktree identity, concurrency, and
drain findings were resolved. Baseline `pnpm test`: 46/46 Turbo tasks green.

Specs:
`docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md` and
`docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md`.

## [2026-07-02] review | spec review: persistent-proxy-routing + saver-inheritance → REVISE

External reviewer pass (Claude Code, fresh 4-lens adversarial verification:
current-state fact-check, state-machine holes, git-identity edges, governance
gates). Verdict REVISE: 2 BLOCKING (proxy orphan-route unrecoverable after
SIGKILL+PID-reuse vs conjunctive stale-lock predicate; saver family-key
canonicalization lacks case/platform normalization → same repo hashes to
different families on APFS/NTFS), 12 MAJOR (disable crash-window re-route,
monitor vs SIGTERM self-unroute, kickstart -k kills draining supervisor,
drainingGeneration crash/reboot semantics, transition.lock staleness,
legacy-root key aliasing, repository-disable vs legacy exact precedence,
symlink-refusal contradiction, missing omc:tracer gate, uncited user
confirmation, aspirational security-reviewer frontmatter, missing critic
implementation pass, undefined cross-spec ordering), plus minors. Spec1
current-state claims all verified TRUE against worktree code. Full findings in
wiki/agent-channel.md 2026-07-02 19:05 entry. Plans blocked until amended.

## [2026-07-02] design | proxy + saver REVISE amendments submitted

Amended both linked specs against the external 2 BLOCKING + 12 MAJOR review.
Proxy changes include fenced PID/start-token/boot/instance ownership, strict
transition unions, route-safe crash recovery, conservative drain preservation,
journal-authoritative launchd transactions, authenticated GUI boundaries,
redacted errors, and bounded owner-only usage telemetry. Saver changes include
volume-case-aware SHA-256 repository identity, verified family schemas, legacy
precedence/alias rules, descriptor-safe activation storage, and bounded
future-skew-resistant hook heartbeats. Independent CRITICAL design passes from
security-reviewer and tracer evidence-loop returned APPROVE. Implementation
plans remain blocked until Claude Code repeats its four-lens review and approves
the amended specs. See wiki/agent-channel.md 2026-07-02 23:08.

## [2026-07-02] review | re-review of 8811bab5 → REVISE round 2 (narrower)

Same 4-lens method (2 fix-verification + 2 fresh new-hole lenses). Result:
24/26 round-1 findings verified-fixed with concrete testable rules, including
both BLOCKINGs (fenced owner identity/exit-75/--recover; file-identity +
caseMode canonicalization). Amendment introduced new findings: 1 BLOCKING
(transition_incomplete states forbid their own retry — designed deadlock; no
escape row for journal mismatch), 7 MAJOR (migration rollback crash cuts
unenumerated; fence CAS unimplementable over atomic-rename with two lock
authorities; offline_cli lease undecidable after lock release; stale
client-close confirmation reusable; single transition slot silently
overwritable in the handoff window; dev:ino family key not durable across
remount/restore → silent deactivation; dev:ino reuse activates compression in
the wrong repo) + carried #13 (security-reviewer/tracer APPROVE is
self-assertion co-committed with the amendment; artifact or pending required;
re-run needed post-round-2 regardless). Recommendation recorded: consider
cutting the auto-migration/uninstall transaction subsystem (operator-installed
plist, one machine) for a documented manual migration — removes the root of
findings 1/2/5. Full detail: wiki/agent-channel.md 2026-07-02 23:55 entry.
Plans remain blocked.

## [2026-07-03] amend | round-2 findings resolved in both specs (author: Claude Code)

User-directed (chat, 2026-07-02 evening; confirmation record in
agent-channel.md 00:15). Proxy: migration/uninstall journal subsystem CUT
(manual legacy bootout via legacy_service_present; stateless idempotent plist
ops) — removes the round-2 BLOCKING deadlock and 3 MAJORs at the root; durable
handoffDeadline decides released-transition liveness; owner rewrites serialized
under transition.lock (no CAS-over-rename); transition_in_progress guards the
single slot; --recover is the universal escape; monitor observe-only while a
transition is retained. Saver: family identity flipped to canonical
common-directory PATH (caseMode-aware) — durable across reboot/remount/restore,
inode-recycling wrong-repo activation impossible; no-commondir layouts key to
the worktree root (hostile .git-file adoption killed); degraded-precedence
fail-closed, v1 rewrite scope, toggle scope echo, non-mutating status reads,
telemetry contract pinned. Verification (fresh contexts): security-reviewer
APPROVE_WITH_NOTES + tracer evidence-loop APPROVE_WITH_NOTES (artifacts
archived under docs/superpowers/reviews/ — new standing requirement),
fix-verification APPROVE (all round-2 items closed), fresh-eyes found 3
amendment-introduced contradictions — fixed same session, all reviewer notes
incorporated. Pending gate: Codex counter-review of the round-2 amendments
(author≠reviewer), then plans in fixed order (saver first).

## [2026-07-03] review+amend | round-2/3 counter-review by fresh contexts → APPROVE

Codex out of credits; counter-review run by fresh Claude subagent contexts.
Round-2 (of the migration-cut + dev:ino-flip amendments): 2 BLOCKING + 8 MAJOR
— notably a separate-git-dir correctness regression the author's own round-2
"no-commondir→worktree-root" change introduced (main + linked worktree got
different family keys; caught against real git). Round-3 fixed all 17: revert to
common-dir keying + foreign_worktree_admin rejection; global latestCompression
in the heartbeat registry; bootstrap discriminant; recover-kind removed
(in-place recovery); executable precedence steps 0-4; v1-exact survives corrupt
.git; family write from a worktree; exact raw-key documented; full heartbeat
schema; RepositoryFamilyKey validator; ProxySafeErrorDetail mapped; telemetry
reader in stats/CLI layer. Round-3 verify: fix-verify + plan-readiness APPROVE;
fresh-eyes found one degraded-git precedence↔failure-handling contradiction →
fixed → confirmed CONSISTENT. Security + tracer round-2 artifacts stand for the
round-3 text (consistency/simplification deltas, foreign_worktree_admin a net
security gain). Artifact: docs/superpowers/reviews/2026-07-03-round2-round3-counter-review.md.
Both specs plan-ready. Next: write plans (saver 1 of 2, proxy 2 of 2).

## [2026-07-03] implement | saver activation inheritance S1–S10 shipped

Branch feat/saver-activation-inheritance. Full TDD (red→green→commit per task),
`pnpm verify` green 46/46 tasks. Delivers the fix for the 2026-07-02 live
finding (worktree sessions uncompressed under an enabled main repo). New
context-gate modules: family-identity (canonical-path key, durable across
reboot/remount/restore), git-family (bounded ≤32-ancestor/≤40-syscall common-dir
resolver, no git subprocess; separate-git-dir main+worktrees converge;
foreign_worktree_admin rejected), saver-store (v1 exact/family/global records +
legacy normalize, atomic 0600/0700, digest fail-closed, activation lock),
resolve-saver-settings (precedence steps 0–4; degraded git → global default,
legacy-under-degraded fail-closed), saver-heartbeat (256/30d/future-skew,
derived latest+latestCompression, non-mutating reads; feeds proxy status),
activation-scope (shared CLI/GUI/hook writer — no drift). shared:
RepositoryFamilyKey. Hook (saver-run.ts) resolves via family precedence +
liveness heartbeats; integration test proves worktree inheritance + compression.
CLI: workspace toggle repo-aware (family default, --exact opt-down, scope echo)
+ new `default` + `resolve`. GUI bridge + toggle repo-aware, reports effective
source. Public behavior change: v1 record shape + family-default scope
(changeset added). Reviewer gate: fresh-context code-reviewer + critic (S10).
Counts: context-gate 236, cli 765, gui 419. Remaining: proxy plan P0–P9 (2 of 2).

## [2026-07-03] implement | persistent proxy routing P0-P8

Branch feat/persistent-proxy-routing-impl (stacked on saver). TDD; `pnpm verify`
green 48/48. Delivers the metering fix (proxy healthy but no client routed) +
removes the GUI boot/shutdown route-clear stranding bug. P0 llm-proxy HMAC health
endpoint; P1-P5 new @megasaver/proxy-control (state stores, fenced PID-reuse-safe
locks, pure recovery matrix with exhaustive invariants, supervisor fixpoint+monitor
wiring, LaunchAgent installer never-stop-foreign); P3 connector value-guarded route
adapter; P6 CLI proxy start/stop/status/service-uninstall + supervise runtime
(public break: old foreground start → supervise); P8 saver telemetry into proxy
status (cross-spec contract); P7 GUI persistent toggle (singleton+osascript+route-clear
removed). Changeset added. Deferred (flagged): GUI auth bootstrap (launch cap→cookie+CSRF)
+ long-running supervise control server. Next: CRITICAL review gates (security-reviewer
+ tracer + code-reviewer + critic).

## [2026-07-03] remediate | proxy CRITICAL review round 1 → fixes

The first CRITICAL gate returned REQUEST_CHANGES from all three reviewers: 4
BLOCKING + 10 MAJOR real defects (the gate did its job). Root of the worst one:
`mega proxy supervise` ran a bare listener and never invoked the reconcile state
machine, so `start` persisted an enable intent but the route was NEVER applied —
the original zero-metering bug persisted. Fixes (commit 37f170c0, TDD, `pnpm
verify` 48/48 green): (R1) supervise validates `--upstream` + gates non-default
origin behind `--confirm-credential-forwarding`; (R2) handler uses
`redirect:"manual"` and answers the reserved health path locally (never
forwarded); (R3) new `superviseDrive` daemon binds a health-capable listener and
drives the enable transition to a verified applied route on a 5s cadence under
the transition lock; (R4) new fenced `withTransitionLock` serializes
start/stop/GUI writes (returns transition_in_progress, never clobbers); (R5)
usage store 0600/0700 + symlink refusal + bounded control-char-stripped model;
(R6) LaunchAgent byte-exact managed classification + legacy-plist restore on
bootstrap failure; (R7) lock quarantine re-judges moved content (no live-owner
steal); (R8) route mutator fsync + mode preservation; (R9) verify_route is a real
read-back gate (aborts promote/clear on a lost write); (R10) status is read-only
(no ensureHooks side-effect). Re-running the CRITICAL gate (3 fresh-context
reviewers). Still deferred: GUI auth bootstrap + cross-process supervisor
discovery (single self-driving supervisor needs neither to route).

## [2026-07-03] verify | proxy CRITICAL review converged → APPROVE

The CRITICAL gate ran to convergence across three review rounds (fresh-context
security + correctness + adversarial-tracer each round; author≠reviewer).
- Round 1 (commit 37f170c0): 4 BLOCKING + 10 MAJOR fixed (credential gate,
  redirect:manual, the daemon actually running the state machine, transition
  lock, store/route/launchagent/lock hardening, verify_route read-back, read-only
  status).
- Round 2 (6979472e): correctness + tracer BOTH found one HIGH functional bug —
  `mega proxy stop` entered a drain that never completed (no drain_complete
  writer) → key-holding listener never stopped + `service uninstall` blocked
  forever. Fixed via `stop --confirm-clients-restarted` (+ GUI) writing
  drain_complete; plus enter_drain idempotency, stale-block clearing, boot
  recovery wiring, crash-proof tick.
- Round 3 (e09787f2 + 71201d8c): the round-2 fix opened a new reachable dead-end
  (drain_complete issued directly on a routed+leased state stopped the listener
  but stranded the route + lease). Made `reconcileDrain` TOTAL: value-guarded
  remove-first on a leased-exact route, clear_lease on every terminal. Security
  also caught the round-2 plist symlink guard using existsSync (follows a
  dangling link) → switched to a direct lstat.
- Final convergence review: exhaustive 16-row enumeration of reconcileDrain over
  (route × hasLease × generationLive) — no stranding, no dead-end, no regression;
  the five security invariants hold empirically (SSRF concat-defense, no key
  forward, foreign-route/process untouched, health-path local, tight perms +
  PID-reuse-safe locks). Verdict APPROVE.

`pnpm verify` green throughout (48/48 tasks; proxy-control 68, cli 777, gui 416).
Branch feat/persistent-proxy-routing-impl. The enable path now turns a persisted
intent into a live, verified route (the original "healthy but unrouted / zero
metering" bug is closed) and the disable path reaches a clean terminal idle.
Deferred (flagged, non-blocking): full GUI auth bootstrap + cross-process
supervisor discovery.

## [2026-07-03] ship | saver + persistent proxy routing merged to main

Both features are on `main`, green on CI (ubuntu-latest + windows-latest):
`794be8b7` saver activation inheritance (#216) and `297ebc28` persistent proxy
routing (#219). The proxy PR #218 was auto-closed when #216's `--delete-branch`
removed its base branch; it was recreated as #219 (base main).

Integration incident + recovery (recorded honestly for the next agent): the
#216 squash to main briefly BROKE CI. The saver worktree carried an uncommitted
`pnpm-lock.yaml` (+`@megasaver/context-gate` in the cli importer) that was
wrongly judged a stray and excluded from the merge; it was in fact the required
lockfile sync, so CI's `pnpm install --frozen-lockfile` failed on ubuntu +
windows. Local `pnpm verify` (macOS) never runs frozen-install, so it wasn't
caught pre-merge. Recovery via #219: merged main into the proxy branch, ran
`pnpm install` to sync the lockfile (committed this time), resolved the wiki
conflicts (union), and fixed a Windows-only failure — the usage-store 0600/0700
mode assertion reads 0o666 on Windows (no POSIX mode bits), now `win32`-guarded
like the other perm/symlink tests. #219 CI passed on both platforms → merged →
main green.

Lessons: (1) never exclude an uncommitted lockfile change without checking it
against package.json — `pnpm install --frozen-lockfile` is the CI-equivalent
check to run locally; (2) `--delete-branch` on a merge closes any PR stacked on
that branch — merge or retarget the child first; (3) POSIX perm/symlink tests
need a `win32` guard.

Cleanup: merged branches deleted (remote + local); the three feature worktrees
(`proxy-routing-impl`, `saver-activation-inheritance`, `persistent-proxy-routing`)
removed; local `main` refreshed to `origin/main`. The unrelated
`agent-office-skill-roles` worktree and the `refactor/token-saver-fullwidth`
working branch were left untouched.

---

## [2026-07-03] ingest | audit overlay-fallback review nits addressed

Branch `fix/audit-session-overlay-fallback` (worktree `MegaSaver-audit-overlay`).
Three code-review nits, sanctioned by the spec
`docs/superpowers/specs/2026-07-03-audit-overlay-fallback-design.md`:

1. Biome format-only fix: `honest-overlay-fallback.test.ts` multi-line import
   collapsed to one line.
2. `--json` discriminator on the overlay-fallback path: both `audit session`
   and `audit honest` now emit `{ source: "overlay", ...summary }` instead of a
   bare `OverlaySessionTokenSaverStats`, so a machine consumer can tell the
   overlay shape from the registered summary. Human card output unchanged.
3. `audit honest` now validates its positional session id via `sessionIdSchema`
   (same lowercase-UUID contract `audit session` uses — overlay files are keyed
   by the lowercase-UUID the hook writes) BEFORE reading. A malformed/uppercase
   id now yields `error: invalid session id` + exit 1 instead of a silent
   all-zeros report. `runHonestAudit` return changed `string` →
   `{ output, exitCode }` to carry the exit code; the citty handler routes the
   error to stderr and sets `process.exitCode`.

`pnpm verify` green (788 tests). Smoke: `audit honest <UPPERCASE-UUID>` → exit 1,
matching `audit session`; valid lowercase id on an empty store still yields the
zeros report at exit 0.
