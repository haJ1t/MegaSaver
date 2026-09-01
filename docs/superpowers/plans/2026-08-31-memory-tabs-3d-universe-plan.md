# Memory Page 3-Tab Architecture & 3D Universe System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Memory view into 3 full-width tabs (Living Brain, 3D Universal Memory Graph, Decision Trace) and implement a WebGL Three.js 3D Universe visualization.

**Architecture:** A top tab navigator in `MemoryPage` routes between `LivingBrainTab`, `MemoryUniverseTab`, and `DecisionTraceTab`. `MemoryUniverseTab` renders an interactive Three.js 3D cosmos of memory nodes orbiting the workspace core with constellation links, HUD search/filter, and a glassmorphism inspector.

**Tech Stack:** React 18, TypeScript, Three.js, Tailwind CSS, Vitest.

---

### Task 1: Add `three` & `@types/three` and build `MemoryUniverse3D` Canvas Engine

**Files:**
- Modify: `apps/gui/package.json`
- Create: `apps/gui/src/views/cockpit/memory-universe-3d.tsx`
- Test: `apps/gui/test/components/memory-universe-3d.test.tsx`

- [x] **Step 1: Install `three` and `@types/three`**
Run: `pnpm --filter @megasaver/gui add three && pnpm --filter @megasaver/gui add -D @types/three`

- [x] **Step 2: Write unit test for `MemoryUniverse3D`**
Test rendering, node positioning, HUD category filter toggles, search filter, and inspector display.

- [x] **Step 3: Implement `MemoryUniverse3D` component**
Implement Three.js WebGL canvas with:
- Stardust particle field
- Central glowing workspace anchor pulsar
- 3D sphere node mesh clusters colored by kind (`decision`, `architecture`, `bug`, `wiki`, `evidence`, `file`, `symbol`)
- Constellation glowing line edges
- OrbitControls + mouse raycasting for hover tooltip & click-to-focus
- Floating HUD (search, layer toggles, camera reset)
- Glassmorphism slide-over inspector card

- [x] **Step 4: Run tests to verify**
Run: `pnpm --filter @megasaver/gui exec vitest run test/components/memory-universe-3d.test.tsx`
Expected: PASS

---

### Task 2: Build Dedicated Tabs (`LivingBrainTab`, `MemoryUniverseTab`, `DecisionTraceTab`)

**Files:**
- Create: `apps/gui/src/views/cockpit/living-brain-tab.tsx`
- Create: `apps/gui/src/views/cockpit/memory-universe-tab.tsx`
- Create: `apps/gui/src/views/cockpit/decision-trace-tab.tsx`
- Test: `apps/gui/test/components/memory-tabs.test.tsx`

- [x] **Step 1: Write test for tab components**
Test that `LivingBrainTab`, `MemoryUniverseTab`, and `DecisionTraceTab` render their respective full-width tools.

- [x] **Step 2: Implement `LivingBrainTab`**
Contains `BrainSyncCard` on the left and full-width searchable/filterable Memory notes list with CRUD, create modal, and lineage explain modal.

- [x] **Step 3: Implement `MemoryUniverseTab`**
Wraps `MemoryUniverse3D` with data fetching and error states.

- [x] **Step 4: Implement `DecisionTraceTab`**
Wraps `DecisionTracePanel` with full-width canvas and session switcher.

- [x] **Step 5: Run tests to verify**
Run: `pnpm --filter @megasaver/gui exec vitest run test/components/memory-tabs.test.tsx`
Expected: PASS

---

### Task 3: Redesign `MemoryPage` with 3-Tab Header & URL State Sync

**Files:**
- Modify: `apps/gui/src/views/memory-page.tsx`
- Test: `apps/gui/test/views/memory-page.test.tsx`

- [x] **Step 1: Write test for `MemoryPage` 3-tab navigation**
Verify clicking `Living Brain`, `Memory Graph`, and `Decision Trace` switches active tab view.

- [x] **Step 2: Update `MemoryPage` implementation**
Add top sub-nav bar with tabs:
- `⚡ Living Brain`
- `🪐 Memory Graph (3D)`
- `🌿 Decision Trace`
Render corresponding active tab component full-width.

- [x] **Step 3: Run test to verify**
Run: `pnpm --filter @megasaver/gui exec vitest run test/views/memory-page.test.tsx`
Expected: PASS

---

### Task 4: Full Verification & Bundle Build

- [x] **Step 1: Run `pnpm verify`**
Run: `pnpm verify`

- [x] **Step 2: Build GUI and CLI bundles**
Run: `pnpm build && pnpm --filter @megasaver/cli run bundle && node apps/cli/scripts/copy-gui-dist.mjs`

- [x] **Step 3: Live E2E smoke verification**
Launch `mega gui` and test all 3 tabs and the 3D Universe canvas live.
