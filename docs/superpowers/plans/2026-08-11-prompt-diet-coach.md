# Prompt Diet Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Advisory hook suggestion + offline `mega prompt diet` replay, deterministic heuristics, never blocking.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, `@megasaver/output-filter`, `@megasaver/policy`.

## Global Constraints

- Fail-open, always exit 0, empty on disabled/config missing.
- At most one suggestion per prompt (highest delta), ≤12 lines.
- estimateTokens for delta, redact on suggestion snippet.
- Conventional commits ≤ 50 chars.

---

### Task 1: pure diet rules

**Files:** `apps/cli/src/prompt/coach.ts` (new), `apps/cli/test/prompt/coach.test.ts` (new)

- [ ] Write failing test: each of 5 rules fires on verbose fixture and not on concise; single-best selection; suppress on short; token delta; redaction.
- [ ] Run — FAIL → Implement pure rules + runDietRules → PASS → Commit `feat(cli): prompt diet rules`

---

### Task 2: hook

**Files:** `apps/cli/src/hooks/prompt-coach-run.ts` (new), `apps/cli/test/hooks/prompt-coach.test.ts` (new)

- [ ] Write failing test: enabled:true + verbose prompt → envelope with card; enabled:false → ""; malformed config → ""; never throws.
- [ ] Run — FAIL → Implement buildPromptCoachOutput + runFromProcess → PASS → Commit `feat(cli): prompt coach hook`

---

### Task 3: `mega prompt` commands

**Files:** `apps/cli/src/commands/prompt/coach.ts`, `diet.ts`, `index.ts` (new), `apps/cli/test/commands/prompt.test.ts` (new), `apps/cli/src/main.ts` (register)

- [ ] Write failing tests: `mega prompt coach on` writes config; `mega prompt diet "please ..."` prints card; disabled diet → empty; threshold flag.
- [ ] Run — FAIL → Implement io-injected runCoach/runDiet, citty wiring → PASS → Commit `feat(cli): mega prompt coach+diet`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/cli` minor
- [ ] Wiki + `pnpm verify` + smoke: coach on → verbose prompt → card appears
- [ ] Commit + `code-reviewer`
