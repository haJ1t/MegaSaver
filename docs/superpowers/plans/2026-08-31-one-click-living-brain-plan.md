# One-Click Automatic Living Brain Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable 1-Click Automatic Living Brain Activation directly from the GUI without requiring any terminal commands, manual configuration, or cloud setup.

**Architecture:** A new `POST /api/brain/sync/auto-init` endpoint handles key generation, local configuration, and project scaffolding. The `BrainSyncCard` frontend presents a prominent 1-click activation button that flips the status immediately to active with full push/pull capabilities.

**Tech Stack:** TypeScript, React, Vite, Node HTTP, `@megasaver/brain-sync`, `@megasaver/core`, Vitest.

---

### Task 1: Backend Endpoint `POST /api/brain/sync/auto-init` & Status Routing

**Files:**
- Modify: `apps/gui/bridge/routes/brain-sync.ts`
- Modify: `apps/gui/bridge/handler.ts`
- Test: `apps/gui/test/bridge/claude-session-memory-living-brain-route.test.ts`

- [x] **Step 1: Write failing test in `claude-session-memory-living-brain-route.test.ts`**
Add a test that calls `POST /api/brain/sync/auto-init?workspaceKey=...` on an unconfigured store, asserting 200 OK with `{ ok: true, status: "ok", generation: 1, recoveryCode: expect.any(String), configured: true }`, followed by `GET /api/brain/sync/status` returning `status: "ok"` or `"empty"`.

- [x] **Step 2: Run test to verify failure**
Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/claude-session-memory-living-brain-route.test.ts`
Expected: FAIL (404 or method not allowed)

- [x] **Step 3: Implement `handlePostBrainSyncAutoInit` in `brain-sync.ts` and dispatch in `handler.ts`**
Implement auto-init logic that creates `brain-sync.key` via `generateKey()` and `saveKeyfile()`, creates `brain-sync.json` with local config via `saveConfig()`, ensures project exists in `ctx.registry`, and returns recovery code.

- [x] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/claude-session-memory-living-brain-route.test.ts`
Expected: PASS

- [x] **Step 5: Typecheck and lint**
Run: `pnpm --filter @megasaver/gui typecheck`

---

### Task 2: Frontend 1-Click Activation in `BrainSyncCard`

**Files:**
- Modify: `apps/gui/src/lib/claude-sessions-client.ts`
- Modify: `apps/gui/src/components/brain-sync-card.tsx`
- Test: `apps/gui/test/components/brain-sync-card.test.tsx`

- [x] **Step 1: Write failing test in `brain-sync-card.test.tsx`**
Add test for clicking `Activate Living Brain (1-Click)` button in `not_configured` state, asserting `autoInitBrainSync` is called and status updates to configured/active.

- [x] **Step 2: Run test to verify failure**
Run: `pnpm --filter @megasaver/gui exec vitest run test/components/brain-sync-card.test.tsx`
Expected: FAIL

- [x] **Step 3: Implement `autoInitBrainSync` in client and update `BrainSyncCard` UI**
Add `autoInitBrainSync` in `claude-sessions-client.ts` and wire the primary 1-click button with loading spinner and recovery code copy helper.

- [x] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @megasaver/gui exec vitest run test/components/brain-sync-card.test.tsx`
Expected: PASS

---

### Task 3: Build & Verification

**Files:**
- Bundle: `apps/gui/dist-bridge/`
- Bundle: `apps/cli/dist-bundle/`

- [x] **Step 1: Run full verification suite**
Run: `pnpm verify`

- [x] **Step 2: Build GUI and CLI bundles**
Run: `pnpm build && pnpm --filter @megasaver/cli run bundle && node apps/cli/scripts/copy-gui-dist.mjs`

- [x] **Step 3: End-to-End Live Verification**
Test `mega gui` live to confirm 1-click activation button and status update.
