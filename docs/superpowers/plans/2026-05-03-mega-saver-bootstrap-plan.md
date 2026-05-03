# Mega Saver Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the agent governance files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`) and their canonical source of truth (`docs/conventions/`) per the approved bootstrap spec.

**Architecture:** Single source of truth in `docs/conventions/` (12 markdown files, one per CLAUDE.md section). The three agent files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`) inline content from the conventions until the `pnpm conventions:sync` script ships in v0.2. Until then, edits to conventions and mirrors must land in the same commit.

**Tech Stack:** Markdown only. No code in this plan. Validation by file existence checks, content greps, and a reviewer agent pass.

**Spec:** [`docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md`](../specs/2026-05-03-mega-saver-bootstrap-design.md)

**Risk:** MEDIUM (per spec §10 / CLAUDE.md §12).

---

## File Structure (deliverables)

Files to be created by this plan, in order of creation:

```
MegaSaver/
├─ docs/
│  └─ conventions/
│     ├─ mission.md                     (Task 1.1)
│     ├─ repo-layout.md                 (Task 1.2)
│     ├─ stack-and-commands.md          (Task 1.3)
│     ├─ process-discipline.md          (Task 1.4)
│     ├─ skill-routing.md               (Task 1.5)
│     ├─ agent-routing.md               (Task 1.6)
│     ├─ code-conventions.md            (Task 1.7)
│     ├─ definition-of-done.md          (Task 1.8)
│     ├─ git-and-commits.md             (Task 1.9)
│     ├─ language.md                    (Task 1.10)
│     ├─ risk-modes.md                  (Task 1.11)
│     └─ anti-patterns.md               (Task 1.12)
├─ CLAUDE.md                             (Task 2)
├─ AGENTS.md                             (Task 3)
└─ .cursor/
   └─ rules/
      ├─ mega-context.mdc                (Task 4.1)
      ├─ mega-discipline.mdc             (Task 4.2)
      └─ mega-conventions.mdc            (Task 4.3)
```

Total: 17 new files. No code, all markdown.

---

## Pre-flight

### Task 0: Create feature worktree

**Files:** none (filesystem op)

Per spec §4, every feature defaults to its own worktree. This plan is a feature.

- [ ] **Step 1: Confirm we are at MegaSaver root on main with the spec commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver
git status
git log --oneline
```

Expected: clean tree, one commit (`2118dde chore: bootstrap repo + brainstorm spec`).

- [ ] **Step 2: Create worktree for this feature**

```bash
git worktree add -b feat/bootstrap-governance ../MegaSaver-feat-bootstrap-governance main
```

Expected: new directory `/Users/halitozger/Desktop/MegaSaver-feat-bootstrap-governance/` exists with the same commit history.

- [ ] **Step 3: Switch into the worktree for all subsequent tasks**

```bash
cd /Users/halitozger/Desktop/MegaSaver-feat-bootstrap-governance
git status
```

Expected: branch `feat/bootstrap-governance`, clean.

> **All paths in tasks below are relative to the worktree root** (`/Users/halitozger/Desktop/MegaSaver-feat-bootstrap-governance/`).

---

## Task 1: Conventions Files — Canonical Source of Truth

Twelve markdown files. Single atomic commit at the end of the task.

### Task 1.1: `docs/conventions/mission.md`

**Files:**
- Create: `docs/conventions/mission.md`

- [ ] **Step 1: Create file with content**

```markdown
# Mission

Mega Saver is the ContextOps platform for frontier coding agents.
It connects to Claude Code, Codex, Cursor, Aider, and any CLI agent.
It manages context, memory, sessions, and token efficiency from one
control panel.

## Tagline

"Less tokens. More signal. Same or better agent performance."

## Non-negotiable principle

Mega Saver Core is agent-agnostic. Agents connect to Mega Saver,
never the reverse. Every connector is a thin adapter. Never let
agent-specific logic bleed into Core.

## What we are NOT

- Not a model proxy.
- Not an LLM-blinder. We preserve evidence; we never strip what
  the model needs to decide.
- Not a team chatops tool. Single-developer first.
```

- [ ] **Step 2: Verify file exists with expected first line**

```bash
test -f docs/conventions/mission.md && head -1 docs/conventions/mission.md
```

Expected: `# Mission`

---

### Task 1.2: `docs/conventions/repo-layout.md`

**Files:**
- Create: `docs/conventions/repo-layout.md`

- [ ] **Step 1: Create file with content**

````markdown
# Repo Layout

Monorepo. pnpm workspaces. Turborepo for orchestration.

```
MegaSaver/
├─ apps/
│  └─ cli/                    # `mega` command — entrypoint
├─ packages/
│  ├─ core/                   # Core Engine
│  ├─ mcp-bridge/             # MCP server (deferred; v0.2)
│  ├─ connectors/
│  │  ├─ claude-code/         # First connector (v0.1)
│  │  └─ generic-cli/         # CLI wrapper (v0.1)
│  ├─ skill-packs/            # Skill pack templates (v0.2)
│  └─ shared/                 # Types, schemas, utilities
├─ docs/
│  ├─ conventions/            # Single source of truth
│  └─ superpowers/
│     ├─ specs/
│     └─ plans/
├─ .changeset/
├─ .github/
├─ CLAUDE.md
├─ AGENTS.md
└─ .cursor/
   └─ rules/
```

`mcp-bridge` and `skill-packs` directories are placeholders deferred
to v0.2; do not add to the workspace until their own spec lands.
````

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/repo-layout.md && head -1 docs/conventions/repo-layout.md
```

Expected: `# Repo Layout`

---

### Task 1.3: `docs/conventions/stack-and-commands.md`

**Files:**
- Create: `docs/conventions/stack-and-commands.md`

- [ ] **Step 1: Create file with content**

````markdown
# Stack & Commands

## Stack

- Runtime:    Node 22 LTS (`.nvmrc` pinned)
- Language:   TypeScript strict, ESM only
- Package:    pnpm (workspace protocol for internal deps)
- Build:      tsup per-package + Turborepo orchestration
- Test:       Vitest (unit + integration)
- Lint+fmt:   Biome
- Type-check: tsc --noEmit (project references)
- CLI fwk:    Citty (UnJS — modern, ESM-native, typed args)
- Versioning: Changesets

## Commands (from repo root)

```bash
pnpm install
pnpm dev              # turbo dev — watch all
pnpm build            # turbo build — emit dist/
pnpm test             # vitest run (CI mode)
pnpm test:watch
pnpm lint             # biome check
pnpm lint:fix         # biome check --write
pnpm typecheck        # tsc -b --noEmit
pnpm verify           # lint + typecheck + test (DoD gate)
```

