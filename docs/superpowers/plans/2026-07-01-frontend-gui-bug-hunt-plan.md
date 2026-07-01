# Frontend GUI Bug Hunt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stale-response race conditions in `apps/gui` data-fetching React components and add regression tests for each.

**Architecture:** Replace unguarded async handlers/effects with a per-request ID counter (or `live` flag + request ID). Ignore responses whose ID no longer matches the latest initiated request. Use `refreshNonce` to re-trigger effects on retry.

**Tech Stack:** React 18, TypeScript strict, Vitest, Testing Library, Biome.

---

## Task 1: Fix `WorkspaceSessionList` polling race

**Files:**
- Modify: `apps/gui/src/views/workspace-session-list.tsx`
- Test: `apps/gui/test/components/workspace-session-list.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Render `WorkspaceSessionList`, let the first poll start, advance the interval to start a second poll, resolve the second poll, then resolve the first poll, and assert the list keeps the second poll's data.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @megasaver/gui test -- --run workspace-session-list
```

Expected: FAIL — stale first-poll response overwrites newer state.

- [ ] **Step 3: Add the guard in the polling effect**

Use a `requestId` counter incremented on each poll tick. In `.then`/`.catch`, return early if `requestId !== latest` or component unmounted (`live === false`). Update `nowMs` only for the latest tick.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/gui test -- --run workspace-session-list
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/workspace-session-list.tsx apps/gui/test/components/workspace-session-list.test.tsx
git commit -m "fix(gui): ignore stale session-list poll responses"
```

---

## Task 2: Fix `MemoryPanel` effect race

**Files:**
- Modify: `apps/gui/src/views/cockpit/memory-panel.tsx`
- Test: `apps/gui/test/views/session-overlay-panels.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Render `<MemoryPanel dir="dir1" id="id1" />`, wait for the first fetch, re-render with `dir2/id2`, wait for the second fetch, resolve the second fetch with a new row, then resolve the first fetch with an old row, and assert the old row is not displayed.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @megasaver/gui test -- --run session-overlay-panels
```

Expected: FAIL.

- [ ] **Step 3: Replace the unguarded `load` callback with a guarded effect**

Use `useEffect` with `live` flag and `refreshNonce`. On dependency change or retry, reset to loading and fetch; ignore results if `live` is false. Remove the standalone `load` callback.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/gui test -- --run session-overlay-panels
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/cockpit/memory-panel.tsx apps/gui/test/views/session-overlay-panels.test.tsx
git commit -m "fix(gui): ignore stale memory-panel load results"
```

---

## Task 3: Fix `TasksPanel` effect race

**Files:**
- Modify: `apps/gui/src/views/cockpit/tasks-panel.tsx`
- Test: `apps/gui/test/views/session-overlay-panels.test.tsx`

- [ ] **Step 1–4:** Same pattern as Task 2, applied to `TasksPanel`.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/cockpit/tasks-panel.tsx apps/gui/test/views/session-overlay-panels.test.tsx
git commit -m "fix(gui): ignore stale tasks-panel load results"
```

---

## Task 4: Fix `WorkspaceSessionList` retry race

**Files:**
- Modify: `apps/gui/src/views/workspace-session-list.tsx`

- [ ] **Step 1: Write the failing regression test**

Trigger `ErrorState onRetry`, start a new poll, then resolve an older pending poll (if any), and assert the list uses the retry poll's data.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @megasaver/gui test -- --run workspace-session-list
```

Expected: FAIL if retry re-uses the old unguarded path.

- [ ] **Step 3: Wire `onRetry` to `refreshNonce` instead of a direct re-fetch**

`retryList` increments `refreshNonce`, which re-triggers the guarded polling effect.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/gui test -- --run workspace-session-list
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/workspace-session-list.tsx
git commit -m "fix(gui): guard retry path against stale poll responses"
```

---

## Task 5: Fix `TokenSaverPanel` polling race

**Files:**
- Modify: `apps/gui/src/views/cockpit/token-saver-panel.tsx`
- Test: `apps/gui/test/components/token-saver-panel.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Render `TokenSaverPanel`, let the initial poll start, advance the interval to start a second poll, resolve the second poll with updated stats, then resolve the first poll with old stats, and assert the hero metric shows the newer saved-token count.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @megasaver/gui test -- --run token-saver-panel
```

Expected: FAIL.

- [ ] **Step 3: Replace unguarded `useCallback` polling with a guarded effect**

Use a `tick` function with a per-tick `requestId`. Ignore responses whose ID does not match the latest. Support `refreshNonce` for retry.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/gui test -- --run token-saver-panel
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/cockpit/token-saver-panel.tsx apps/gui/test/components/token-saver-panel.test.tsx
git commit -m "fix(gui): ignore stale token-saver poll responses"
```

---

## Task 6: Fix `WorkspaceContextPanel` submit race

**Files:**
- Modify: `apps/gui/src/views/cockpit/workspace-context-panel.tsx`
- Test: `apps/gui/test/components/workspace-context-panel.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Render `WorkspaceContextPanel`, submit a first task, wait for the request to start, submit a second task, resolve the second request with a one-block pack, then resolve the first request with a two-block pack, and assert the UI still shows the one-block result.

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @megasaver/gui test -- --run workspace-context-panel
```

Expected: FAIL.

- [ ] **Step 3: Add a request-ID guard in the submit handler**

Use `useRef` to hold a monotonically increasing request ID. Increment on each submit and ignore results/errors whose ID does not match the latest.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @megasaver/gui test -- --run workspace-context-panel
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/views/cockpit/workspace-context-panel.tsx apps/gui/test/components/workspace-context-panel.test.tsx
git commit -m "fix(gui): ignore stale workspace-context submit responses"
```

---

## Task 7: Final verification

- [ ] Run the full GUI test suite:

```bash
pnpm --filter @megasaver/gui test
```

- [ ] Run the full monorepo verify gate:

```bash
pnpm verify
```

- [ ] Runtime smoke: start the GUI bridge and confirm `/api/health` returns `{"ok":true}`.

- [ ] External code review pass (`code-reviewer` or `critic` agent).

---

## Spec coverage check

- Static UI audit → Tasks 1–6 race-condition fixes.
- Runtime smoke test → Task 7.
- TDD discipline → every task includes a failing regression test before the code change.
- Verification → Task 7.
