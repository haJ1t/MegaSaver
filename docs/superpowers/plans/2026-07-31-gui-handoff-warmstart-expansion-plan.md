# GUI Hot Handoff & Warm Start Expansion — Implementation Plan (Phase 2)

- **Spec:** `docs/superpowers/specs/2026-07-31-gui-handoff-warmstart-expansion-design.md`
- **Goal:** Implement bridge routes and UI components for Hot Handoff and Warm Start in `@megasaver/gui`.

---

## Task 1: Bridge Endpoints (Backend)
- [ ] Create `apps/gui/bridge/routes/handoff.ts` handling pack, open, inspect, clear.
- [ ] Create `apps/gui/bridge/routes/warmup.ts` handling session warmup brief fetching.
- [ ] Register new routes in `apps/gui/bridge/handler.ts`.
- [ ] Write Vitest unit tests in `apps/gui/test/bridge/handoff-route.test.ts`.

## Task 2: Frontend Components (React)
- [ ] Build `HandoffCard.tsx` component in `apps/gui/src/components/`.
- [ ] Build `WarmStartPanel.tsx` component in `apps/gui/src/components/`.
- [ ] Integrate components into `WorkspacePage` and `SessionsPage`.
- [ ] Write React Testing Library unit tests in `apps/gui/test/components/handoff-card.test.tsx`.

## Task 3: Verification & DoD
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm verify`.