## Per-package

```bash
pnpm --filter @megasaver/<pkg> <cmd>
```

Note: pnpm/Turborepo/Biome configuration files are introduced by the
`project-skeleton` spec, not this bootstrap. Until then, the commands
above are aspirational and will activate when the skeleton lands.
````

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/stack-and-commands.md && head -1 docs/conventions/stack-and-commands.md
```

Expected: `# Stack & Commands`

---

### Task 1.4: `docs/conventions/process-discipline.md`

**Files:**
- Create: `docs/conventions/process-discipline.md`

- [ ] **Step 1: Create file with content**

```markdown
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
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/process-discipline.md && head -1 docs/conventions/process-discipline.md
```

Expected: `# Process Discipline`

---

### Task 1.5: `docs/conventions/skill-routing.md`

**Files:**
- Create: `docs/conventions/skill-routing.md`

- [ ] **Step 1: Create file with content**

```markdown
# Skill Routing

How Claude Code adapts to context. The rules below are non-negotiable.

## superpowers — every feature

See `process-discipline.md`. Mandatory chain on every feature.
Conditional set as listed.

## Design skills (GUI phase, v0.3+)

Mega Saver MVP is headless. Design skills activate when GUI work begins.

| Trigger / Phase                          | Skill                          |
|------------------------------------------|--------------------------------|
| New screen/component CONCEPT exploration | `huashu-design`                |
|   (no code yet, exploring variants)      |   (HTML hi-fi + critique)      |
| Concept locked → real frontend impl      | `taste-skill` OR `gpt-tasteskill` |
| Existing UI audit / polish / redesign    | `impeccable`                   |
| Style direction (theme/palette/typo)     | `ui-ux-pro-max` OR style packs |
|                                          |   (`minimalist`/`soft`/`brutalist`) |
| Accessibility pass                       | `design:accessibility-review`  |
| Pre-merge design critique                | `design:design-critique`       |
| Design system docs                       | `design:design-system`         |
| UX copy (microcopy/error/empty)          | `design:ux-copy`               |
| Visual reference generation              | `imagegen-frontend-web`        |

`taste-skill` vs `gpt-tasteskill`:

- engineering-heavy / metric-driven   → `taste-skill`
- editorial / motion / hero pages     → `gpt-tasteskill`
- if unsure                           → `taste-skill` default

## OMC — agent delegation

Skills:

- `omc:plan` — strategic planning, optional interview.
- `omc:ultrawork` — parallel high-throughput.
- `omc:ralph` — self-referential loop until complete.
- `omc:team` — N agents on shared list.
- `omc:debug` — session/repo state diagnose.
- `omc:trace` — evidence-driven causal tracing.
- `omc:verify` — verifier pass (process-discipline step 4).
- `omc:deepinit` — codebase docs (one-time after first feature).
- `omc:wiki` — persistent knowledge wiki.
- `omc:autopilot` — full autonomous (avoid until v0.2).

Agents (via Agent tool):

- `executor` — implementation.
- `planner` / `architect` — design, trade-offs (Opus).
- `explore` — codebase search.
- `code-reviewer` — pre-merge review.
- `critic` — adversarial review.
- `debugger` — root cause.
- `verifier` — completion check.
- `writer` — docs/comments.
- `document-specialist` — external SDK/API docs.
- `security-reviewer` — OWASP/secrets pass.

## claude-api skill

If Mega Saver Core calls the Anthropic API directly (e.g., native
LLM-powered compression or summarization), the `claude-api` skill
auto-triggers. It enforces:

- Prompt caching always on.
- Latest model defaults
  (`claude-opus-4-7` / `claude-sonnet-4-6` / `claude-haiku-4-5`).
- Streaming where applicable.

Mega Saver does NOT proxy or relay user prompts to LLMs by default.
Direct API use is opt-in per feature and must be flagged in the
feature spec along with cost and privacy notes.
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/skill-routing.md && head -1 docs/conventions/skill-routing.md
```

Expected: `# Skill Routing`

---

### Task 1.6: `docs/conventions/agent-routing.md`

**Files:**
- Create: `docs/conventions/agent-routing.md`

- [ ] **Step 1: Create file with content**

