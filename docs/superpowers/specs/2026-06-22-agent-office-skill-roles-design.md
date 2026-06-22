---
title: Agent Office — seed predefined roles from addyosmani/agent-skills
status: draft
risk: medium
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
parent_spec: docs/superpowers/specs/2026-06-22-agent-office-design.md
source: https://github.com/addyosmani/agent-skills
---

# Agent Office — agent-skills predefined roles

## Summary

Replace the 13 generic predefined office roles (seeded from CLAUDE.md §6) with a
24-role catalog modeled on the **addyosmani/agent-skills** repository — one role
per skill, grouped by its development-lifecycle phase. Gives the office a
ready-made, opinionated roster out of the box.

## Decision

- **Replace** the current 13 `SEEDS` with the 24 below (user-approved).
- Every role: `kind: "claude-code"`, `permissionMode: "plan"` (safe-by-default;
  the user opts a role up to acceptEdits/full per role), `allowedTools: []`,
  `skillPacks: [<skill-slug>]` (records the agent-skill origin; inert until the
  skill-packs feature lands), `persona` from the skill's purpose, `model` tiered
  (opus = deep reasoning/architecture/review, sonnet = standard build/ops, haiku
  = light docs).
- Pure data change in `@megasaver/agent-office`: the `SEEDS` array + a `skill`
  field on the `Seed` type; `buildPredefinedRoles` sets `skillPacks: [seed.skill]`.

## The 24 roles

`name` · `slug` (skillPacks) · `model` · persona

**DEFINE**
- Interviewer · `interview-me` · sonnet · "Interview the user one question at a time to pull out requirements to ~95% confidence before any building begins."
- Idea Refiner · `idea-refine` · sonnet · "Turn a vague concept into a concrete, scoped proposal using divergent-then-convergent thinking."
- Spec Writer · `spec-driven-development` · opus · "Write a PRD — objectives, structure, code style, testing, and boundaries — before any code is written."

**PLAN**
- Planner · `planning-and-task-breakdown` · opus · "Decompose a spec into small, independently verifiable tasks with acceptance criteria and explicit dependencies."

**BUILD**
- Implementer · `incremental-implementation` · sonnet · "Build in thin vertical slices: test, verify, commit, with a safe rollback at each step."
- Test-Driven Developer · `test-driven-development` · sonnet · "Work red-green-refactor: write the failing test first, then the minimal code; follow the test pyramid."
- Context Engineer · `context-engineering` · sonnet · "Feed agents the right information via rules files and MCP integrations; curate, don't dump."
- Source-Grounded Developer · `source-driven-development` · sonnet · "Ground framework and API decisions in official documentation with verified citations."
- Adversarial Reviewer · `doubt-driven-development` · opus · "Review high-stakes decisions adversarially from a fresh context; escalate when the risk warrants it."
- Frontend Engineer · `frontend-ui-engineering` · sonnet · "Own component architecture, design systems, state management, and WCAG accessibility."
- API Designer · `api-and-interface-design` · opus · "Design interfaces contract-first, with boundary validation and clear error semantics."

**VERIFY**
- Browser Tester · `browser-testing-with-devtools` · sonnet · "Drive Chrome DevTools for DOM inspection, interaction testing, and performance profiling."
- Debugger · `debugging-and-error-recovery` · opus · "Run a five-step triage: reproduce, localize, fix, verify, and prevent the regression."

**REVIEW**
- Code Reviewer · `code-review-and-quality` · opus · "Review changed code on five axes (correctness, design, tests, security, clarity) with change-sizing and severity-labeled findings."
- Code Simplifier · `code-simplification` · sonnet · "Reduce complexity while preserving behavior; respect Chesterton's Fence before removing anything."
- Security Reviewer · `security-and-hardening` · opus · "Prevent the OWASP Top 10; review auth patterns and secrets management."
- Performance Engineer · `performance-optimization` · opus · "Measure first, then optimize toward Core Web Vitals using real profiling data."

