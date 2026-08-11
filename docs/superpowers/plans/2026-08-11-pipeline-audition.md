# Pipeline Audition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Sandboxed three-fixture audition with honest byte counters, no real-store mutation, no network.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, node:fs, node:child_process execFile, `@megasaver/context-gate`, `@megasaver/output-filter`.

## Global Constraints

- Sandbox store only; real store count unchanged after audition.
- Honest metrics: bytes + estimated tokens, no dollar claim; fixed disclaimer line.
- Fixtures baked-in, execFile + 10s timeout, argv only.
- Conventional commits ≤ 50 chars.

---

### Task 1: report model (pure)

**Files:** `apps/cli/src/audition/report.ts` (new), `apps/cli/test/audition/report.test.ts` (new)

- [ ] Write failing test: schema strict, three rows → counters + savingsRatio, render contains disclaimer line, --json round-trip.
- [ ] Run — FAIL → Implement schema + builder + renderer → PASS → Commit `feat(cli): audition report model`

---

### Task 2: fixture runner (sandboxed)

**Files:** `apps/cli/src/audition/run.ts` (new), `apps/cli/fixtures/audition/{read,grep,build}/` (new), `apps/cli/test/audition/run.test.ts` (new)

- [ ] Write failing test: runAllAuditions on temp sandbox returns 3 rows with delivered < raw on non-trivial fixture; real store count unchanged; timeout → delivered==raw.
- [ ] Run — FAIL → Implement execFile loops, runOutputPipeline join, sandbox mkdtemp, cleanup → PASS → Commit `feat(cli): audition runner`

---

### Task 3: `mega audition` command

**Files:** `apps/cli/src/commands/audition/index.ts` (new), `apps/cli/test/commands/audition.test.ts` (new), `apps/cli/src/main.ts` + `bin` wiring (register)

- [ ] Write failing tests: `runAudition` writes audition.json to sandbox, --keep leaves dir, --json shape, text contains three fixture names, exit 0 <30s (generous deadline).
- [ ] Run — FAIL → Implement io-injected runner, citty args → PASS → Commit `feat(cli): mega audition`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/cli` minor (LOW)
- [ ] Wiki + `pnpm verify` + smoke: `mega audition --keep` leaves report with 3 rows
- [ ] Commit + `code-reviewer`