```markdown
# Agent Routing

Choose the lightest path that preserves quality.

## Direct work (no delegation)

- Trivial ops (single file rename, one-liner fix, copy edit).
- Direct config writes: `~/.claude/**`, `.omc/**`, `.claude/**`,
  `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`.
- Single bash commands.
- Quick clarifications.

## Delegate to specialized agent

| Situation                                          | Agent                  |
|----------------------------------------------------|------------------------|
| Multi-file changes / refactors                     | `executor` (opus)      |
| Codebase exploration > 3 queries                   | `explore`              |
| Architecture / trade-off / design decisions        | `architect` (opus)     |
| Step-by-step implementation plans                  | `planner` (opus)       |
| Debugging non-trivial bugs / regression isolation  | `debugger`             |
| Pre-merge code review                              | `code-reviewer`        |
| Adversarial second-opinion review                  | `critic` (opus)        |
| Verification / DoD evidence                        | `verifier`             |
| External SDK / API docs lookup                     | `document-specialist`  |
| Security / OWASP / secrets sweep                   | `security-reviewer`    |
| Test strategy / hardening flaky tests              | `test-engineer`        |
| Tracing causal hypotheses                          | `tracer`               |
| Docs / README / API docs                           | `writer` (haiku)       |
| UI/UX implementation work                          | `designer`             |

## Model routing

- `haiku`  — quick lookups, simple writes.
- `sonnet` — standard implementation.
- `opus`   — architecture, deep analysis, security, complex review.

## Parallel rules

- 2+ independent tasks → dispatch in single message
  (multiple Agent tool uses in one assistant turn).
- Builds / tests / long ops → `run_in_background`.
- Sequential when result of one feeds another.
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/agent-routing.md && head -1 docs/conventions/agent-routing.md
```

Expected: `# Agent Routing`

---

### Task 1.7: `docs/conventions/code-conventions.md`

**Files:**
- Create: `docs/conventions/code-conventions.md`

- [ ] **Step 1: Create file with content**

```markdown
# Code Conventions

## TypeScript

- `strict: true` (all strict flags on)
- `moduleResolution: NodeNext`
- `module: NodeNext` (ESM only)
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `isolatedModules: true`
- `skipLibCheck: true`
- `target: ES2023`

Project references for monorepo. Each package its own `tsconfig.json`
extending `tsconfig.base.json`.

## File organization

- One responsibility per file. Split when file exceeds 300 LOC OR
  serves more than one concern.
- One package = one bounded context. Cross-package import only
  through public entry (`package.json` `exports`).
- No circular imports. Depcheck in CI.
- `index.ts` re-exports only the public surface.

## Boundaries

- Validate input at system boundaries (CLI args, file reads,
  external API responses, MCP messages).
- Trust internal code. No defensive checks for impossible cases.
- Use Zod schemas for all external boundaries. Generated types,
  not hand-written.

## Comments

- Default: no comments. Names carry meaning.
- Exception: WHY non-obvious (constraint, invariant, workaround,
  surprising behavior).
- Never: "what" comments, "added for X flow", "used by Y".

## Abstraction

- 3 similar lines > premature abstraction.
- No half-implementations.
- No fallbacks for impossible cases.
- No backward-compat shims while pre-1.0.

## Naming

- packages: `@megasaver/<name>` (kebab-case)
- files:    `kebab-case.ts`
- types:    `PascalCase`
- vars/fns: `camelCase`
- consts:   `SCREAMING_SNAKE_CASE` only for true constants
            (env keys, magic numbers)
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/code-conventions.md && head -1 docs/conventions/code-conventions.md
```

Expected: `# Code Conventions`

---

### Task 1.8: `docs/conventions/definition-of-done.md`

**Files:**
- Create: `docs/conventions/definition-of-done.md`

- [ ] **Step 1: Create file with content**

```markdown
# Definition of Done

A feature is "done" only when ALL of these hold. No partial credit.

1. Spec exists in `docs/superpowers/specs/`.
2. Plan exists in `docs/superpowers/plans/`.
3. Tests written first (TDD).
4. `pnpm verify` green:
   - `biome check`     (lint + format)
   - `tsc --noEmit`    (type-check, project refs)
   - `vitest run`      (all tests pass)
5. Feature smoke evidence:
   - CLI feature → captured terminal session showing it work.
   - Library API → integration test exercising public surface.
   - Connector  → real agent run captured.
6. External reviewer agent pass (`code-reviewer` or `critic`).
   Author and reviewer NEVER same active context.
7. Verifier agent pass (`omc:verify`) — evidence-based check.
8. Zero pending TodoWrite items for the feature.
9. Changeset added (`.changeset/<descriptor>.md`) if package
   public API changed.
10. `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` updated if
    conventions changed (drift check per `process-discipline.md`).

If any item fails: not done. Iterate.

## Hard rule

Do NOT claim "complete", "fixed", "passing", "shipped" before
items 4–7 pass. Verification before assertion.
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/definition-of-done.md && head -1 docs/conventions/definition-of-done.md
```

Expected: `# Definition of Done`

---

### Task 1.9: `docs/conventions/git-and-commits.md`

**Files:**
- Create: `docs/conventions/git-and-commits.md`

- [ ] **Step 1: Create file with content**

````markdown
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
````

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/git-and-commits.md && head -1 docs/conventions/git-and-commits.md
```

Expected: `# Git Workflow & Commits`

---

### Task 1.10: `docs/conventions/language.md`

**Files:**
- Create: `docs/conventions/language.md`

- [ ] **Step 1: Create file with content**

```markdown
# Language & i18n

## Source language

- Code, identifiers, comments, docs, commit messages: English.
- Spec / plan files: English.
- Agent files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`): English.
- Conversation language may vary; the OUTPUT (code, docs, commits)
  is always English.

## Product user-facing strings (deferred)

- v0.1 CLI: English only. Hardcoded strings.
- v0.2+: i18n via `packages/shared/i18n`. Default `en`, then add
  `tr` second.
- Never hardcode Turkish in code. Route through the i18n layer
  (when it exists).
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/language.md && head -1 docs/conventions/language.md
```

Expected: `# Language & i18n`

---

### Task 1.11: `docs/conventions/risk-modes.md`

**Files:**
- Create: `docs/conventions/risk-modes.md`

- [ ] **Step 1: Create file with content**

```markdown
# Risk-Aware Development Modes

Mega Saver's product has a Risk Detector. We dogfood it on
ourselves: every feature has an implicit risk level that
determines which skills are mandatory and which compression
intensity is allowed.

## Risk levels

### LOW

- Examples: README edit, comment polish, CLI help-text tweak,
  internal log message, dev-only logging.
- Mandatory: brainstorming + verification (lite).
- Optional: full superpowers chain.
- OK to skip: TDD when no logic.
- Skill mode: aggressive compression allowed in research.

### MEDIUM

- Examples: normal feature add, refactor, bug fix in non-critical
  module, dev tooling, build script.
- Mandatory: full superpowers chain (`process-discipline.md`).
- Required reviewer: `code-reviewer`.
- Skill mode: balanced compression.

### HIGH

- Examples: token audit logic, context packer, evidence-preserving
  compression, memory schema change, session storage format,
  connector core path, public CLI flags, anything touching user
  files at scale.
- Mandatory: full chain + `omc:architect` for design
  + `omc:critic` adversarial review + worktree (no `main` edits).
- Required reviewer: `code-reviewer` AND `critic` (separate
  passes).
- Skill mode: evidence-preserving only. No aggressive compression.

### CRITICAL

- Examples: cryptographic ops, anything that deletes user data,
  anything that mutates user repos beyond known ignore patterns,
  license / permission code, production incident response.
- Mandatory: HIGH chain + `omc:tracer` evidence loop
  + `omc:security-reviewer` + verifier with reproduction evidence
  + manual user confirmation in spec.
- Forbidden: `autopilot`, `ralph`, or any unsupervised loop.
- Skill mode: debug + evidence only. No log compression.

## Risk assignment

- Spec author assigns risk in spec frontmatter.
- Reviewer may upgrade. Never silently downgrade.
- If unclear, default MEDIUM.

## Anti-cheat

- Risk level cannot be lowered to skip a skill.
- Wanting to lower the risk is a signal to keep the skill.
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/risk-modes.md && head -1 docs/conventions/risk-modes.md
```

Expected: `# Risk-Aware Development Modes`

---

### Task 1.12: `docs/conventions/anti-patterns.md`

**Files:**
- Create: `docs/conventions/anti-patterns.md`

- [ ] **Step 1: Create file with content**

```markdown
# Anti-Patterns

Hard "don't" list. Not preferences. Violating any fails review.

- No half-implementations. If you can't finish in this PR, scope
  smaller — don't merge stub functions.
- No fallbacks for cases that cannot happen. Trust internals.
  Validate only at system boundaries.
- No backward-compat shims pre-1.0. Break things; bump version.
- No premature abstraction. 3 similar lines > 1 fragile abstraction.
- No comments without a WHY. No "what" comments. No "added for
  feature X" rot.
- No "wip" / "fix typo" / "address feedback" commits on `main`.
  Squash before merge.
- No `--no-verify`, `--no-gpg-sign`, hook bypasses unless user
  asked explicitly.
- No silent retries on error. Diagnose the root cause.
- No raw tool output / test log / build log into context. Mega
  Saver's whole purpose is to compress these. Use the Tool Output
  Compressor (when shipped) or its manual equivalent — root cause
  + first failure + exit code.
- No agent-specific logic in `@megasaver/core`. Connectors isolate.
- No memory writes without metadata. Every memory item must carry:
  source, timestamp, confidence, scope, expires (or null).
- No destructive ops (`rm -rf`, force push, branch delete, history
  rewrite) without explicit user confirmation in same conversation.
- No "this feature is too small for a spec." See
  `process-discipline.md` hard rule.
- No `author == reviewer`. The reviewer agent runs in a fresh
  context with no memory of authoring.
- No editing `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` without
  also editing `docs/conventions/` source of truth.
- No claiming "done" / "fixed" / "passing" before
  `definition-of-done.md` met.
```

- [ ] **Step 2: Verify**

```bash
test -f docs/conventions/anti-patterns.md && head -1 docs/conventions/anti-patterns.md
```

Expected: `# Anti-Patterns`

---

### Task 1.13: Verify all 12 convention files exist

- [ ] **Step 1: Run check**

```bash
ls docs/conventions/ | sort
```

Expected output (exactly 12 files):

```
agent-routing.md
anti-patterns.md
code-conventions.md
definition-of-done.md
git-and-commits.md
language.md
mission.md
process-discipline.md
repo-layout.md
risk-modes.md
skill-routing.md
stack-and-commands.md
```

- [ ] **Step 2: Confirm count is 12**

```bash
ls docs/conventions/ | wc -l
```

Expected: `12`

---

### Task 1.14: Commit conventions

- [ ] **Step 1: Stage and commit**

```bash
git add docs/conventions/
git commit -m "$(cat <<'EOF'
docs(conventions): add canonical source of truth

Twelve markdown files under docs/conventions/ define the canonical
content for project conventions. CLAUDE.md, AGENTS.md, and the
Cursor rules will mirror these files until the conventions sync
script ships in v0.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: clean commit, 12 files added.

- [ ] **Step 2: Verify commit**

```bash
git log --oneline -1
```

Expected: subject starts with `docs(conventions):`.

---

## Task 2: `CLAUDE.md` — Claude Code Source of Truth

The full thirteen-section reference. Inline content from
`docs/conventions/*` until the sync script ships.

### Task 2.1: Create `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Write the file**

````markdown
# CLAUDE.md — Mega Saver

Source of truth for Claude Code working in this repo.

> This file is the canonical reference. `AGENTS.md` (Codex) and
> `.cursor/rules/*.mdc` (Cursor) mirror its content via
> `docs/conventions/`. Do not edit this file without also editing
> the corresponding files in `docs/conventions/`. See
> [docs/conventions/git-and-commits.md](docs/conventions/git-and-commits.md)
> for the drift rule.

---

## §1 Mission & North Star

Mega Saver is the ContextOps platform for frontier coding agents.
It connects to Claude Code, Codex, Cursor, Aider, and any CLI
agent. It manages context, memory, sessions, and token efficiency
from one control panel.

**Tagline:** "Less tokens. More signal. Same or better agent
performance."

**Non-negotiable principle:** Mega Saver Core is agent-agnostic.
Agents connect to Mega Saver, never the reverse. Every connector
is a thin adapter. Never let agent-specific logic bleed into Core.

**What we are NOT:**

- Not a model proxy.
- Not an LLM-blinder. We preserve evidence; we never strip what
  the model needs to decide.
- Not a team chatops tool. Single-developer first.

Source: [docs/conventions/mission.md](docs/conventions/mission.md)

---

## §2 Repo Layout

Monorepo. pnpm workspaces. Turborepo for orchestration.

```
MegaSaver/
├─ apps/
│  └─ cli/                    # `mega` command — entrypoint
├─ packages/
│  ├─ core/                   # Core Engine
│  ├─ mcp-bridge/             # MCP server (deferred; v0.2)
│  ├─ connectors/
│  │  ├─ claude-code/         # First connector (v0.1)
│  │  └─ generic-cli/         # CLI wrapper (v0.1)
│  ├─ skill-packs/            # Skill pack templates (v0.2)
│  └─ shared/                 # Types, schemas, utilities
├─ docs/
│  ├─ conventions/            # Single source of truth
│  └─ superpowers/
│     ├─ specs/
│     └─ plans/
├─ .changeset/
├─ .github/
├─ CLAUDE.md
├─ AGENTS.md
└─ .cursor/
   └─ rules/
```

`mcp-bridge` and `skill-packs` directories are placeholders deferred
to v0.2; do not add to the workspace until their own spec lands.

Source: [docs/conventions/repo-layout.md](docs/conventions/repo-layout.md)

---

## §3 Stack & Commands

- Runtime:    Node 22 LTS (`.nvmrc` pinned)
- Language:   TypeScript strict, ESM only
- Package:    pnpm (workspace protocol for internal deps)
- Build:      tsup per-package + Turborepo orchestration
- Test:       Vitest (unit + integration)
- Lint+fmt:   Biome
- Type-check: tsc --noEmit (project references)
- CLI fwk:    Citty (UnJS — modern, ESM-native, typed args)
- Versioning: Changesets

```bash
pnpm install
pnpm dev              # turbo dev — watch all
pnpm build            # turbo build — emit dist/
pnpm test             # vitest run (CI mode)
pnpm test:watch
pnpm lint             # biome check
pnpm lint:fix         # biome check --write
pnpm typecheck        # tsc -b --noEmit
pnpm verify           # lint + typecheck + test (DoD gate)
pnpm --filter @megasaver/<pkg> <cmd>
```

Configuration files (`tsconfig.base.json`, `biome.json`, `turbo.json`,
`pnpm-workspace.yaml`) are introduced by the `project-skeleton`
spec, not this bootstrap.

Source: [docs/conventions/stack-and-commands.md](docs/conventions/stack-and-commands.md)

---

## §4 Process Discipline (MANDATORY)

Every feature follows the strict superpowers chain. No exceptions.

**Mandatory chain (in order):**

1. `superpowers:brainstorming` — idea → spec.
2. `superpowers:writing-plans` — spec → step plan.
3. `superpowers:test-driven-development` — test before code.
4. `superpowers:verification-before-completion` — evidence required.
5. `superpowers:requesting-code-review` — pre-merge external review.

**Conditional skills:**

- `superpowers:systematic-debugging` — bug, test fail.
- `superpowers:using-git-worktrees` — every feature default.
- `superpowers:dispatching-parallel-agents` — 2+ independent tasks.
- `superpowers:subagent-driven-development` — plan with parallel
  tasks executable in this session.
- `superpowers:receiving-code-review` — review feedback received.
- `superpowers:finishing-a-development-branch` — merge / PR phase.

**Hard gates (no exceptions):**

- No implementation without an approved spec.
- No merge without passing `pnpm verify`.
- No merge without external reviewer agent pass.
- No "done" claim without verifier evidence.
- Author and reviewer NEVER same active context.

Source: [docs/conventions/process-discipline.md](docs/conventions/process-discipline.md)

---

## §5 Skill Routing

### §5a superpowers

See §4. Mandatory chain on every feature.

### §5b Design skills (GUI phase, v0.3+)

| Trigger / Phase                          | Skill                          |
|------------------------------------------|--------------------------------|
| New screen/component CONCEPT exploration | `huashu-design`                |
| Concept locked → real frontend impl      | `taste-skill` OR `gpt-tasteskill` |
| Existing UI audit / polish / redesign    | `impeccable`                   |
| Style direction (theme/palette/typo)     | `ui-ux-pro-max` OR style packs |
| Accessibility pass                       | `design:accessibility-review`  |
| Pre-merge design critique                | `design:design-critique`       |
| Design system docs                       | `design:design-system`         |
| UX copy                                  | `design:ux-copy`               |
| Visual reference generation              | `imagegen-frontend-web`        |

`taste-skill` vs `gpt-tasteskill`:

- engineering-heavy / metric-driven   → `taste-skill`
- editorial / motion / hero pages     → `gpt-tasteskill`
- if unsure                           → `taste-skill` default

### §5c OMC — agent delegation

Skills: `omc:plan`, `omc:ultrawork`, `omc:ralph`, `omc:team`,
`omc:debug`, `omc:trace`, `omc:verify`, `omc:deepinit`, `omc:wiki`.
Avoid `omc:autopilot` until v0.2.

Agents (via Agent tool): `executor`, `planner`, `architect`,
`explore`, `code-reviewer`, `critic`, `debugger`, `verifier`,
`writer`, `document-specialist`, `security-reviewer`,
`test-engineer`, `tracer`, `designer`.

### §5d claude-api skill

Auto-triggers on direct Anthropic API use. Enforces prompt caching,
latest models, streaming. Direct API use is opt-in per feature
spec; cost and privacy notes mandatory.

Source: [docs/conventions/skill-routing.md](docs/conventions/skill-routing.md)

---

## §6 Agent Routing

**Direct work** (no delegation):

- Trivial ops, single bash commands, quick clarifications.
- Direct config writes: `~/.claude/**`, `.omc/**`, `.claude/**`,
  `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`.

**Delegate** (see table for situation → agent):

| Situation                                    | Agent                  |
|----------------------------------------------|------------------------|
| Multi-file changes / refactors               | `executor` (opus)      |
| Codebase exploration > 3 queries             | `explore`              |
| Architecture decisions                       | `architect` (opus)     |
| Step-by-step plans                           | `planner` (opus)       |
| Non-trivial bugs                             | `debugger`             |
| Pre-merge review                             | `code-reviewer`        |
| Adversarial review                           | `critic` (opus)        |
| DoD evidence                                 | `verifier`             |
| External SDK / API docs                      | `document-specialist`  |
| OWASP / secrets                              | `security-reviewer`    |
| Test strategy                                | `test-engineer`        |
| Causal hypotheses                            | `tracer`               |
| Docs / README                                | `writer` (haiku)       |
| UI / UX impl                                 | `designer`             |

**Model routing:** `haiku` (lookups), `sonnet` (standard), `opus`
(architecture, security, deep analysis).

**Parallel rules:** 2+ independent tasks → single message,
multiple Agent calls. Long ops → `run_in_background`.

Source: [docs/conventions/agent-routing.md](docs/conventions/agent-routing.md)

---

## §7 Multi-Agent Dogfood

Mega Saver's product premise: connectors generate per-agent
config. We dogfood by writing all three agent files from day one
and keeping them in sync via a single source of truth.

**Source of truth:** `docs/conventions/*.md`. Twelve canonical
files (this CLAUDE.md §7 is meta and is the only section without
its own conventions file).

**File scopes:**

- `CLAUDE.md` — full reference (this file). Used by Claude Code.
- `AGENTS.md` — Codex format. Slim mirror.
- `.cursor/rules/*.mdc` — modular, auto-loaded by Cursor on globs.

**Drift prevention:**

1. Edit `docs/conventions/<file>.md` (single source).
2. Regenerate agent files via `pnpm conventions:sync` (deferred
   to v0.2; manual sync until then).
3. Commit convention + regenerated mirrors in same commit.
4. CI check (deferred): agent files must not contain content not
   present in `docs/conventions/`.

Until the sync script ships:

- This `CLAUDE.md` is canonical.
- `AGENTS.md` and `.cursor/rules` updated MANUALLY when this file
  changes, in the same commit.
- PR diff review catches drift.

---

## §8 Code Conventions

TypeScript: `strict: true`, NodeNext, ESM only,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`isolatedModules`, `target: ES2023`. Project references for
monorepo.

**File organization:** one responsibility per file. Split when
over 300 LOC or multi-concern. One package = one bounded context;
cross-package imports only via public `exports`. No circular
imports. `index.ts` re-exports only the public surface.

**Boundaries:** validate input at system boundaries with Zod.
Trust internal code; no defensive checks for impossible cases.

**Comments:** default none — names carry meaning. Exception only
for non-obvious WHY (constraint, invariant, workaround).

**Abstraction:** 3 similar lines > premature abstraction. No
half-implementations, no impossible-case fallbacks, no pre-1.0
backward-compat shims.

**Naming:** packages `@megasaver/<name>` (kebab-case),
files `kebab-case.ts`, types `PascalCase`, vars/fns `camelCase`,
consts `SCREAMING_SNAKE_CASE` only for true constants.

Source: [docs/conventions/code-conventions.md](docs/conventions/code-conventions.md)

---

## §9 Definition of Done

A feature is "done" only when ALL hold:

1. Spec exists in `docs/superpowers/specs/`.
2. Plan exists in `docs/superpowers/plans/`.
3. Tests written first (TDD).
4. `pnpm verify` green (lint + typecheck + test).
5. Feature smoke evidence captured.
6. External reviewer agent pass (`code-reviewer` or `critic`).
   Author and reviewer NEVER same active context.
7. Verifier agent pass (`omc:verify`).
8. Zero pending TodoWrite items.
9. Changeset added if package public API changed.
10. Agent files updated if conventions changed.

**Hard rule:** Do NOT claim "complete", "fixed", "passing",
"shipped" before items 4–7 pass.

Source: [docs/conventions/definition-of-done.md](docs/conventions/definition-of-done.md)

---

## §10 Git Workflow & Commits

**Branching:** trunk-based. `main` always green. Every feature in
its own worktree. Branch names: `feat/<scope>-<slug>`,
`fix/<scope>-<slug>`, `chore/<slug>`, `docs/<slug>`. Short-lived.

**Commits:** Conventional Commits + `caveman-commit` style. Subject
≤ 50 chars, imperative. Body explains WHY only when non-obvious.
One logical change per commit. No "wip" pollution on `main`.

**Pre-merge:** rebase on `main`, `pnpm verify` green, reviewer
agent pass, PR template filled.

**Destructive ops:** no `--no-verify`, no force-push to `main`,
no `git reset --hard` without confirmation.

Source: [docs/conventions/git-and-commits.md](docs/conventions/git-and-commits.md)

---

## §11 Language & i18n

Code, docs, commits, agent files: English. Conversation language
may vary; output always English.

Product user-facing strings: v0.1 hardcoded English; v0.2+ adds
`tr` via `packages/shared/i18n`. Never hardcode Turkish in code.

Source: [docs/conventions/language.md](docs/conventions/language.md)

---

## §12 Risk-Aware Development Modes

Every feature carries a risk level set in spec frontmatter.

- **LOW** — docs / cosmetic. Brainstorming + light verify; full
  chain optional.
- **MEDIUM** — default. Full superpowers chain + `code-reviewer`.
- **HIGH** — Core / connector / public surface / user files at
  scale. Full chain + `architect` design + `critic` review.
  Worktree mandatory. Evidence-preserving compression only.
- **CRITICAL** — crypto / data deletion / permission code /
  incident. HIGH chain + `tracer` + `security-reviewer` +
  manual user confirmation. NO `autopilot` / `ralph` /
  unsupervised loops. NO log compression.

Risk assignment by spec author; reviewer may upgrade, never
silently downgrade. Default MEDIUM if unclear. Risk cannot be
lowered to skip a skill.

Source: [docs/conventions/risk-modes.md](docs/conventions/risk-modes.md)

---

## §13 Anti-Patterns (Don't)

- No half-implementations.
- No fallbacks for impossible cases.
- No pre-1.0 backward-compat shims.
- No premature abstraction.
- No comments without WHY.
- No "wip" / "fix typo" commits on `main`.
- No `--no-verify`, `--no-gpg-sign`, hook bypasses unless asked.
- No silent retries on error.
- No raw tool output / test logs into context.
- No agent-specific logic in `@megasaver/core`.
- No memory writes without metadata (source, timestamp,
  confidence, scope, expires).
- No destructive ops without explicit confirmation.
- No "this feature is too small for a spec."
- No `author == reviewer`.
- No editing agent files without also editing conventions.
- No "done" / "fixed" / "passing" claim before §9 met.

Source: [docs/conventions/anti-patterns.md](docs/conventions/anti-patterns.md)
````

- [ ] **Step 2: Verify the file**

```bash
test -f CLAUDE.md && head -1 CLAUDE.md
```

Expected: `# CLAUDE.md — Mega Saver`

- [ ] **Step 3: Verify all 13 sections present**

```bash
grep -c '^## §' CLAUDE.md
```

Expected: `13`

### Task 2.2: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: add CLAUDE.md mirroring conventions

Full thirteen-section reference for Claude Code. Inlines content
from docs/conventions/ until the conventions sync script ships
in v0.2. Each section links back to its canonical source file.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify**

```bash
git log --oneline -1
```

Expected: subject starts with `docs: add CLAUDE.md`.

---

## Task 3: `AGENTS.md` — Codex Mirror

### Task 3.1: Create `AGENTS.md`

**Files:**
- Create: `AGENTS.md`

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Verify**

```bash
test -f AGENTS.md && head -1 AGENTS.md
```

Expected: `# AGENTS.md — Mega Saver (Codex)`

### Task 3.2: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs: add AGENTS.md for Codex governance

Slim mirror of docs/conventions/ tuned to Codex idioms. References
back to canonical conventions and to CLAUDE.md for Claude
Code-specific tool wiring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Verify**

```bash
git log --oneline -1
```

Expected: subject starts with `docs: add AGENTS.md`.

---

## Task 4: `.cursor/rules/` — Cursor Mirrors

Three modular `.mdc` files, auto-loaded by Cursor based on glob
patterns.

### Task 4.1: `.cursor/rules/mega-context.mdc`

**Files:**
- Create: `.cursor/rules/mega-context.mdc`

- [ ] **Step 1: Create directory**

```bash
mkdir -p .cursor/rules
```

- [ ] **Step 2: Write the file**

````markdown
---
description: Mega Saver — mission, repo layout, stack
globs:
  - "**/*"
