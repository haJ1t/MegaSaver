# Token Hotspot Heatmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Ranked hotspot list (CLI + GUI) from indexer + chunk sizes + inspector counters.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, citty, React, `@megasaver/indexer`, `@megasaver/content-store`, `@megasaver/output-filter`.

## Global Constraints

- Deterministic rank: score desc → tokens desc → path lex.
- No file contents read for scoring.
- Bars only, no canvas/treemap library.
- Conventional commits ≤ 50 chars.

---

### Task 1: pure computeHotspots

**Files:** `apps/cli/src/hotspots/compute.ts` (new), `apps/cli/test/hotspots/compute.test.ts` (new)

- [ ] Write failing test: large evicted file outranks small kept file; tie-break lex; 100-row trim.
- [ ] Run — FAIL → Implement score formula + sort → PASS → Commit `feat(cli): hotspot scorer`

---

### Task 2: `mega hotspots` CLI

**Files:** `apps/cli/src/commands/hotspots/index.ts` (new), `apps/cli/test/commands/hotspots.test.ts` (new), `apps/cli/src/main.ts` (register)

- [ ] Write failing tests: no index → exit1; with index → top N matches largest file; --json shape.
- [ ] Run — FAIL → Implement io-injected runHotspots → PASS → Commit `feat(cli): mega hotspots`

---

### Task 3: GUI panel + API

**Files:** `apps/gui/bridge/hotspots.ts` (new), `apps/gui/src/routes/hotspots.tsx` (new), `apps/gui/test/hotspots.test.ts` (new)

- [ ] Write failing test: API returns same shape as CLI, empty when no index; panel renders bars, sort toggle.
- [ ] Run — FAIL → Implement bridge + React → PASS → Commit `feat(gui): hotspot panel`

---

### Task 4: changeset, wiki, verify

- [ ] Changeset `@megasaver/cli` minor, `@megasaver/gui` minor
- [ ] Wiki + `pnpm verify` + smoke → Commit + `code-reviewer`
