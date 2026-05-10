---
title: DD1 AA Cleanup Batch (PR #28–#33 MINOR backlog)
risk: MEDIUM
created: 2026-05-10
---

# DD1 — AA Cleanup Batch

Consolidates MINOR-grade follow-ups left from PR #28–#33 critic reviews.

## Items

### Item 1 — default:false consistency

Citty boolean flags missing `default: false` get it added.

Audit: grep `type: "boolean"` across `apps/cli/src/commands/**/*.ts`.

Affected:
- `connector.ts:393` — `connectorStatusCommand.args.json` missing `default: false`
- `memory/list.ts:79` — `memoryListCommand.args.json` missing `default: false`
- `memory/show.ts:73` — `memoryShowCommand.args.json` missing `default: false`

### Item 2 — citty-wrapper tests

Add unit tests asserting the `defineCommand` wrapper shape (description string + default value)
for at least one boolean flag per affected command.

New file: `apps/cli/test/project/list.test.ts` — assert `projectListCommand.args.json.description`
and `projectListCommand.args.json.default`.

### Item 3 — --json failure-path tests

For each command with `--json`: add at least 1 test asserting failure path behavior
(text stderr + exit 1). Commands: project list, project create, memory list, memory show,
connector status.

Failure paths:
- `project list --json` + store error → text stderr, exit 1
- `project create --json` + invalid name → text stderr (no JSON), exit 1
- `memory list --json` + nonexistent project → text stderr, exit 1
- `memory show --json` + not-found id → text stderr, exit 1
- `connector status --json` + nonexistent project → text stderr, exit 1

### Item 4 — init-notice stderr pinning

Current tests use `toMatch(/^note: initialized store at /)` (regex).
Pin to `toBe(\`note: initialized store at ${root}\`)` exact match.

Files: `apps/cli/test/project.test.ts` (line 63), `apps/cli/test/session.test.ts` (similar pattern).

### Item 5 — dead memories.json fixture

`apps/cli/test/connector-status.test.ts:880` seeds `memories.json` which the JSON-directory
store never reads (memory entries live at `memory/<projectId>.jsonl`). Delete that line.

## Steps

1. Write plan (this file) ✓
2. Item 5: Remove dead `memories.json` fixture (1-line deletion)
3. Item 1: Add `default: false` to 3 boolean flags
4. Item 4: Pin init-notice to exact `toBe` match
5. Item 2: Add citty-wrapper tests for `projectListCommand.args.json`
6. Item 3: Add `--json` failure-path tests for all 5 commands
7. Run `pnpm exec vitest run` directly — verify green
8. Commit + PR
