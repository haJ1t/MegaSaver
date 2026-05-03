---
date: 2026-05-03
topic: mega-saver-bootstrap-and-agent-governance
status: approved
risk: medium
authors:
  - Halit Ozger (haltozger0202@gmail.com)
  - Claude Opus 4.7 (1M context)
---

# Mega Saver — Project Bootstrap & Agent Governance

## 1. Context

Greenfield project. Source of intent:
`/Users/halitozger/Desktop/mega_saver_platform_fikri.txt` (1421 lines).

The product itself is a multi-subsystem ContextOps platform for frontier
coding agents. It contains six independent deliverables (Core Engine,
App, Connectors, Skill Packs, MCP Bridge, CLI) and over thirty
features. That scope cannot be specified in a single document.

**This spec covers two foundation-only concerns:**

1. **Project bootstrap decisions** — path, repo shape, stack, MVP
   scope, language, git workflow.
2. **Agent governance files** — the `CLAUDE.md`, `AGENTS.md`, and
   `.cursor/rules/*.mdc` documents that tell every coding agent how
   to work on this repo, plus the `docs/conventions/` source of
   truth they all reference.

Subsystem architecture and per-feature implementation are explicitly
deferred to subsequent specs.

## 2. Goals

1. Establish the project root and immutable conventions before any
   code exists.
2. Encode strict superpowers discipline as project rules, applicable
   to every feature.
3. Set up multi-agent dogfood files (`CLAUDE.md` + `AGENTS.md` +
   `.cursor/rules`) on day one — Mega Saver itself is agent-agnostic,
   and we model that from the start.
4. Map design skills (huashu-design, taste-skill, gpt-tasteskill,
   impeccable, etc.) to the phases that actually need them.
5. Define how risk levels gate which skills are mandatory versus
   conditional.

## 3. Non-goals

- Implementing any feature, even a stub.
- Producing any subsystem architecture document.
- Choosing a desktop GUI shell (Tauri vs Electron). Deferred to the
  GUI phase (v0.3+).
- Designing the MCP bridge protocol. Deferred to v0.2.
- Solving the docs-conventions sync script. Manual sync until v0.2.

## 4. Decisions Matrix

| # | Decision | Value |
|---|----------|-------|
| 1 | Project root | `/Users/halitozger/Desktop/MegaSaver/` |
| 2 | Repo shape | Monorepo (pnpm workspaces + Turborepo) |
| 3 | First slice (MVP v0.1) | Headless: Core + CLI + Claude Code Connector + Generic CLI Connector |
| 4 | Stack | Node 22 LTS, TypeScript strict ESM, pnpm, Turborepo, tsup, Vitest, Biome, Citty (CLI), Changesets |
| 5 | Process discipline | Strict superpowers chain mandatory on every feature |
| 6 | Multi-agent dogfood | Day-1: `CLAUDE.md` + `AGENTS.md` + `.cursor/rules/` |
| 7 | Design skill mapping | huashu-design (concept) → taste-skill / gpt-tasteskill (impl) → impeccable (audit/polish) |
| 8 | Language | All English (code, docs, commits, agent files) |
| 9 | Commits | Conventional Commits + caveman-commit (≤50 char subject, body only when "why" non-obvious) |
| 10 | Git workflow | Trunk-based + worktree-per-feature |

## 5. Proposed Content — CLAUDE.md

The following thirteen sections form `/Users/halitozger/Desktop/MegaSaver/CLAUDE.md`.
Implementation will write each section as its own block; long blocks
reference shared `docs/conventions/<file>.md` markdown.

### §1 — Mission & North Star

```markdown
## Mission

Mega Saver is the ContextOps platform for frontier coding agents.
It connects to Claude Code, Codex, Cursor, Aider, and any CLI
agent. It manages context, memory, sessions, and token efficiency
from one control panel.

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

### §2 — Repo Layout

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

### §3 — Stack & Commands

```
Runtime:    Node 22 LTS (.nvmrc pinned)
Language:   TypeScript strict, ESM only
Package:    pnpm (workspace protocol for internal deps)
Build:      tsup per-package + Turborepo orchestration
Test:       Vitest (unit + integration)
Lint+fmt:   Biome
Type-check: tsc --noEmit (project references)
CLI fwk:    Citty (UnJS — modern, ESM-native, typed args)
Versioning: Changesets

