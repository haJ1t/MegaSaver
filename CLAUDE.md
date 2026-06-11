# CLAUDE.md — Mega Saver

Operational reference for Claude Code, generated from `docs/conventions/`.

> **Generated file — do not hand-edit the managed blocks.** Every
> `<!-- conventions:* -->` block below is regenerated from
> `docs/conventions/*.md` by `pnpm conventions:sync`. Edit the source
> there, not here; `pnpm conventions:check` (in `pnpm verify`) fails
> CI on drift. Content outside the blocks (section headings, `Source:`
> links) is hand-kept. See §7 for the dogfood rule.

---

## §0 Wiki-First Memory (SESSION START — READ FIRST)

<!-- conventions:start id="wiki-first" source="wiki-first.md" -->
The wiki (`wiki/`) is the persistent, shared memory for this project.
Before any other work, read `wiki/index.md` to learn what exists. All
agents share this wiki — what one agent writes, another inherits.

## Startup routine (MANDATORY)

1. Read `wiki/index.md` — catalog of all wiki pages.
2. Read 1–3 targeted pages relevant to the current task.
3. Do NOT read the raw 1421-line `fikri.txt` — use
   `wiki/sources/fikri-original.md`.
4. Do NOT skip the wiki and dive into raw spec/plan files for
   orientation.

## Wiki governance

- The wiki schema lives at `wiki/CLAUDE.md` — it defines folder
  structure, page format, ingestion rules, and hard rules.
- `wiki/raw/` is immutable. Never write there.
- Every non-trivial claim cites a source.
- Pages are not deleted — moved to `wiki/archive/`.
- After completing work, update relevant wiki pages and append a
  timestamped entry to `wiki/log.md`.

## Cross-agent communication

Multiple agents (e.g. Claude Code and Codex) may run side-by-side.
They share two channels:

1. **Wiki** (`wiki/`) — shared persistent memory. Write findings to
   wiki pages so the other agent picks them up.
2. **Shared channel** — `wiki/agent-channel.md` is a scratchpad for
   inter-agent messages. Read it on session start; write status
   updates, handoff notes, or requests there.

Agents may also delegate to one another through configured MCP
bridges where available.

## Wiki-first hard rule

The wiki is the ONLY memory channel for project knowledge across
sessions and across agents. If the wiki lacks a needed page, write it
during the work; do not bypass the wiki.
<!-- conventions:end id="wiki-first" -->

Source: [docs/conventions/wiki-first.md](docs/conventions/wiki-first.md)

---

## §1 Mission & North Star

<!-- conventions:start id="mission" source="mission.md" -->
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
<!-- conventions:end id="mission" -->

Source: [docs/conventions/mission.md](docs/conventions/mission.md)

---

## §2 Repo Layout

<!-- conventions:start id="repo-layout" source="repo-layout.md" -->
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
<!-- conventions:end id="repo-layout" -->

Source: [docs/conventions/repo-layout.md](docs/conventions/repo-layout.md)

---

## §3 Stack & Commands

<!-- conventions:start id="stack-and-commands" source="stack-and-commands.md" -->
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

Note: configuration files (`tsconfig.base.json`, `biome.json`,
`turbo.json`, `pnpm-workspace.yaml`) are introduced by the
`project-skeleton` spec, not this bootstrap. Until then, the commands
above are aspirational and will activate when the skeleton lands.
<!-- conventions:end id="stack-and-commands" -->

Source: [docs/conventions/stack-and-commands.md](docs/conventions/stack-and-commands.md)

---

## §4 Process Discipline (MANDATORY)

<!-- conventions:start id="process-discipline" source="process-discipline.md" -->
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
<!-- conventions:end id="process-discipline" -->

Source: [docs/conventions/process-discipline.md](docs/conventions/process-discipline.md)

---

## §5 Skill Routing

<!-- conventions:start id="skill-routing" source="skill-routing.md" -->
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
- `test-engineer` — test strategy, integration/e2e, flaky-test hardening.
- `tracer` — evidence-driven causal tracing with competing hypotheses.
- `designer` — UI/UX implementation work (GUI phase).

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
<!-- conventions:end id="skill-routing" -->

Source: [docs/conventions/skill-routing.md](docs/conventions/skill-routing.md)

---

## §6 Agent Routing

<!-- conventions:start id="agent-routing" source="agent-routing.md" -->
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
<!-- conventions:end id="agent-routing" -->

Source: [docs/conventions/agent-routing.md](docs/conventions/agent-routing.md)

