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
- Branch: `feat/cursor-target`
- Result: `cursor` is now a v0.1 connector target alongside
  `claude-code` and `codex`. `agentIdSchema` widens to 4 members.
  `@megasaver/connector-generic-cli` ships `cursorTarget` and an
  optional `ConnectorTarget.header` field. `apps/cli`'s
  `KNOWN_TARGET_IDS` and `KNOWN_TARGETS` register cursor; sync
  prepends `target.header` once on first seed. Side fix: `AGENT_VALUES`
  in `apps/cli/src/errors.ts` updated to include cursor so the
  invalid-agent error message lists all four. 13 new tests
  (2 shared + 5 generic-cli + 6 cli). shared 22 → 24, generic-cli
  21 → 26, cli 121 → 127, total 381 → 394. PR: TBD.
