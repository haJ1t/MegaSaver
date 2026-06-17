# Plan 3c — Per-Target Projection Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development per task. Steps use checkbox (`- [ ]`).

**Goal:** Add a fail-closed `projectionPreflight` that validates the final rendered connector output before the atomic write, wire it into `mega connector sync` (per-target abort, store never corrupted), and lock per-target projection conformance with a unified matrix test across all 7 targets.

**Architecture:** A new pure validator `projectionPreflight(content, opts)` in `@megasaver/connectors-shared` reuses the existing `parseBlock` (managed-block balance) and the CG sentinels (CONTEXT_GATE balance), plus a frontmatter-survival check for header targets (Cursor). `sync.ts` calls it after `upsertBlock` and before `writeTargetFile`; a violation throws `ConnectorError("projection_invalid")`, caught by the existing per-target try/catch so only that target's write aborts. Implements spec §11 (projection validation matrix) + §14 (projection preflight failure aborts the connector write).

**Tech Stack:** TypeScript strict ESM, Vitest, Zod, Citty. Reuses `parseBlock`, `MEGA_SAVER_CG_BLOCK_{START,END}`, `ConnectorError`.

---

## Spec coverage
- §11 matrix (parse sentinel before/after; preserve outside text; Cursor frontmatter) → Tasks 2 (preflight) + 4 (matrix test).
- §11 "A projection failure aborts only that connector write; it does not corrupt the store" → Task 3 (per-target isolation, already present; test it).
- §14 "projection preflight failure: connector write aborts" → Tasks 1+3.

## File structure
- `packages/connectors/shared/src/errors.ts` — add `projection_invalid` to the code enum.
- `packages/connectors/shared/src/preflight.ts` (NEW) — `projectionPreflight`.
- `packages/connectors/shared/src/index.ts` — export `projectionPreflight`.
- `packages/connectors/shared/test/preflight.test.ts` (NEW) — unit tests.
- `apps/cli/src/errors.ts` — add `projection_invalid` CLI message case.
- `apps/cli/src/commands/connector/sync.ts` — call preflight before both `writeTargetFile` sites.
- `apps/cli/test/connector-conformance-matrix.test.ts` (NEW) — 7-target matrix + isolation test.

---

### Task 1: Add the `projection_invalid` error code

**Files:** Modify `packages/connectors/shared/src/errors.ts`; Modify `apps/cli/src/errors.ts`.

- [ ] **Step 1:** Add `"projection_invalid"` to `connectorErrorCodeSchema = z.enum([...])` in `packages/connectors/shared/src/errors.ts`.
- [ ] **Step 2:** In `apps/cli/src/errors.ts` connector switch add:
```ts
case "projection_invalid":
  return {
    message: `error: connector projection invalid for ${ctx.relativePath}: ${err.message}`,
    exitCode: 1,
  };
```
- [ ] **Step 3:** `pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/cli typecheck` — Expected: clean (exhaustive switch now covers the new code).
- [ ] **Step 4:** Commit `chore(connectors): add projection_invalid error code`.

### Task 2: `projectionPreflight` validator (TDD)

**Files:** Create `packages/connectors/shared/src/preflight.ts`; Create `packages/connectors/shared/test/preflight.test.ts`; Modify `index.ts`.

Contract — `projectionPreflight(content: string, opts?: { expectHeader?: boolean }): void`:
1. `parseBlock(content)` must not throw AND must return `block !== null` (exactly one balanced managed block present). Else throw `ConnectorError("projection_invalid", ...)`.
2. `parseBlock(content, { start: MEGA_SAVER_CG_BLOCK_START, end: MEGA_SAVER_CG_BLOCK_END })` must not throw (0 or 1 balanced CG block). A `block_conflict` throw is rewrapped as `projection_invalid`.
3. If `opts.expectHeader`, the managed block must not be the first content: `parseBlock(content).before.trim() !== ""` (frontmatter survived outside the block). Else throw `projection_invalid`.

