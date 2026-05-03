# Git Workflow & Commits

## Branching

- Trunk-based. `main` always green and shippable.
- Every feature in its own worktree
  (`superpowers:using-git-worktrees`).
- Branch name:
  - `feat/<scope>-<slug>`
  - `fix/<scope>-<slug>`
  - `chore/<slug>`
  - `docs/<slug>`
- Short-lived. Merge or kill within days, not weeks.

## Commits — Conventional Commits + `caveman-commit` style

Invoke `caveman-commit` skill when generating messages.

Format:

```
<type>(<scope>): <subject>

<body — only when "why" non-obvious>
```

Types: `feat | fix | refactor | perf | test | docs | chore | build | ci`

## Rules

- Subject ≤ 50 chars, imperative ("add", not "added").
- Body explains WHY, not WHAT (diff shows what).
- One logical change per commit. Atomic.
- No "wip" / "fix typo" pollution on `main` — squash before merge.

## Examples

```
feat(core): token audit reports waste sources
fix(cli): mega run propagates exit code
refactor(core): extract risk detector from session engine
```

## Pre-merge

- Rebase on `main` (not merge).
- `pnpm verify` green.
- Reviewer agent pass (per `definition-of-done.md`).
- PR template filled (`.github/pull_request_template.md`).

## Branch protection (when GitHub repo created)

- `main`: no force push, require PR, require status checks.
- Linear history.
- Delete branch after merge.

## Destructive ops

- No `--no-verify`.
- No `--force-push` to `main`.
- No `git reset --hard` without confirmation.
- Investigate unfamiliar files / branches before deleting.