alwaysApply: true
---

# Mega Saver — Context

Source-of-truth references:
- `docs/conventions/mission.md`
- `docs/conventions/repo-layout.md`
- `docs/conventions/stack-and-commands.md`

## Mission

Mega Saver is the ContextOps platform for frontier coding agents.
Core is agent-agnostic; connectors are thin adapters. Tagline:
"Less tokens. More signal. Same or better agent performance."

Mega Saver is NOT a model proxy, NOT an LLM-blinder, NOT a team
chatops tool.

## Repo Layout

Monorepo. pnpm workspaces. Turborepo orchestration.

```
apps/cli                          # `mega` CLI
packages/core                     # Core Engine
packages/mcp-bridge               # MCP server (v0.2)
packages/connectors/claude-code   # First connector
packages/connectors/generic-cli   # CLI wrapper
packages/skill-packs              # Skill pack templates (v0.2)
packages/shared                   # Types, schemas, util
docs/conventions                  # Single source of truth
docs/superpowers/{specs,plans}    # Brainstorm + implementation
```

## Stack

Node 22 LTS · TypeScript strict ESM · pnpm · Turborepo · tsup ·
Vitest · Biome · Citty · Changesets.

## Commands

```bash
pnpm dev / build / test / lint / typecheck / verify
pnpm --filter @megasaver/<pkg> <cmd>
```
````

