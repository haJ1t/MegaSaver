---
title: JJ — pnpm conventions:sync (plan)
status: in-progress
risk: medium
date: 2026-05-10
spec: docs/superpowers/specs/2026-05-10-jj-conventions-sync-design.md
---

# JJ — `pnpm conventions:sync` plan

Implementation steps for the spec. Each step is TDD: failing test
first, minimal implementation to green, refactor, commit.

## Step 1 — scaffold

- Create `scripts/conventions-sync/` directory.
- Add `scripts/conventions-sync/tsconfig.json` extending
  `tsconfig.base.json` with `noEmit: true`. The script runs via
  `node --experimental-strip-types`; no build step.
- Add `scripts/conventions-sync/vitest.config.ts` with the same
  shape as `apps/cli/vitest.config.ts`.
- Add `scripts/conventions-sync/tsconfig.test-d.json` for type tests.

## Step 2 — manifest + closed enums (TDD)

Test first: `manifest.test.ts` and `manifest.test-d.ts`.

- `MODES = ["check", "write", "list"] as const` with
  `Mode = (typeof MODES)[number]`.
- `CONSUMERS` tuple: launch order pinned. Each consumer carries
  `{ id, path, blocks: readonly BlockSpec[] }`.
- `BlockSpec = { id: string, source: string, fragment?: string }`.
- `.test-d.ts` pins both unions to exact literals.
- `manifest.test.ts` asserts tuple equality + readonly array shape
  (mirrors `apps/cli/test/known-targets.test.ts` shape).

## Step 3 — sentinel parser (TDD)

Test first: `sync.test.ts` covering `parseFile`.

- `parseFile(text: string): ParsedFile`
- Detects `<!-- conventions:start id="X" source="..." [fragment="..."] -->`
- Detects matching `<!-- conventions:end id="X" -->`
- Returns ordered list of `{ id, sourcePath, fragment?, body, span }`.
- Errors:
  - unmatched start without end → `BlockParseError("unclosed")`
  - unmatched end without start → `BlockParseError("orphan-end")`
  - duplicate id in same file → `BlockParseError("duplicate-id")`
  - nested sentinels → `BlockParseError("nested")`
- Preserves non-block content as `OutsideSegment` records so
  `applyBlocks` can stitch back together byte-identically.

## Step 4 — source fragment resolver (TDD)

Test first: `sync.test.ts` covering `resolveSource`.

- `resolveSource({ source, fragment, conventionsDir }): string`
- Reads `<conventionsDir>/<source>` from disk.
- If `fragment` provided, finds first `## <fragment>` heading and
  returns the slice up to the next `## ` heading.
- If `fragment` not provided, returns the file contents.
- Strips leading/trailing whitespace, normalizes EOL to `\n`.
- Errors:
  - source not found → `SourceError("missing")`
  - fragment not found → `SourceError("fragment-missing")`

## Step 5 — render + apply blocks (TDD)

Test first: `sync.test.ts` covering `renderBlock` + `applyBlocks`.

- `renderBlock(spec, body): string`:
  ```
  <!-- conventions:start id="X" source="..." [fragment="..."] -->
  <body>
  <!-- conventions:end id="X" -->
  ```
- `applyBlocks(parsedFile, sources): string`:
  - For each block, replace body with resolved source content.
  - Preserve sentinel attribute order.
  - Preserve outside segments byte-identically.

## Step 6 — diff (TDD)

Test first: `sync.test.ts` covering `computeDiff`.

- Use Node's built-in or roll a minimal unified-diff formatter.
  (Implementation note: write a tiny line-based diff — both
  `diff` and `jest-diff` add dependencies; the script must stay
  dep-free.)
- `computeDiff(expected, actual, label): string` returns a
  unified-diff-style string, or `""` if equal.

## Step 7 — sync engine (TDD)

Test first: `sync.test.ts` covering `runSync`.

- `runSync({ mode, repoRoot, manifest, fs }): SyncResult`
- For each consumer:
  - Read disk file.
  - Parse blocks.
  - Resolve each block's source.
  - Render expected file.
  - Compare to disk.
- Returns `{ status: "ok" | "drift" | "error", reports }`.
- `mode === "check"` does not write.
- `mode === "write"` writes if drift.
- `mode === "list"` prints manifest and exits before any read.

## Step 8 — CLI (TDD)

Test first: `cli.test.ts` exercising the Citty command in-process.

- `cli.ts` defines the Citty command.
- Modes are mutually exclusive; flag conflict exits with code 2 and
  a human-readable error.
- Default mode is `check`.
- `--check`, `--write`/`--fix`, `--list` map to modes.
- `index.ts` (entry) calls `runMain` so `pnpm conventions:sync`
  invokes the command via `node --experimental-strip-types`.

## Step 9 — root wiring

- Add to root `package.json` scripts:
  - `"conventions:sync": "node --experimental-strip-types scripts/conventions-sync/index.ts"`
  - `"conventions:check": "node --experimental-strip-types scripts/conventions-sync/index.ts --check"`
- Decide whether to fold `conventions:check` into `pnpm verify`.
  Default: fold it in as the last step. Fallback: leave it
  standalone if CI gating is too invasive on day one.

## Step 10 — integration test

Test: end-to-end round-trip on a fixture tree.

- Create a fixture with one canonical source + one consumer that
  has a block referencing it.
- `--write` to bring into sync.
- `--check` must exit 0.
- Tamper with the consumer body.
- `--check` must exit 1 with the consumer named in the diff.

## Step 11 — first-run migration

- Run `pnpm conventions:sync --write` against the real repo.
- `AGENTS.md` and three `.cursor/rules/*.mdc` files acquire
  sentinel blocks for the first time.
- Diff is mechanical: existing prose is replaced with the
  canonical version of the same section from `docs/conventions/`.
- Document the introduced changes in the PR body.

## Step 12 — verify + wiki

- `pnpm exec vitest run --no-coverage` at worktree root.
- `pnpm conventions:sync --check` passes (post-migration).
- `pnpm lint` clean.
- Append entry to `wiki/log.md` under today's date.

## Step 13 — ship

- Commit atomically per Conventional Commits.
- Push branch.
- Open PR with title
  `feat(scripts): pnpm conventions:sync automation (JJ)`.
- PR body documents (a) the design decision, (b) the migration
  diff, (c) test evidence.
