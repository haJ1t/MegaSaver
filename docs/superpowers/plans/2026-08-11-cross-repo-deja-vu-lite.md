# Cross-Repo Déjà Vu Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Honest teaser recall over the local cross-workspace corpus (BM25 + path-overlap), two-step open.

**Architecture:** Corpus joiner + BM25 search + teaser truncator, all pure except the joiner; one citty command with two modes.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, `@megasaver/retrieval`, `@megasaver/content-store`, `@megasaver/policy`.

## Global Constraints

- BM25 identical to `packages/retrieval/src/bm25.ts`; no embedding in v1.
- Teaser 200-char hard cut, redacted twice; no fix body in teaser.
- Two-step open: teaserId recomputed, not persisted.
- limit 5 default, 20 max; deterministic sort.
- Conventional commits ≤ 50 chars.

---

### Task 1: corpus joiner

**Files:** `apps/cli/src/deja-vu/corpus.ts` (new), `apps/cli/test/deja-vu/corpus.test.ts` (new)

- [ ] Write failing test: two workspaces, one failed chunk-set in wkB → corpus length 1 (plus approved memory fixture); malformed record → skipped not thrown.
- [ ] Run — FAIL → Implement fail-open Zod joins → PASS → Commit `feat(cli): deja-vu corpus joiner`

---

### Task 2: search + teaser

**Files:** `apps/cli/src/deja-vu/search.ts` (new), `apps/cli/test/deja-vu/search.test.ts` (new)

- [ ] Write failing test: deterministic ranking, pathOverlap tie-break, 200-cut, hash, redaction, --full recompute finds.
- [ ] Run — FAIL → Implement BM25 reuse + overlap + redact → PASS → Commit `feat(cli): deja-vu search`

---

### Task 3: `mega deja-vu` command

**Files:** `apps/cli/src/commands/deja-vu/index.ts` (new), `apps/cli/test/commands/deja-vu.test.ts` (new), `apps/cli/src/main.ts` (register)

- [ ] Write failing tests: teaser list excludes fix, --full shows fix, unknown teaser → exit1, empty store → empty list exit0, privacy probe secret not in teaser.
- [ ] Run — FAIL → Implement `runDejaVu` io-injected, citty args → PASS → Commit `feat(cli): mega deja-vu`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/cli` minor
- [ ] Wiki + `pnpm verify` + smoke: seed two wks → teaser hash → --full shows fix
- [ ] Commit `chore: changeset + wiki for deja-vu lite` → hand off to `code-reviewer`