- [ ] **Step 3: Verify**

```bash
test -f .cursor/rules/mega-context.mdc && head -1 .cursor/rules/mega-context.mdc
```

Expected: `---`

---

### Task 4.2: `.cursor/rules/mega-discipline.mdc`

**Files:**
- Create: `.cursor/rules/mega-discipline.mdc`

- [ ] **Step 1: Write the file**

````markdown
---
description: Mega Saver — process discipline, DoD, skill routing
globs:
  - "packages/**"
  - "apps/**"
  - "docs/superpowers/**"
alwaysApply: true
---

# Mega Saver — Discipline

Source-of-truth references:
- `docs/conventions/process-discipline.md`
- `docs/conventions/definition-of-done.md`
- `docs/conventions/skill-routing.md`
- `docs/conventions/risk-modes.md`

## Process — every feature

In order, no exceptions:

1. Spec at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. Plan at `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.
3. TDD — failing test before production code.
4. Verification — `pnpm verify` plus smoke evidence.
5. External review — fresh-context reviewer agent.

Hard gates: no impl without spec; no merge without `pnpm verify`
green and external review pass; no "done" without evidence.

## Definition of Done

ALL must hold: spec ✓ plan ✓ TDD ✓ `pnpm verify` green ✓
smoke evidence ✓ reviewer pass ✓ verifier pass ✓ zero pending
todos ✓ changeset (if public API) ✓ agent files in sync (if
conventions changed) ✓.

Do NOT claim "complete" / "fixed" / "passing" / "shipped" before
items 4–7 met.

## Risk modes

| Level    | Examples                                | Required                                                      |
|----------|-----------------------------------------|---------------------------------------------------------------|
| LOW      | docs, copy, log message                 | brainstorm + lite verify                                      |
| MEDIUM   | normal feature, refactor, non-critical fix | full chain + reviewer                                      |
| HIGH     | Core, connector core, public surface, user files at scale | full chain + architect + critic + worktree |
| CRITICAL | crypto, data delete, permissions, incident | HIGH + tracer + security-reviewer + manual confirmation. NO autopilot/ralph |

## Skill routing

GUI phase (v0.3+): `huashu-design` (concept) → `taste-skill` /
`gpt-tasteskill` (impl) → `impeccable` (audit/polish).
Accessibility: `design:accessibility-review`. Critique:
`design:design-critique`. Style packs: `ui-ux-pro-max`,
`minimalist`, `soft`, `brutalist`.

OMC: `omc:plan`, `omc:ultrawork`, `omc:ralph`, `omc:team`,
`omc:debug`, `omc:trace`, `omc:verify`, `omc:wiki`. Avoid
`omc:autopilot` until v0.2.
````

- [ ] **Step 2: Verify**

```bash
test -f .cursor/rules/mega-discipline.mdc && head -1 .cursor/rules/mega-discipline.mdc
```

Expected: `---`

---

### Task 4.3: `.cursor/rules/mega-conventions.mdc`

**Files:**
- Create: `.cursor/rules/mega-conventions.mdc`

- [ ] **Step 1: Write the file**

````markdown
---
description: Mega Saver — code conventions, git, anti-patterns
globs:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.md"
  - "**/*.mdx"
alwaysApply: false
---

# Mega Saver — Code & Git Conventions

Source-of-truth references:
- `docs/conventions/code-conventions.md`
- `docs/conventions/git-and-commits.md`
- `docs/conventions/anti-patterns.md`
- `docs/conventions/language.md`

## Code

TypeScript strict + ESM + NodeNext. `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `isolatedModules`, target `ES2023`.
Project references for monorepo.

