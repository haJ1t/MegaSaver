---
title: "project create --root test gap coverage"
date: 2026-05-10
status: approved
risk: LOW
author: project-root
---

# Project Create `--root` Test Gap Coverage

## Problem

PR #26 introduced the `--root` flag and three tests. Critic OBSERVATION-grade gaps remain:

1. **GAP-1** (`--root ""`): `path.resolve("")` returns `process.cwd()` — benign behavior but unpinned. If future validation is added, no test would catch a regression.
2. **GAP-2** (`--root foo/bar`): The existing relative test only covers `--root .` which degenerately resolves to cwd. A relative path WITH a subdirectory component (`foo/bar`) is the representative case.
3. **GAP-4** (`--root /nonexistent`): The behavior contract explicitly states non-existent paths are stored as-is (Option B). No test pins this, so a future `existsSync` addition would pass silently.

## Goal

Add 3 tests to `apps/cli/test/project.test.ts` that document existing correct behavior. No production code changes.

## Behavior Pinned

| Input | Expected `rootPath` |
|---|---|
| `--root foo/bar` | `join(process.cwd(), "foo/bar")` |
| `--root /nonexistent` | `"/nonexistent"` |
| `--root ""` | `process.cwd()` |

## Design Decision

Place all 3 tests inside the existing `describe("projectCreateCommand")` block, after the current `--root` tests. No new describe block — these tests are part of the same behavioral surface.

## Affected Files

- `apps/cli/test/project.test.ts` only. No production changes.

## Notes

- `join` import already present in test file.
- `resolve` import already present (added in PR #26).
- These tests run PASS against current code — they document existing behavior for regression detection.