- [ ] **Step 1 (RED):** Write `preflight.test.ts`: a valid `upsertBlock` output passes; content with no managed block throws `projection_invalid`; content with two begin sentinels throws `projection_invalid`; content with an unbalanced CG block throws `projection_invalid`; `expectHeader:true` with the block at the top throws; `expectHeader:true` with header text before the block passes. Run: `pnpm --filter @megasaver/connectors-shared test -- preflight` → FAIL (module missing).
- [ ] **Step 2 (GREEN):** Implement `preflight.ts` per the contract (reuse `parseBlock`, rewrap `block_conflict`→`projection_invalid`). Export from `index.ts`.
- [ ] **Step 3:** `pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/connectors-shared test -- preflight` → PASS.
- [ ] **Step 4:** Commit `feat(connectors): add projectionPreflight validator`.

### Task 3: Wire preflight into `connector sync` (TDD)

**Files:** Modify `apps/cli/src/commands/connector/sync.ts`; test in `apps/cli/test/connector-conformance-matrix.test.ts` (Task 4 file; isolation case here).

- [ ] **Step 1 (RED):** In the matrix test file add: given a target file pre-corrupted with a duplicate `MEGA SAVER:BEGIN` sentinel, `runConnectorSync` emits status `error` for THAT target, status `noop/wrote` for the others, the corrupted file is left UNCHANGED on disk, and exit code is 1. Run → FAIL (today the corrupt file would already throw `block_conflict` in `upsertBlock`; assert specifically that healthy targets still write and the store/other files are intact — confirm the negative is observable). 
- [ ] **Step 2 (GREEN):** In `sync.ts` import `projectionPreflight`; after computing `newContent` in the seed branch (before `writeTargetFile` ~line 108) and the update branch (before `writeTargetFile` ~line 118), call:
```ts
projectionPreflight(newContent, { expectHeader: "header" in target && Boolean(target.header) });
```
The existing per-target `catch` maps `projection_invalid` to an `error` status + stderr and continues.
- [ ] **Step 3:** `pnpm --filter @megasaver/cli build && pnpm --filter @megasaver/cli test -- connector-conformance-matrix` → PASS.
- [ ] **Step 4:** Commit `feat(cli): preflight connector projection before write`.

### Task 4: Conformance matrix across all 7 targets (TDD)

**Files:** `apps/cli/test/connector-conformance-matrix.test.ts`.

- [ ] **Step 1 (RED→GREEN, characterization):** Parametrize over `KNOWN_TARGETS` (claude-code, codex, cursor, aider, gemini, windsurf, continue). For each: seed (sync with `--target <id>`), then assert the written file (a) passes `projectionPreflight` with the right `expectHeader`, (b) `parseBlock(content).block !== null`, (c) a second sync is `noop` (idempotent), (d) for `cursor`, `parseBlock(content).before` contains `description:` (frontmatter preserved outside the block). Reuse the existing test store/registry fixtures from `apps/cli/test/connector.test.ts`.
- [ ] **Step 2:** Run: `pnpm --filter @megasaver/cli test -- connector-conformance-matrix` → PASS (locks the matrix; pins §11 as a regression guard).
- [ ] **Step 3:** Commit `test(cli): connector projection conformance matrix`.

### Task 5: Changeset + verify

- [ ] **Step 1:** `.changeset/projection-conformance-3c.md` — `@megasaver/connectors-shared` minor (new `projectionPreflight` export), `@megasaver/cli` patch (sync preflight wiring).
- [ ] **Step 2:** `pnpm verify` → exit 0.
- [ ] **Step 3:** Commit the changeset.

## Self-review notes
- Preflight is agent-agnostic: lives in `connectors-shared`, takes `{ expectHeader }` not `ConnectorTarget` (no dependency on `generic-cli`). Core untouched (§ agent-agnostic core).
- Header check is edit-tolerant (only asserts `before` is non-empty when a header is expected; does NOT assert exact frontmatter, honoring the user-editable-frontmatter contract).
- Preflight is defense-in-depth: `upsertBlock` is deterministic and already correct, so preflight guards against a future renderer/merge regression silently corrupting a user's config file — fail-closed before the write.