Files ≤ 300 LOC, single responsibility. One package = one bounded
context. Cross-package import only via public `exports`. No
circular imports.

Validate at boundaries with Zod. Trust internals.

Default no comments. Exception: WHY non-obvious only.

3 similar lines > premature abstraction. No half-implementations.
No impossible-case fallbacks. No pre-1.0 backward-compat shims.

Naming: packages `@megasaver/<name>`, files `kebab-case.ts`,
types `PascalCase`, vars/fns `camelCase`, true consts only as
`SCREAMING_SNAKE_CASE`.

## Language

Code, docs, comments, commits: English. Conversation may vary;
output always English. Product user-facing strings v0.1 English
only; v0.2+ adds `tr` via `packages/shared/i18n`. Never hardcode
Turkish in code.

## Git & Commits

Trunk-based with feature worktrees. Branch names:
`feat/<scope>-<slug>`, `fix/<scope>-<slug>`, `chore/<slug>`,
`docs/<slug>`.

Conventional Commits + `caveman-commit` style. Subject ≤ 50 chars,
imperative. Body explains WHY only when non-obvious. One logical
change per commit. No "wip" pollution on `main`.

Pre-merge: rebase on `main`, `pnpm verify` green, reviewer agent
pass, PR template filled.

No `--no-verify`, no force-push to `main`, no `git reset --hard`
without confirmation.