Commands (from repo root):

pnpm install
pnpm dev              # turbo dev — watch all
pnpm build            # turbo build — emit dist/
pnpm test             # vitest run (CI mode)
pnpm test:watch
pnpm lint             # biome check
pnpm lint:fix         # biome check --write
pnpm typecheck        # tsc -b --noEmit
pnpm verify           # lint + typecheck + test (DoD gate)

Per-package:
pnpm --filter @megasaver/<pkg> <cmd>
```

### §4 — Process Discipline (MANDATORY)

```
Every feature follows the strict superpowers chain. No exceptions.
No "this is too small to need a spec."

Mandatory chain (in order):

1. superpowers:brainstorming          idea → spec
2. superpowers:writing-plans          spec → step plan
3. superpowers:test-driven-development test before code
4. superpowers:verification-before-completion  evidence required
5. superpowers:requesting-code-review pre-merge external review

Conditional skills:

- superpowers:systematic-debugging        bug / test fail
- superpowers:using-git-worktrees         every feature default
- superpowers:dispatching-parallel-agents 2+ independent tasks
- superpowers:subagent-driven-development plan with parallel tasks
- superpowers:receiving-code-review       review feedback received
- superpowers:finishing-a-development-branch  merge/PR phase

Hard gates (no exceptions):
- No implementation without an approved spec
- No merge without passing `pnpm verify`
- No merge without external reviewer agent pass
- No "done" claim without verifier evidence
- Author and reviewer NEVER same active context
```

### §5 — Skill Routing

#### §5a. superpowers
See §4. Mandatory chain on every feature. Conditional set as listed.

#### §5b. Design skills (GUI phase, v0.3+)

```
Mega Saver MVP is headless. Design skills activate when GUI work begins.

| Trigger / Phase                          | Skill                          |
|------------------------------------------|--------------------------------|
| New screen/component CONCEPT exploration | huashu-design                  |
|   (no code yet, exploring variants)      | (HTML hi-fi + critique)        |
| Concept locked → real frontend impl      | taste-skill OR gpt-tasteskill  |
| Existing UI audit / polish / redesign    | impeccable                     |
| Style direction (theme/palette/typo)     | ui-ux-pro-max OR style packs   |
|                                          | (minimalist/soft/brutalist)    |
| Accessibility pass                       | design:accessibility-review    |
| Pre-merge design critique                | design:design-critique         |
| Design system docs                       | design:design-system           |
| UX copy (microcopy/error/empty)          | design:ux-copy                 |
| Visual reference generation              | imagegen-frontend-web          |

taste-skill vs gpt-tasteskill:
- engineering-heavy / metric-driven  → taste-skill
- editorial / motion / hero pages    → gpt-tasteskill
- if unsure                          → taste-skill default
```

#### §5c. OMC skills — agent delegation

```
Skills:
- omc:plan         strategic planning, optional interview
- omc:ultrawork    parallel high-throughput
- omc:ralph        self-referential loop until complete
- omc:team         N agents on shared list
- omc:debug        session/repo state diagnose
- omc:trace        evidence-driven causal tracing
- omc:verify       verifier pass (§4 step 4)
- omc:deepinit     codebase docs (one-time after first feature)
- omc:wiki         persistent knowledge wiki
- omc:autopilot    full autonomous (avoid until v0.2)

Agents (via Agent tool):
- executor             implementation
- planner / architect  design, trade-offs (Opus)
- explore              codebase search
- code-reviewer        pre-merge review
- critic               adversarial review
- debugger             root cause
- verifier             completion check
- writer               docs/comments
- document-specialist  external SDK/API docs
- security-reviewer    OWASP/secrets pass
```

#### §5d. claude-api skill

```
If Mega Saver Core calls the Anthropic API directly (e.g., native
LLM-powered compression or summarization), the claude-api skill
auto-triggers. It enforces:

- Prompt caching always on
- Latest model defaults (claude-opus-4-7 / claude-sonnet-4-6 /
  claude-haiku-4-5)
- Streaming where applicable

Mega Saver does NOT proxy or relay user prompts to LLMs by default.
Direct API use is opt-in per feature and must be flagged in the
feature spec along with cost and privacy notes.
```

### §6 — Agent Routing

```
Choose the lightest path that preserves quality.

