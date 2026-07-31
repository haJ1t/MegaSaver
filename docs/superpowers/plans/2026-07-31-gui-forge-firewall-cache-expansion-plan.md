# GUI FORGE, Firewall & Cache Doctor Expansion — Implementation Plan (Phase 4)

- **Spec:** `docs/superpowers/specs/2026-07-31-gui-forge-firewall-cache-expansion-design.md`
- **Goal:** Implement bridge routes and UI components for FORGE, Firewall, and Cache Doctor in `@megasaver/gui`.

---

## Task 1: Bridge Endpoints
- [ ] Create `apps/gui/bridge/routes/forge.ts` and `apps/gui/bridge/routes/cache.ts`.
- [ ] Register routes in `apps/gui/bridge/handler.ts`.
- [ ] Write Vitest test suite `apps/gui/test/bridge/forge-cache-route.test.ts`.

## Task 2: Frontend Components
- [ ] Build `ForgeLearningCard.tsx` and `CacheDoctorCard.tsx`.
- [ ] Add client API functions to `apps/gui/src/lib/claude-sessions-client.ts`.
- [ ] Embed components in `WorkspacePage` / `TokenSaverPage`.

## Task 3: Verification
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @megasaver/gui test`