## Anti-Patterns

- No half-implementations. No impossible-case fallbacks.
- No pre-1.0 backward-compat shims.
- No premature abstraction. 3 lines > 1 fragile abstraction.
- No comments without WHY.
- No "wip" / "fix typo" commits on `main`.
- No hook bypass unless asked.
- No silent retries on error.
- No raw tool output / test logs into context.
- No agent-specific logic in `@megasaver/core`.
- No memory writes without metadata.
- No destructive ops without explicit confirmation.
- No "too small for a spec."
- No `author == reviewer`.
- No editing this file without also editing
  `docs/conventions/`.
- No "done" claim before all DoD items pass.
````

- [ ] **Step 2: Verify**

```bash
test -f .cursor/rules/mega-conventions.mdc && head -1 .cursor/rules/mega-conventions.mdc
```

Expected: `---`

### Task 4.4: Commit Cursor rules

- [ ] **Step 1: Verify all three files exist**

```bash
ls .cursor/rules/
```

Expected:

```
mega-context.mdc
mega-conventions.mdc
mega-discipline.mdc
```

- [ ] **Step 2: Stage and commit**

```bash
git add .cursor/rules/
git commit -m "$(cat <<'EOF'
docs: add Cursor rules mirroring conventions

Three modular .mdc files auto-loaded by Cursor:
- mega-context.mdc (mission, layout, stack — alwaysApply)
- mega-discipline.mdc (process, DoD, skill routing — alwaysApply)
- mega-conventions.mdc (code, git, anti-patterns — glob-scoped)

All reference back to docs/conventions/ canonical sources.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log --oneline -1
```

Expected: subject starts with `docs: add Cursor rules`.

---

## Task 5: Verification Pass

### Task 5.1: Manual diff check — agent files vs conventions

Verify no content in agent files that isn't traceable to a
conventions file.

- [ ] **Step 1: Confirm every agent file references its conventions sources**

