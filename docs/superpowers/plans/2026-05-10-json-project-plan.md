---
title: --json flag for mega project list + project create — Plan
date: 2026-05-10
spec: docs/superpowers/specs/2026-05-10-json-project-design.md
risk: MEDIUM
---

# --json project flag — Plan

## Steps

### 1. Write failing tests (TDD)

In `apps/cli/test/project.test.ts`, add to existing describe blocks:

**`projectListCommand`:**
- `--json` on empty store → `logSpy` called once with `"[]"`
- `--json` with 2 projects → `logSpy` called once, output parses to
  array of 2 objects with all 5 fields (id, name, rootPath, createdAt,
  updatedAt) and correct values

**`projectCreateCommand`:**
- `--json` → `logSpy` called once, output parses to object with all 5
  fields; `name === "demo"`, `id` is a UUID string
- `--json` + `--root /tmp/json-root-test` → parsed object
  `rootPath === "/tmp/json-root-test"`

Run `pnpm --filter @megasaver/cli test` — confirm tests FAIL (RED).

### 2. Implement in `project.ts`

Add `json?: boolean` to `RunProjectListInput` and
`RunProjectCreateInput`.

`runProjectList`: after `listProjects()`, branch on `input.json`:
- true → `input.stdout(JSON.stringify(projects))` (single call, compact)
- false → existing `for` loop with `formatProjectLine`

`runProjectCreate`: after `registry.createProject(...)`, branch:
- true → `input.stdout(JSON.stringify(created))`
- false → `input.stdout(formatProjectLine(created))`

Add `json: { type: "boolean", default: false, description: "Emit JSON output." }`
to both `projectListCommand.args` and `projectCreateCommand.args`.

Thread `json: !!args.json` through the `run` function calls.

### 3. Run tests — confirm GREEN

`pnpm --filter @megasaver/cli test` — all tests pass including new
JSON tests and existing regression tests.

### 4. Commit

```
git add apps/cli/src/commands/project.ts apps/cli/test/project.test.ts
git commit -m "feat(cli): --json output for project commands"
```

Also commit spec + plan in same or prior commit.

### 5. DoD gate — `pnpm verify`

Full lint + typecheck + test. Must be GREEN.

### 6. Push + PR

```bash
git push -u origin feat/json-project
gh pr create --title "feat(cli): --json output for project commands" ...
```

SendMessage team-lead with PR URL.
