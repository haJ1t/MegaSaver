# GUI Living Brain Expansion — Design Spec (Phase 1)

- **Date:** 2026-07-31
- **Status:** proposed
- **Risk:** MEDIUM (GUI bridge routes + React components + memory lineage wiring). Worktree, TDD, `code-reviewer` pass, `pnpm verify` DoD.
- **Goal:** Expose core Living Brain capabilities (Lineage/History, Reopen, Explain, Brain Export/Import, BYO S3 Sync) in `@megasaver/gui` while preserving existing UI aesthetics and WCAG AA contrast standards.

---

## 1. Problem

The CLI supports advanced Living Brain features (`mega memory history`, `mega memory reopen`, `mega memory explain`, `mega brain export/import/sync`), but the GUI's `MemoryPanel` is currently limited to basic CRUD (Create, List, Search, Approve, Reject, Delete) and `MemoryGraphPanel`.

Users cannot inspect decision lineage, reopen closed/superseded decisions, understand memory ranking weights via "Explain", or trigger Brain Export/Import/Sync from the web interface.

---

## 2. Architecture & Bridge Routes

### 2.1 New Bridge Routes (`apps/gui/bridge/routes/`)

1. **`GET /api/claude-sessions/:dir/:id/memory/:entryId/history`**
   - Calls `buildLineage` from `@megasaver/core` for the given `entryId`.
   - Returns JSON: `{ entryId, chain: MemoryEntry[], supersedesId?, validFrom?, validTo? }`.

2. **`POST /api/claude-sessions/:dir/:id/memory/:entryId/reopen`**
   - Calls `updateMemoryEntry` to reset `validTo` to `null`.
   - Returns updated entry.

3. **`GET /api/claude-sessions/:dir/:id/memory/:entryId/explain`**
   - Computes ranking factors (`effectiveConfidence`, BM25 weight, `lastActiveAt`, `supersedesId` status).
   - Returns JSON explanation breakdown.

4. **`POST /api/brain/export` & `POST /api/brain/import`**
   - Exposes `exportBrain` and `importBrain` from `@megasaver/core`.
   - Handles `.megabrain` bundle JSON payloads.

5. **`GET /api/brain/sync/status` & `POST /api/brain/sync/trigger`**
   - Wraps `@megasaver/brain-sync` engine to check S3 sync status and trigger E2E encrypted sync.

---

## 3. UI Component Enhancements (`apps/gui/src/`)

### 3.1 `MemoryPanel` Action Toolbar Updates
Each memory card in `MemoryPanel` receives three new actions:
- **"History"** button: Opens `MemoryHistoryDrawer` showing the version tree and `changedFrom` lineage.
- **"Explain"** button: Opens `MemoryExplainPopover` showing ranking score and decay metrics.
- **"Reopen"** button: Displayed if `validTo != null` (closed/superseded memory), allowing instant undo/re-activation.

### 3.2 `BrainSyncCard` Component
A new card in the `Memory` page header providing:
- **Export Brain**: One-click download of `.megabrain` knowledge bundle.
- **Import Brain**: File drop zone for merging external `.megabrain` bundles.
- **S3 Sync Status**: Badge showing "In Sync", "Pending", or "Not Configured", with a "Sync Now" button.

---

## 4. Testing & Verification

- **Bridge Route Unit Tests**: Tests in `apps/gui/bridge/test/` for all 5 new routes.
- **React Component Tests**: Testing Library tests in `apps/gui/src/components/` for `MemoryHistoryDrawer`, `MemoryExplainPopover`, and `BrainSyncCard`.
- **DoD Verification**: `pnpm verify` clean.
