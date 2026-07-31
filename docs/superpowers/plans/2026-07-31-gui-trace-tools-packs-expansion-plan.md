# GUI Tool Router & Skill Packs Expansion — Implementation Plan (Phase 5)

- **Spec:** `docs/superpowers/specs/2026-07-31-gui-trace-tools-packs-expansion-design.md`
- **Goal:** Implement bridge routes and UI components for Tool Router and Skill Packs in `@megasaver/gui`.

---

## Task 1: Bridge Endpoints
- [ ] Create `apps/gui/bridge/routes/tools-packs.ts`.
- [ ] Register routes in `apps/gui/bridge/handler.ts`.
- [ ] Write Vitest test suite `apps/gui/test/bridge/tools-packs-route.test.ts`.

## Task 2: Frontend Components
- [ ] Build `ToolRouterCard.tsx` and `SkillPacksCard.tsx`.
- [ ] Add client API functions to `apps/gui/src/lib/claude-sessions-client.ts`.
- [ ] Embed components in `WorkspacePage`.

## Task 3: Verification
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @megasaver/gui test`
