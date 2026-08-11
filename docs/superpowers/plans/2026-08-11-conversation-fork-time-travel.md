# Conversation Fork & Time-Travel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Snapshot a fork point (preflight + capsule + intent) and resume it via the existing pending resume capsule seam.

**Architecture:** Pure fork model in `apps/cli/src/fork/model.ts` + content-store skip for fork files + five citty commands; resume reuses `writeResumeCapsule`.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, `@megasaver/content-store`, `@megasaver/policy`.

## Global Constraints

- No new seams: fork resume writes the existing `resume-capsule.json` path, refused if occupied.
- Reserved sibling: fork files ignored by chunk listers/pruner.
- Deterministic, redacted, bounded (<2000 tok), never raw transcript.
- Conventional commits ≤ 50 chars.

---

### Task 1: content-store fork sibling skip

**Files:** `packages/content-store/src/store.ts`, `index.ts`, `test/fork-skip.test.ts`

- [ ] Write failing test: fork file present → `listOverlayChunkSets` still returns only chunk sets; `FORK_FILENAME_RE` matches.
- [ ] Run — FAIL → Implement regex + skip in listers/pruner → PASS → Commit `feat(content-store): fork sibling skip`

---

### Task 2: pure fork model

**Files:** `apps/cli/src/fork/model.ts` (new), `apps/cli/test/fork/model.test.ts` (new)

- [ ] Write failing test: build → hash stable, render bounded, diff shows added file, pending refusal.
- [ ] Run — FAIL → Implement `forkPointSchema`, `buildForkPoint`, `renderForkCapsule`, `diffForkPoints` → PASS → Commit `feat(cli): fork model`

---

### Task 3: `mega fork` commands

**Files:** `apps/cli/src/commands/fork/{snapshot,list,show,diff,resume,index}.ts` (new), `apps/cli/test/commands/fork.test.ts` (new), `apps/cli/src/main.ts` (register)

- [ ] Write failing tests: snapshot writes fork + preflight; list sorted; show parses; diff shows file; resume writes capsule; resume refuses when capsule pending; unknown id → exit1.
- [ ] Run — FAIL → Implement io-injected runners, citty wiring → PASS → Commit `feat(cli): mega fork`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/content-store` minor, `@megasaver/cli` minor (HIGH)
- [ ] Wiki + `pnpm verify` + smoke: fork snapshot → resume → next prompt carries fork
- [ ] Commit + `code-reviewer` AND `critic`