---

## §7 Multi-Agent Dogfood

<!-- conventions:start id="multi-agent-dogfood" source="multi-agent-dogfood.md" -->
Mega Saver's product premise: connectors generate per-agent config.
We dogfood by writing all four agent files from day one and keeping
them in sync via a single source of truth.

**Source of truth:** `docs/conventions/*.md` — fourteen canonical
files: `wiki-first.md` (§0) plus one per `CLAUDE.md` section §1–§13.
Every managed agent file mirrors named sections from them; nothing in
a managed block is hand-edited.

## File scopes

- `CLAUDE.md` — full reference. Used by Claude Code.
- `AGENTS.md` — Codex format. Slim mirror.
- `.cursor/rules/*.mdc` — modular, auto-loaded by Cursor on globs.
- `CONVENTIONS.md` — plain markdown, written by
  `mega connector sync --target aider`. Loaded by Aider via
  `--read CONVENTIONS.md` or `.aider.conf.yml`.

## Drift prevention

1. Edit `docs/conventions/<file>.md` (single source).
2. Regenerate agent files via `pnpm conventions:sync`.
3. Commit convention + regenerated mirrors in same commit.
4. `pnpm conventions:check` (folded into `pnpm verify`) fails CI if any
   managed file drifts from `docs/conventions/`.

`CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/*.mdc` are all managed
consumers: their sentinel-bounded blocks are regenerated from
`docs/conventions/`. Content **outside** the sentinel blocks (section
headings, `Source:` links, agent-specific notes) is hand-kept and
preserved across syncs. `CONVENTIONS.md` (Aider) is not a sync
consumer — the repo generates none; it is the product feature
`mega connector sync --target aider`.

## Cursor connector frontmatter contract

The cursor target writes `.cursor/rules/megasaver.mdc`. The
`ConnectorTarget.header` field contains YAML frontmatter that is
prepended exactly once — on the first seed of a non-existing file.
On every subsequent `mega connector sync`, only the content
**inside** the `MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END`
sentinel pair is touched. Any user edits to the frontmatter,
headings, or body text that live **outside** the sentinel block are
preserved across sync runs.
<!-- conventions:end id="multi-agent-dogfood" -->

Source: [docs/conventions/multi-agent-dogfood.md](docs/conventions/multi-agent-dogfood.md)

---

## §8 Code Conventions

<!-- conventions:start id="code-conventions" source="code-conventions.md" -->
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

## Parse-on-handoff policy

CLI command handlers re-parse user input at the handoff boundary into Core
**if and only if** a later consumer (renderer, file writer, block formatter)
would crash or corrupt output on bad input that Core's schema did not reject.
Once data has crossed the schema boundary inside Core (i.e., it was accepted by
`registry.createMemoryEntry`, `registry.createSession`, etc.), trust Core's
validated result — do not re-parse on the read side.

Examples:
- `memory create`: re-parses content + session id because the connector block
  renderer writes it verbatim into agent config files (downstream crash risk).
- `session create`: trusts Core's internal validation; the renderer only
  displays structured fields that Core already validated.
<!-- conventions:end id="code-conventions" -->

Source: [docs/conventions/code-conventions.md](docs/conventions/code-conventions.md)

---

## §9 Definition of Done

<!-- conventions:start id="definition-of-done" source="definition-of-done.md" -->
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
<!-- conventions:end id="definition-of-done" -->

Source: [docs/conventions/definition-of-done.md](docs/conventions/definition-of-done.md)

---

## §10 Git Workflow & Commits

<!-- conventions:start id="git-and-commits" source="git-and-commits.md" -->
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
<!-- conventions:end id="git-and-commits" -->

Source: [docs/conventions/git-and-commits.md](docs/conventions/git-and-commits.md)

---

## §11 Language & i18n

<!-- conventions:start id="language" source="language.md" -->
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
<!-- conventions:end id="language" -->

Source: [docs/conventions/language.md](docs/conventions/language.md)

---

## §12 Risk-Aware Development Modes

<!-- conventions:start id="risk-modes" source="risk-modes.md" -->
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
<!-- conventions:end id="risk-modes" -->

Source: [docs/conventions/risk-modes.md](docs/conventions/risk-modes.md)

---

## §13 Anti-Patterns (Don't)

<!-- conventions:start id="anti-patterns" source="anti-patterns.md" -->
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
<!-- conventions:end id="anti-patterns" -->

Source: [docs/conventions/anti-patterns.md](docs/conventions/anti-patterns.md)

---