```bash
grep -E '^Source:|docs/conventions/' CLAUDE.md AGENTS.md .cursor/rules/*.mdc | head -40
```

Expected: each agent file contains multiple `docs/conventions/`
references.

- [ ] **Step 2: Confirm all 12 conventions files referenced at least once across agent files**

```bash
for f in mission repo-layout stack-and-commands process-discipline skill-routing agent-routing code-conventions definition-of-done git-and-commits language risk-modes anti-patterns; do
  count=$(grep -l "docs/conventions/${f}.md" CLAUDE.md AGENTS.md .cursor/rules/*.mdc 2>/dev/null | wc -l | tr -d ' ')
  echo "${f}.md → referenced in ${count} agent file(s)"
done
```

Expected: every file shows count ≥ 1.

### Task 5.2: Reviewer agent pass

- [ ] **Step 1: Dispatch `code-reviewer` agent**

Send a single Agent tool call:

```
subagent_type: oh-my-claudecode:code-reviewer
description: Bootstrap governance review
prompt: |
  Review the Mega Saver bootstrap commit chain on branch
  feat/bootstrap-governance.

  Files added across four commits:
    - .gitignore + spec (initial commit, already on main)
    - docs/conventions/*.md (12 files)
    - CLAUDE.md
    - AGENTS.md
    - .cursor/rules/*.mdc (3 files)

  Spec: docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md
  Plan: docs/superpowers/plans/2026-05-03-mega-saver-bootstrap-plan.md

  Check:
  1. Does every CLAUDE.md section have a corresponding
     docs/conventions/ file (except §7 multi-agent dogfood)?
  2. Are AGENTS.md and .cursor/rules/* faithful slim mirrors of
     the conventions, with no content not present in conventions?
  3. Are conventional commits well-formed (subject ≤ 50 chars,
     correct types)?
  4. Any contradictions across the three agent files?
  5. Any missing rule that the spec required?

  Output: severity-rated findings with specific file:line refs.
  Approve only if no MAJOR or CRITICAL findings.
```

- [ ] **Step 2: Address findings**

If reviewer surfaces issues:

- MAJOR / CRITICAL: fix before proceeding. Re-run review after fix.
- MINOR / NIT: address inline or document as deferred follow-up.

Commit fixes as separate commits with `fix(docs):` prefix.

### Task 5.3: Verifier agent pass

- [ ] **Step 1: Dispatch `verifier` agent**

```
subagent_type: oh-my-claudecode:verifier
description: Bootstrap DoD verification
prompt: |
  Verify the Mega Saver bootstrap branch meets the partial
  Definition of Done items applicable to a docs-only feature.

  Branch: feat/bootstrap-governance
  Spec: docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md

  Items to verify:
  - Spec exists ✓ (already on main)
  - Plan exists ✓
  - All 17 deliverable files (12 conventions + CLAUDE.md +
    AGENTS.md + 3 cursor rules) exist
  - No agent file contains content not present in conventions
  - All commits are conventional-commits compliant
  - No leaked secrets, no .DS_Store, no node_modules in commits

  Items NOT applicable to docs-only feature:
  - TDD (no test code)
  - `pnpm verify` (no package.json yet)
  - Changeset (no public API yet)

  Output: pass / fail with evidence per item.
```

- [ ] **Step 2: Confirm pass**

If verifier returns pass: proceed to Task 6.
If fail: address findings, re-verify.

---

## Task 6: Finishing the Branch

Per spec open question 6: GitHub remote not yet decided. Two paths:

### Path A — Local merge to `main` (no GitHub remote yet)

- [ ] **Step 1: Switch back to main worktree**

```bash
cd /Users/halitozger/Desktop/MegaSaver
```

- [ ] **Step 2: Fast-forward `main` to the bootstrap branch**

```bash
git merge --ff-only feat/bootstrap-governance
git log --oneline
```

Expected: 5 commits on `main`:
1. `chore: bootstrap repo + brainstorm spec` (initial)
2. `docs(conventions): add canonical source of truth`
3. `docs: add CLAUDE.md mirroring conventions`
4. `docs: add AGENTS.md for Codex governance`
5. `docs: add Cursor rules mirroring conventions`

(Plus any review-fix commits from Task 5.2.)

- [ ] **Step 3: Remove the worktree**

```bash
git worktree remove ../MegaSaver-feat-bootstrap-governance
git branch -d feat/bootstrap-governance
```

Expected: clean state, single branch `main`.

- [ ] **Step 4: Confirm final state**

```bash
git status
git log --oneline
ls -la
```

Expected: clean tree, all files present, single branch.

### Path B — Open PR on GitHub (requires user decision)

This requires the user to first create a GitHub repo. Out of
scope for autonomous execution. If the user wants this path,
pause here and ask them to:

1. Create the GitHub repo.
2. Provide the remote URL.
3. Then push the branch and open a PR via `gh pr create`.

---

## Self-Review Checklist (after writing this plan)

The author of this plan ran the following self-review:

- **Spec coverage:** Every section of the spec maps to a task.
  Spec §5 (CLAUDE.md content) → Task 2. Spec §6 (AGENTS.md) →
  Task 3. Spec §7 (Cursor rules) → Task 4. Spec §8
  (docs/conventions/) → Task 1. Spec §11 (verification plan) →
  Task 5. Spec open questions noted in Task 6 (Path A vs B).
- **Placeholder scan:** No "TBD", "TODO", "implement later",
  "fill in details" in this plan. All file content is shown
  inline.
- **Type consistency:** No type signatures in this plan (markdown
  only). File paths and commit subjects match across tasks.

## Open Items After Execution

These remain open per spec §9:

1. `Saver/` directory fate — separate decision after bootstrap.
2. `pnpm conventions:sync` script — v0.2 spec.
3. GUI shell choice — v0.3 brainstorm.
4. MCP bridge protocol — v0.2 brainstorm.
5. Direct Anthropic API usage — per-feature spec.
6. GitHub remote — Task 6 Path A vs B.

## Next Specs (out of scope here, listed for trajectory)

1. `2026-XX-XX-project-skeleton` — `pnpm init`, `tsconfig.base.json`,
   `biome.json`, `turbo.json`, `.changeset/`, `pnpm-workspace.yaml`.
2. `2026-XX-XX-shared-package` — `@megasaver/shared` types and Zod.
3. `2026-XX-XX-token-audit` — first Core feature.
4. `2026-XX-XX-cli-skeleton` — `mega init`, `mega project add`.
5. `2026-XX-XX-claude-code-connector-v1`.
6. `2026-XX-XX-generic-cli-connector-v1`.
