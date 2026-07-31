# GUI Tool Router & Skill Packs Expansion — Design Spec (Phase 5)

- **Date:** 2026-07-31
- **Status:** proposed
- **Risk:** MEDIUM (Bridge endpoints + Tool Router + Skill Packs). Worktree, TDD, `code-reviewer` pass, `pnpm verify` DoD.
- **Goal:** Expose Tool Router controls (`mega tools allow / block / status`) and Skill Packs management (`mega pack install / list`) in `@megasaver/gui`.

---

## 1. Architecture & Bridge Routes (`apps/gui/bridge/routes/tools-packs.ts`)

1. **`GET /api/tools/router` & `POST /api/tools/router`**
   - Retrieves and updates tool router allow/block lists for the workspace.
2. **`GET /api/packs/installed` & `POST /api/packs/install`**
   - Lists installed skill packs and allows installing new packs (`@megasaver/skill-packs`).

---

## 2. UI Components (`apps/gui/src/components/`)

1. **`ToolRouterCard`**: Allows toggling tool permissions and inspecting blocked tool schemas.
2. **`SkillPacksCard`**: Displays active skill packs and provides a 1-click installer.

---

## 3. Testing & Verification

- Vitest tests in `apps/gui/test/bridge/tools-packs-route.test.ts`.
- `pnpm typecheck` and `pnpm --filter @megasaver/gui test`.
