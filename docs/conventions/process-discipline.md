# Process Discipline

Every feature follows the strict superpowers chain. No exceptions.
No "this is too small to need a spec."

## Mandatory chain (in order)

1. `superpowers:brainstorming` — idea → spec.
   Output: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. `superpowers:writing-plans` — spec → step plan.
   Output: `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.
3. `superpowers:test-driven-development` — test before code.
   Red → green → refactor. No production code without a failing
   test first.
4. `superpowers:verification-before-completion` — evidence required.
   Run `pnpm verify` plus feature-specific evidence (CLI smoke run,
   schema check, integration scenario). No "done" without evidence.
5. `superpowers:requesting-code-review` — pre-merge external review.
   Use `code-reviewer` or `critic` agent. Author and reviewer
   NEVER the same active context.

## Conditional skills

- `superpowers:systematic-debugging` — bug, test fail, unexpected
  behavior.
- `superpowers:using-git-worktrees` — every feature default; start
  in isolated worktree.
- `superpowers:dispatching-parallel-agents` — 2+ independent tasks,
  no shared state.
- `superpowers:subagent-driven-development` — plan has independent
  tasks executable in this session.
- `superpowers:receiving-code-review` — review feedback received.
- `superpowers:finishing-a-development-branch` — implementation
  complete, deciding merge/PR/cleanup.

## Hard gates (no exceptions)

- No implementation without an approved spec.
- No merge without passing `pnpm verify`.
- No merge without external reviewer agent pass.
- No "done" claim without verifier evidence.
- Author and reviewer NEVER same active context.