**SHIP**
- Release Engineer · `git-workflow-and-versioning` · sonnet · "Practice trunk-based development with atomic commits and change-sizing discipline."
- CI/CD Engineer · `ci-cd-and-automation` · sonnet · "Shift left: feature flags and quality-gate pipelines that catch problems early."
- Migration Engineer · `deprecation-and-migration` · sonnet · "Treat code as a liability; run compulsory and advisory deprecation/migration paths cleanly."
- Documentation Writer · `documentation-and-adrs` · haiku · "Write ADRs and API docs that emphasize the rationale behind decisions."
- Observability Engineer · `observability-and-instrumentation` · sonnet · "Instrument with structured logging, RED metrics, and OpenTelemetry tracing."
- Launch Manager · `shipping-and-launch` · sonnet · "Run pre-launch checklists, staged rollouts, rollback procedures, and post-launch monitoring."

**META**
- Skill Router · `using-agent-skills` · sonnet · "Map incoming work to the right skill workflow and define the operating rules for the team."

## Naming notes

`titleSchema` accepts `/` (only control chars + U+2028/2029 are rejected), so
"CI/CD Engineer" is valid. All names are non-empty, single-line, NFC.

## Seeding (the roles must actually appear)

`buildPredefinedRoles` is a pure builder that, before this change, was **never
called at runtime** (Phase 0 deferred "seeding-to-disk" to a later phase that
never landed) — so the office showed zero roles. To make the catalog real:

- New `ensurePredefinedRoles({ storeRoot, now, newId })` in
  `@megasaver/agent-office`: if `listRoles` is empty, save all 24 (idempotent —
  a no-op once any role exists, so it never clobbers user edits or re-adds
  deleted roles). Returns `{ seeded }`.
- Bridge `apps/gui/bridge/server.ts` `main()`: `await ensurePredefinedRoles(...)`
  right after `ensureOfficeProject`, so the GUI shows the roster on first run.
- CLI: `mega office role seed` (`runOfficeRoleSeed`) for parity/dogfood — prints
  how many were seeded.

## Changes

- `packages/agent-office/src/predefined-roles.ts`: add `skill: string` to the
  `Seed` type; replace `SEEDS` with the 24 entries; set
  `skillPacks: [seed.skill]` in `buildPredefinedRoles`. Update the leading
  comment (no longer "from CLAUDE.md §6"). Add `ensurePredefinedRoles`; export
  it from the package index.
- `apps/gui/bridge/server.ts`: await `ensurePredefinedRoles` on startup.
- `apps/cli/src/commands/office/role.ts` (+ `index.ts`): add the `seed`
  subcommand.
- `packages/agent-office/test/predefined-roles.test.ts`: update the count
  assertion (13 → 24); keep the all-`plan` invariant; replace the old
  roster-name assertion with the new names (e.g. Code Reviewer, Security
  Reviewer, Debugger, Test-Driven Developer); add an assertion that every role
  carries exactly one `skillPacks` entry (its slug). Keep the schema-valid +
  injected-now/newId tests.
- `wiki/entities/agent-office.md`: update the "13 seed roles" note → 24 roles
  from addyosmani/agent-skills; cite the source.

## Out of scope

- No change to the launcher or supervisor — they read roles generically; 24 vs
  13 is transparent. The bridge/CLI changes are limited to the one-time seeding
  call above (no logic change). `skillPacks` stays inert (no skill loading)
  until the skill-packs feature ships. The GUI is unchanged — it renders
  whatever roles the seeded store returns.
- Not importing the actual SKILL.md bodies — personas are concise summaries of
  each skill's purpose (the slug links back to the source).

## Testing

`pnpm --filter @megasaver/agent-office test` — the predefined-roles suite proves
24 schema-valid roles, all `permissionMode: "plan"`, each with its `skillPacks`
slug, deterministic under injected `now`/`newId`. `pnpm verify` green
(ubuntu+windows). Existing supervisor/store tests are unaffected (they don't
depend on the specific role set).

## Definition of Done

- 24 roles seeded; tests updated + green; wiki updated; `pnpm verify` green.
- Changeset (minor `@megasaver/agent-office`).
- code-reviewer pass (author ≠ reviewer).
