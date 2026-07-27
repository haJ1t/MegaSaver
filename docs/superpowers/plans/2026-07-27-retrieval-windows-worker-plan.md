# Retrieval Windows Test Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Windows CI from starving retrieval's Vitest module workers while preserving all retrieval test behavior.

**Architecture:** Retrieval keeps its existing test files and Turbo continues coordinating repository packages. Vitest 2.1.9 defaults to the `forks` pool, so the package-local config declares one fork and cannot multiply the repository-level concurrent workload.

**Tech Stack:** TypeScript, Vitest 2.1.9, Vite config, pnpm, Turborepo, GitHub Actions.

## Global Constraints

- Change only retrieval's Vitest worker configuration and its configuration-contract test.
- Do not increase timeouts, add retries, or change global Turbo concurrency.
- Preserve typecheck configuration and all existing test includes.
- Require root `pnpm verify` and replacement Ubuntu/Windows CI bundle smoke before merge.

---

### Task 1: Pin retrieval's internal worker fan-out

**Files:**
- Create: `packages/retrieval/test/vitest-config.test.ts`
- Modify: `packages/retrieval/vitest.config.ts`

**Interfaces:**
- Consumes: Vitest config's `test.poolOptions.forks.singleFork` boolean.
- Produces: A package-local configuration contract that guards the Windows CI scheduling fix.

- [ ] **Step 1: Write the failing test**

```ts
import config from "../vitest.config.js";
import { expect, it } from "vitest";

it("uses one internal worker fork", () => {
  expect(config.test?.poolOptions?.forks?.singleFork).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/retrieval exec vitest run test/vitest-config.test.ts`

Expected: FAIL because `singleFork` is absent from the current config.

- [ ] **Step 3: Write minimal implementation**

```ts
test: {
  poolOptions: {
    forks: {
      singleFork: true,
    },
  },
  // existing timeout, include, and typecheck properties remain unchanged
}
```

- [ ] **Step 4: Run focused and package tests**

Run:

```bash
pnpm --dir packages/retrieval exec vitest run test/vitest-config.test.ts
pnpm --dir packages/retrieval test
```

Expected: both commands pass; retrieval reports all existing suites plus the
configuration contract.

- [ ] **Step 5: Run repository verification and replacement CI**

Run: `pnpm verify`

Expected: lint, typecheck, test, and conventions checks pass. Push the commit,
then require `verify (ubuntu-latest)` and `verify (windows-latest)` to pass
their Verify and Bundle smoke steps before merging.

- [ ] **Step 6: Commit**

```bash
git add packages/retrieval/vitest.config.ts packages/retrieval/test/vitest-config.test.ts \
  docs/superpowers/specs/2026-07-27-retrieval-windows-worker-design.md \
  docs/superpowers/plans/2026-07-27-retrieval-windows-worker-plan.md
git commit -m "fix(ci): limit retrieval test workers"
```

## Self-review

- Spec coverage: Task 1 applies the single package-local worker cap, guards it
  with a real config import, preserves existing settings, and verifies all
  specified local and CI gates.
- Placeholder scan: no unresolved placeholders or deferred work remain.
- Type consistency: the test reads the Vitest 2.1.9 `poolOptions.forks`
  shape declared by the real config.
