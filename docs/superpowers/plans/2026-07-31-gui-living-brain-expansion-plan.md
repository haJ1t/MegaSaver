# GUI Living Brain Expansion — Implementation Plan (Phase 1)

- **Spec:** `docs/superpowers/specs/2026-07-31-gui-living-brain-expansion-design.md`
- **Goal:** Implement bridge routes and frontend components for Living Brain (History, Reopen, Explain, Brain Sync) in `@megasaver/gui`.

---

## Task 1: Bridge Endpoints (Backend)
- [ ] Create `apps/gui/bridge/routes/brain-sync.ts` handling export, import, and sync status/trigger.
- [ ] Add `history`, `reopen`, and `explain` handlers in `apps/gui/bridge/routes/claude-session-memory.ts`.
- [ ] Register new routes in `apps/gui/bridge/handler.ts`.
- [ ] Write Vitest unit tests in `apps/gui/bridge/test/claude-session-memory-living-brain.test.ts`.

## Task 2: Frontend Components (React)
- [ ] Build `BrainSyncCard.tsx` component in `apps/gui/src/components/`.
- [ ] Build `MemoryHistoryDrawer.tsx` and `MemoryExplainPopover.tsx`.
- [ ] Integrate components into `MemoryPanel.tsx` in `apps/gui/src/components/memory-panel.tsx`.
- [ ] Write React Testing Library tests in `apps/gui/src/components/memory-panel.test.tsx`.

## Task 3: Verification & DoD
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm verify`.
