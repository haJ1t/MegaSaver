---
title: "Add --root flag to mega project create"
date: 2026-05-09
status: approved
risk: MEDIUM
author: project-root
---

# Add `--root <dir>` Flag to `mega project create`

## Problem

`mega project create <name>` hardcodes `rootPath = process.cwd()`. Users who want to register a project pointing to a directory other than the current working directory must `cd` into that directory first. This blocks one-liner workflows like:

```bash
mega project create demo --root /path/to/project --store /path/to/store
```

## Goal

Add an optional `--root <dir>` flag. When provided, `rootPath = path.resolve(args.root)`. When omitted, `rootPath = process.cwd()` — byte-identical to current behavior.

## Behavior Contract

| Invocation | `rootPath` stored |
|---|---|
| `mega project create demo` | `process.cwd()` (unchanged) |
| `mega project create demo --root /abs/path` | `"/abs/path"` |
| `mega project create demo --root ./rel` | `path.resolve("./rel")` (absolute, resolved against cwd at create time) |
| `mega project create demo --root /nonexistent` | `"/nonexistent"` — stored as-is, no error |

## Design Decisions

### Q1: Existence validation at CLI boundary vs. downstream (Option B chosen)

**Decision: Option B — trust downstream. No `fs.stat` / `access` check at `project create` time.**

Rationale:
- Current behavior stores `process.cwd()` without any fs check — this flag must be consistent.
- `packages/core/src/project.ts` schema validates only that `rootPath` is a non-empty string.
- `assertProjectRoot` at connector sync time is the correct validation gate.
- Valid use case: register a project before the directory is cloned or scaffolded.

### Path resolution

`path.resolve(args.root)` is applied unconditionally when `--root` is supplied. This handles both absolute paths (no-op) and relative paths (resolved against cwd). The stored value is always absolute.

## Affected Files

- `apps/cli/src/commands/project.ts` — add `root` arg to `projectCreateCommand`; add `rootFlag` field to `RunProjectCreateInput`; replace `input.cwd` with `input.rootFlag ? path.resolve(input.rootFlag) : input.cwd` when setting `rootPath`.
- `apps/cli/test/project.test.ts` — add three new test cases (see Test Plan).

**No other files touched.**

## Interface Changes

### `RunProjectCreateInput` (exported type)

Add optional field:

```ts
rootFlag?: string;
```

When absent or `undefined`, behavior is identical to today.

### `projectCreateCommand` args

```ts
root: {
  type: "string",
  description: "Project root directory (absolute or relative; defaults to current directory).",
},
```

### `runProjectCreate` logic change

Replace:

```ts
rootPath: input.cwd,
```

With:

```ts
rootPath: input.rootFlag !== undefined ? path.resolve(input.rootFlag) : input.cwd,
```

Note: `path.resolve` with an absolute path is a no-op (returns the path unchanged), so this handles both cases correctly without branching on absolute vs. relative.

## Test Plan (TDD order)

1. **Failing test first:** `--root /tmp/abs` stores `rootPath = "/tmp/abs"` — write test, run (RED), then implement.
2. **Relative resolve:** `--root .` stores `rootPath = path.resolve(".")` (absolute) — write test, run (RED), then implement.
3. **Omit (regression):** omitting `--root` stores `rootPath = process.cwd()` — write test (should pass after impl, confirms byte-identical behavior).

All tests use the `runCreate` helper pattern already established in `project.test.ts`, passing `root` in `args`.

## DoD Gate

- `pnpm verify` GREEN (lint + typecheck + test).
- Manual smoke: invoke from `/tmp`, `--root $ROOT`, confirm `project list` shows `rootPath = $ROOT`.
