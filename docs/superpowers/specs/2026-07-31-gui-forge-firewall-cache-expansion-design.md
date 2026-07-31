# GUI FORGE, Firewall & Cache Doctor Expansion — Design Spec (Phase 4)

- **Date:** 2026-07-31
- **Status:** proposed
- **Risk:** MEDIUM (Bridge endpoints + FORGE failure learning + Mistake Firewall + Cache Doctor). Worktree, TDD, `code-reviewer` pass, `pnpm verify` DoD.
- **Goal:** Expose Failed-Run Learning (FORGE: `mega learn / mega fail`), Mistake Firewall status (`mega firewall`), and Prompt Cache Doctor (`mega cache doctor / clear`) in `@megasaver/gui`.

---

## 1. Architecture & Bridge Routes (`apps/gui/bridge/routes/forge.ts` & `cache.ts`)

1. **`GET /api/forge/failures` & `POST /api/forge/learn`**
   - Retrieves recent agent execution failures and converts a failure to a project rule (`FORGE`).
2. **`GET /api/firewall/status`**
   - Exposes Mistake Firewall rules and active status.
3. **`GET /api/cache/status` & `POST /api/cache/clear`**
   - Diagnoses prompt caching churn (Claude Code base URL cache tax) and clears cache state.

---

## 2. UI Components (`apps/gui/src/components/`)

1. **`ForgeLearningCard`**: Lists recent failure patterns and allows 1-click conversion into project rules.
2. **`CacheDoctorCard`**: Displays prompt cache hit ratio and provides a "Clear Cache Churn" button.

---

## 3. Testing & Verification

- Vitest tests in `apps/gui/test/bridge/forge-cache-route.test.ts`.
- `pnpm typecheck` and `pnpm --filter @megasaver/gui test`.