Direct work (no delegation):
- Trivial ops (single file rename, one-liner fix, copy edit)
- Direct config writes: ~/.claude/**, .omc/**, .claude/**,
  CLAUDE.md, AGENTS.md, .cursor/rules
- Single bash commands
- Quick clarifications

Delegate to specialized agent:
- Multi-file changes / refactors                  → executor (opus)
- Codebase exploration > 3 queries                → explore
- Architecture / trade-off / design decisions     → architect (opus)
- Step-by-step implementation plans               → planner (opus)
- Debugging non-trivial bugs / regression isolate → debugger
- Pre-merge code review                           → code-reviewer
- Adversarial second-opinion review               → critic (opus)
- Verification / DoD evidence                     → verifier
- External SDK / API docs lookup                  → document-specialist
- Security / OWASP / secrets sweep                → security-reviewer
- Test strategy / hardening flaky tests           → test-engineer
- Tracing causal hypotheses                       → tracer
- Docs / README / API docs                        → writer (haiku)
- UI/UX implementation work                       → designer

Model routing:
- haiku   quick lookups, simple writes
- sonnet  standard implementation
- opus    architecture, deep analysis, security, complex review

Parallel rules:
- 2+ independent tasks → dispatch in single message
- Builds/tests/long ops → run_in_background
- Sequential when result of one feeds another
```

### §7 — Multi-Agent Dogfood

```
Mega Saver's product premise: connectors generate per-agent config.
We dogfood by writing all three from day one and keeping them in
sync via a single source of truth.

Source of truth:
docs/conventions/*.md — markdown blocks with stable IDs.

Files in docs/conventions/:
- mission.md              (§1)
- repo-layout.md          (§2)
- stack-and-commands.md   (§3)
- process-discipline.md   (§4)
- skill-routing.md        (§5)
- agent-routing.md        (§6)
- code-conventions.md     (§8)
- definition-of-done.md   (§9)
- git-and-commits.md      (§10)
- language.md             (§11)
- risk-modes.md           (§12)
- anti-patterns.md        (§13)
(§7 — multi-agent dogfood — is meta about this system itself
and does not need a canonical conventions file.)

File scopes:
- CLAUDE.md      — full reference. All sections. Used by Claude Code.
- AGENTS.md      — Codex format. Slim, references same blocks tuned
                    to Codex idioms.
- .cursor/rules/ — modular .mdc files. Auto-loaded by Cursor based
                    on file globs:
                    - mega-context.mdc      (mission + layout)
                    - mega-discipline.mdc   (process + DoD)
                    - mega-conventions.mdc  (code + git)

Drift prevention:
1. Edit docs/conventions/<file>.md (single source).
2. Regenerate agent files via `pnpm conventions:sync` (deferred;
   manual sync until v0.2).
3. Commit convention + regenerated mirrors in same commit.
4. CI check (deferred): agent files must not contain content not
   present in docs/conventions/.

Until sync script ships:
- CLAUDE.md is canonical.
- AGENTS.md and .cursor/rules updated MANUALLY when CLAUDE.md
  changes, in the same commit.
- PR diff review catches drift.
```

### §8 — Code Conventions

```
TypeScript:
- strict: true (all strict flags on)
- moduleResolution: NodeNext
- module: NodeNext (ESM only)
- noUncheckedIndexedAccess: true
- exactOptionalPropertyTypes: true
- isolatedModules: true
- skipLibCheck: true
- target: ES2023
Project references for monorepo. Each package its own tsconfig
extending tsconfig.base.json.

File organization:
- One responsibility per file. Split when > 300 LOC OR multi-concern.
- One package = one bounded context. Cross-package import only
  through public entry (package.json `exports`).
- No circular imports.
- index.ts re-exports only the public surface.

Boundaries:
- Validate input at system boundaries (CLI args, file reads,
  external API responses, MCP messages).
- Trust internal code. No defensive checks for impossible cases.
- Use Zod schemas for all external boundaries. Generated types,
  not hand-written.

Comments:
- Default: no comments. Names carry meaning.
- Exception: WHY non-obvious (constraint, invariant, workaround).
- Never: "what" comments, "added for X flow", "used by Y".

Abstraction:
- 3 similar lines > premature abstraction.
- No half-implementations.
- No fallbacks for impossible cases.
- No backward-compat shims while pre-1.0.

Naming:
- packages: @megasaver/<name> (kebab-case)
- files:    kebab-case.ts
- types:    PascalCase
- vars/fns: camelCase
- consts:   SCREAMING_SNAKE_CASE only for true constants
```

### §9 — Definition of Done

```
A feature is "done" only when ALL of these hold:

1. Spec exists in docs/superpowers/specs/.
2. Plan exists in docs/superpowers/plans/.
3. Tests written first (TDD).
4. `pnpm verify` green:
   - biome check     (lint + format)
   - tsc --noEmit    (type-check, project refs)
   - vitest run      (all tests pass)
5. Feature smoke evidence:
   - CLI feature → captured terminal session
   - Library API → integration test exercising public surface
   - Connector  → real agent run captured
6. External reviewer agent pass (code-reviewer or critic).
   Author and reviewer NEVER same active context.
7. Verifier agent pass (omc:verify) — evidence-based check.
8. Zero pending TodoWrite items for the feature.
9. Changeset added (.changeset/<descriptor>.md) if package public
   API changed.
10. CLAUDE.md / AGENTS.md / .cursor/rules updated if conventions
    changed (drift check per §7).

If any item fails: not done. Iterate.

Hard rule:
Do NOT claim "complete", "fixed", "passing", "shipped" before
items 4–7 pass. Verification before assertion.
```

### §10 — Git Workflow & Commits

```
Branching:
- Trunk-based. `main` always green and shippable.
- Every feature in its own worktree.
- Branch name:
    feat/<scope>-<slug>
    fix/<scope>-<slug>
    chore/<slug>
    docs/<slug>
- Short-lived. Merge or kill within days.

Commits — Conventional Commits + `caveman-commit` skill style
(invoke `caveman-commit` skill when generating messages):

  <type>(<scope>): <subject>

  <body — only when "why" non-obvious>

Types: feat | fix | refactor | perf | test | docs | chore | build | ci

Rules:
- Subject ≤ 50 chars, imperative ("add", not "added").
- Body explains WHY, not WHAT.
- One logical change per commit. Atomic.
- No "wip" / "fix typo" pollution on main — squash before merge.

Examples:
  feat(core): token audit reports waste sources
  fix(cli): mega run propagates exit code
  refactor(core): extract risk detector from session engine

Pre-merge:
- Rebase on main (not merge).
- `pnpm verify` green.
- Reviewer agent pass (§9 DoD).
- PR template filled (.github/pull_request_template.md).

Branch protection (when GitHub repo created):
- main: no force push, require PR, require status checks.
- Linear history.
- Delete branch after merge.

Destructive ops:
- No --no-verify.
- No --force-push to main.
- No git reset --hard without confirmation.
- Investigate unfamiliar files/branches before deleting.
```

### §11 — Language & i18n

```
- Code, identifiers, comments, docs, commit messages: English.
- Spec/plan files: English.
- Agent files (CLAUDE.md, AGENTS.md, .cursor/rules): English.
- Conversation language may vary; OUTPUT is always English.

Product user-facing strings (deferred):
- v0.1 CLI: English only. Hardcoded strings.
- v0.2+: i18n via packages/shared/i18n. Default `en`, then `tr`.
- Never hardcode Turkish in code. Route through i18n layer.
```

### §12 — Risk-Aware Development Modes

```
Mega Saver's product has a Risk Detector. We dogfood it on
ourselves: every feature has an implicit risk level that
determines which skills are mandatory.

LOW
  Examples: README edit, comment polish, CLI help-text tweak,
            internal log message, dev-only logging.
  Mandatory: brainstorming + verification (lite).
  Optional:  full superpowers chain.
  OK to skip: TDD when no logic.

MEDIUM
  Examples: normal feature add, refactor, bug fix in non-critical
            module, dev tooling, build script.
  Mandatory: full superpowers chain (§4).
  Required reviewer: code-reviewer.

HIGH
  Examples: token audit logic, context packer, evidence-preserving
            compression, memory schema change, session storage
            format, connector core path, public CLI flags,
            anything touching user files at scale.
  Mandatory: full chain + omc:architect for design
                          + omc:critic adversarial review
                          + worktree (no main edits).
  Required reviewer: code-reviewer AND critic (separate passes).
  Skill mode: evidence-preserving only. No aggressive compression.

CRITICAL
  Examples: cryptographic ops, anything that deletes user data,
            anything that mutates user repos beyond known ignore
            patterns, license/permission code, production incident
            response.
  Mandatory: HIGH chain + omc:tracer evidence loop
                        + omc:security-reviewer
                        + verifier with reproduction evidence
                        + manual user confirmation in spec.
  Forbidden: autopilot, ralph, or any unsupervised loop.
  Skill mode: debug + evidence only. No log compression.

Risk assignment:
- Spec author assigns risk in front-matter.
- Reviewer may upgrade. Never silently downgrade.
- If unclear, default MEDIUM.

Anti-cheat:
- Risk level cannot be lowered to skip a skill.
- Wanting to lower risk is a signal to keep the skill.
```

### §13 — Anti-Patterns (Don't)

```
Hard "don't" list. Not preferences. Violating any fails review.

- No half-implementations. Scope smaller; don't merge stub functions.
- No fallbacks for cases that cannot happen. Trust internals.
- No backward-compat shims pre-1.0. Break things; bump version.
- No premature abstraction. 3 similar lines > 1 fragile abstraction.
- No comments without a WHY. No "what" comments.
- No "wip" / "fix typo" / "address feedback" commits on main.
- No --no-verify, --no-gpg-sign, hook bypasses unless user asked.
- No silent retries on error. Diagnose root cause.
- No raw tool output / test log / build log into context. Compress.
- No agent-specific logic in @megasaver/core. Connectors isolate.
- No memory writes without metadata: source, timestamp, confidence,
  scope, expires.
- No destructive ops (rm -rf, force push, branch delete, history
  rewrite) without explicit user confirmation in same conversation.
- No "this feature is too small for a spec." See §4 hard rule.
- No author == reviewer. Reviewer in fresh context, no authoring
  memory.
- No editing CLAUDE.md / AGENTS.md / .cursor/rules without also
  editing docs/conventions/ source of truth (§7 drift rule).
- No claiming "done" / "fixed" / "passing" before §9 DoD met.
```

## 6. Proposed Content — AGENTS.md (Codex)

`AGENTS.md` is the Codex-readable mirror. Slim. References the same
`docs/conventions/` blocks. Approximate target: ~150 lines.

Structure:

```
# AGENTS.md — Codex governance

## Mission
[from docs/conventions/mission.md]

## Stack & Commands
[from docs/conventions/stack-and-commands.md]

## Process Discipline (Codex form)
- Every task: spec first (docs/superpowers/specs/).
- Every implementation: plan first (docs/superpowers/plans/).
- TDD strict.
- Verification before completion.
- External reviewer pass before merge.
[reference docs/conventions/process-discipline.md for full rules]

## Code Conventions
[from docs/conventions/code-conventions.md]

## Git & Commits
[from docs/conventions/git-and-commits.md]

## Anti-Patterns
[from docs/conventions/anti-patterns.md]
```

Codex notes:
- Codex AGENTS.md does not have native skill invocation. Process
  discipline is enforced by Codex reading these rules and following
  them as instructions.
- Reference `CLAUDE.md` for Claude Code-specific tool wiring (Skill
  invocations, OMC agent names).

## 7. Proposed Content — `.cursor/rules/`

Three modular `.mdc` files, auto-loaded by Cursor.

### `mega-context.mdc`

```
---
description: Mega Saver — mission, repo layout, stack
globs: ["**/*"]
---

