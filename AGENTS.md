# AGENTS.md — Mega Saver (Codex)

Slim governance for Codex working in this repo. Mirrors
`docs/conventions/` blocks tuned to Codex idioms.

> Codex AGENTS.md does not have native skill invocation. The
> rules below are read by Codex as authoritative instructions.
> For Claude Code-specific tooling (Skill invocations, OMC agent
> names), see [CLAUDE.md](CLAUDE.md).

---

## Mission

Mega Saver is the ContextOps platform for frontier coding agents.
Core is agent-agnostic; connectors are thin adapters. Tagline:
"Less tokens. More signal. Same or better agent performance."

Source: [docs/conventions/mission.md](docs/conventions/mission.md)

---

## Stack & Commands

Node 22 LTS, TypeScript strict ESM, pnpm workspaces, Turborepo,
tsup, Vitest, Biome, Citty, Changesets.

```bash
pnpm install
pnpm dev              # turbo dev — watch all
pnpm build
pnpm test             # vitest run
pnpm lint             # biome check
pnpm typecheck        # tsc -b --noEmit
pnpm verify           # lint + typecheck + test (DoD gate)
pnpm --filter @megasaver/<pkg> <cmd>
```

Configuration files arrive in the `project-skeleton` spec.

Source: [docs/conventions/stack-and-commands.md](docs/conventions/stack-and-commands.md)

---

## Process Discipline (Codex form)

Every feature, in order:

1. Write a spec at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
   before any code. Capture mission, decisions, risk level.
2. Write a plan at `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`
   with bite-sized tasks (test write → fail → minimal impl → pass
   → commit).
3. TDD strict — failing test before production code. No exceptions.
4. Verification before completion — `pnpm verify` plus
   feature-specific smoke evidence. No "done" claim without it.
5. External review before merge — Codex must NOT self-approve;
   request a fresh-context review.

Hard gates: no implementation without spec; no merge without
`pnpm verify` green; no merge without external reviewer pass;
no "done" claim without evidence.

Source: [docs/conventions/process-discipline.md](docs/conventions/process-discipline.md)

---

## Code Conventions

TypeScript strict + ESM + NodeNext. Files ≤ 300 LOC, single
responsibility. Validate at boundaries with Zod; trust internals.
Default no comments — only WHY non-obvious. No premature
abstraction. No half-implementations. No pre-1.0 backward-compat.

Naming: packages `@megasaver/<name>`, files `kebab-case.ts`,
types `PascalCase`, vars/fns `camelCase`, true consts only as
`SCREAMING_SNAKE_CASE`.

Source: [docs/conventions/code-conventions.md](docs/conventions/code-conventions.md)

---

## Git & Commits

Trunk-based with feature worktrees. Conventional Commits +
`caveman-commit` style:

```
<type>(<scope>): <subject ≤ 50 chars, imperative>

<body — only when "why" non-obvious>
```

Types: `feat | fix | refactor | perf | test | docs | chore | build | ci`.
One logical change per commit. No "wip" on `main`. No
`--no-verify`, no force push to `main`, no `git reset --hard`
without confirmation.

Source: [docs/conventions/git-and-commits.md](docs/conventions/git-and-commits.md)

---

## Risk Modes

LOW (docs/cosmetic), MEDIUM (default), HIGH (Core / connectors /
public surface), CRITICAL (crypto / data delete / permissions).

Codex defers to spec frontmatter for risk level. HIGH and
CRITICAL features REQUIRE worktree, multiple reviewer passes,
and evidence-preserving compression only. CRITICAL forbids
unsupervised loops.

Source: [docs/conventions/risk-modes.md](docs/conventions/risk-modes.md)

---

## Multi-Agent Dogfood

Four agent files are kept in sync via `docs/conventions/`:

- `CLAUDE.md` — full reference. Used by Claude Code.
- `AGENTS.md` — Codex format. Slim mirror.
- `.cursor/rules/*.mdc` — modular, auto-loaded by Cursor on globs.
- `CONVENTIONS.md` — plain markdown, written by
  `mega connector sync --target aider`. Loaded by Aider via
  `--read CONVENTIONS.md` or `.aider.conf.yml`.

Do not edit any of these files without also editing
`docs/conventions/`.

Source: [docs/conventions/multi-agent-dogfood.md](docs/conventions/multi-agent-dogfood.md)

---

## Anti-Patterns

- No half-implementations.
- No fallbacks for impossible cases.
- No backward-compat shims pre-1.0.
- No premature abstraction.
- No comments without WHY.
- No "wip" / "fix typo" commits on `main`.
- No hook bypass flags unless explicitly asked.
- No silent retries on error.
- No raw tool output / test logs in context.
- No agent-specific logic in `@megasaver/core`.
- No memory writes without metadata.
- No destructive ops without explicit confirmation.
- No "too small for a spec."
- No `author == reviewer`.
- No editing this file without also editing
  `docs/conventions/`.
- No "done" claim before all DoD items pass.

Source: [docs/conventions/anti-patterns.md](docs/conventions/anti-patterns.md)