[blocks from docs/conventions/mission.md +
        docs/conventions/repo-layout.md +
        docs/conventions/stack-and-commands.md]
```

### `mega-discipline.mdc`

```
---
description: Mega Saver — process discipline, DoD
globs: ["packages/**", "apps/**"]
---

[blocks from docs/conventions/process-discipline.md +
        docs/conventions/definition-of-done.md +
        docs/conventions/skill-routing.md (Cursor-relevant subset)]
```

### `mega-conventions.mdc`

```
---
description: Mega Saver — code conventions, git, anti-patterns
globs: ["**/*.ts", "**/*.tsx", "**/*.md"]
---

[blocks from docs/conventions/code-conventions.md +
        docs/conventions/git-and-commits.md +
        docs/conventions/anti-patterns.md]
```

## 8. Proposed Content — `docs/conventions/`

Each file is the canonical source for one section. Plain markdown.
No frontmatter required. Identified by filename.

Files (created by implementation plan):

- `mission.md`
- `repo-layout.md`
- `stack-and-commands.md`
- `process-discipline.md`
- `skill-routing.md`
- `agent-routing.md`
- `code-conventions.md`
- `definition-of-done.md`
- `git-and-commits.md`
- `language.md`
- `risk-modes.md`
- `anti-patterns.md`

(Twelve files total. CLAUDE.md §7 — multi-agent dogfood — is meta
about this conventions system and does not need its own file.)

The agent files (CLAUDE.md, AGENTS.md, `.cursor/rules/*`) inline the
content from these files until the sync script lands. After sync
ships, agent files contain only references and the conventions
files are the only place text lives.

## 9. Open Questions / Followups

1. **`Saver/` directory fate** — `/Users/halitozger/Desktop/Saver/`
   exists with an empty `.omc/` placeholder. Decision deferred until
   bootstrap commit lands. Options: leave it, delete it, repurpose.
   Not blocking.
2. **`pnpm conventions:sync` script** — deferred to v0.2. Until then
   agent files updated manually with PR drift review.
3. **GUI shell choice (Tauri vs Electron)** — deferred to v0.3 GUI
   phase brainstorm. Out of scope here.
4. **MCP bridge protocol** — deferred to v0.2 brainstorm.
5. **Direct Anthropic API usage in Core** — opt-in per feature spec.
   Each future spec that uses it must include cost and privacy notes.
6. **GitHub remote** — not created yet. Decision: do we want a public
   GitHub repo at this stage, or keep local-only until v0.1 ships?
   Out of scope for this spec; revisit at v0.1 finishing-branch step.

## 10. Risk Assessment

**MEDIUM.**

These are foundational decisions that propagate to every future
feature. Mistakes are costly to reverse but not catastrophic. Single
spec with bounded scope (governance files + bootstrap decisions
only) keeps blast radius small. No code, no production data, no
user-facing changes.

Per §12 of the proposed CLAUDE.md, MEDIUM mandates the full
superpowers chain. This spec satisfies the brainstorming step. The
implementation plan (next step) handles writing-plans → TDD →
verification → review.

## 11. Verification Plan

When the implementation plan completes, the following must be true:

- [ ] `MegaSaver/CLAUDE.md` exists with all 13 sections matching this
  spec.
- [ ] `MegaSaver/AGENTS.md` exists, references same conventions.
- [ ] `MegaSaver/.cursor/rules/mega-context.mdc` exists.
- [ ] `MegaSaver/.cursor/rules/mega-discipline.mdc` exists.
- [ ] `MegaSaver/.cursor/rules/mega-conventions.mdc` exists.
- [ ] `MegaSaver/docs/conventions/*.md` — all twelve files exist
  with canonical content.
- [ ] No content in agent files that is not present in
  `docs/conventions/` (manual diff check).
- [ ] Initial git commits clean (no `node_modules`, no `.DS_Store`).
- [ ] Reviewer agent (code-reviewer) passes the bootstrap PR.
- [ ] Verifier agent confirms agent files load without contradiction.

## 12. Next Step

After this spec is approved by the user:

1. Invoke `superpowers:writing-plans` to produce the implementation
   plan for THIS spec — i.e., the steps to actually create the
   `docs/conventions/` files and the three agent files.
2. Execute that plan (under §4 discipline) in a worktree.
3. Open a bootstrap PR for self-review and external reviewer agent
   pass.

Subsequent specs (out of scope here, listed for trajectory):

1. `2026-XX-XX-project-skeleton` — pnpm init, `tsconfig.base.json`,
   `biome.json`, `turbo.json`, `.changeset/`.
2. `2026-XX-XX-shared-package` — `@megasaver/shared` types and Zod
   schemas.
3. `2026-XX-XX-token-audit` — first Core feature: token audit slice.
4. `2026-XX-XX-cli-skeleton` — `mega init`, `mega project add`.
5. `2026-XX-XX-claude-code-connector-v1`.
6. `2026-XX-XX-generic-cli-connector-v1`.

Each gets its own brainstorm → spec → plan → TDD implementation →
review → merge cycle. Strict.
