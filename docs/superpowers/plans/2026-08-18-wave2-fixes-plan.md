# Wave-2 Closeout Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix stale standalone CLI bundle, restore missing review subcommands, seed connector targets during `mega up`, and enhance `mega fence init/status/allow` with empty-state messages and `--json` support.

**Architecture:**
- Restore `attest` and `check` subcommands in `reviewCommand`.
- In `up/apply.ts`, iterate over planned targets and pass `target.id` to `connectorSync` so new connector files are created.
- In `fence/init.ts`, emit `"no fence signals detected"` on empty derivations in text mode and add `--json` support to `init`, `status`, `allow`.
- Rebuild standalone bundle `apps/cli/dist-bundle/mega.mjs` and add command recognition tests in `bundle-smoke.test.ts`.

**Tech Stack:** TypeScript strict ESM, Citty CLI, Vitest, Turborepo, tsup.

## Global Constraints
- Node 22 LTS, strict TypeScript ESM only.
- No regression on existing 2,319+ tests.
- TDD: Write failing tests before writing implementation code for each task.

---

### Task 1: Restore `mega review attest` and `mega review check`

**Files:**
- Modify: `apps/cli/src/commands/review/index.ts`
- Test: `apps/cli/test/commands/review-subcommands.test.ts`

**Interfaces:**
- `reviewCommand`: citty command with `subCommands: { attest, check, pack }`.

- [ ] **Step 1: Write the failing test**
Create `apps/cli/test/commands/review-subcommands.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { reviewCommand } from "../../src/commands/review/index.js";

describe("reviewCommand subcommands", () => {
  it("exposes attest, check, and pack subcommands", async () => {
    const subCommands = await (typeof reviewCommand.subCommands === "function"
      ? reviewCommand.subCommands()
      : reviewCommand.subCommands);
    expect(subCommands).toHaveProperty("attest");
    expect(subCommands).toHaveProperty("check");
    expect(subCommands).toHaveProperty("pack");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @megasaver/cli test test/commands/review-subcommands.test.ts`
Expected: FAIL (missing `attest` / `check`)

- [ ] **Step 3: Implement fix in `apps/cli/src/commands/review/index.ts`**
```ts
import { defineCommand } from "citty";
import { reviewAttestCommand } from "./attest.js";
import { reviewCheckCommand } from "./check.js";
import { reviewPackCommand } from "./pack.js";

export const reviewCommand = defineCommand({
  meta: {
    name: "review",
    description: "Review tools for git commit ranges, attestations, and evidence packs.",
  },
  subCommands: {
    attest: reviewAttestCommand,
    check: reviewCheckCommand,
    pack: reviewPackCommand,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @megasaver/cli test test/commands/review-subcommands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/commands/review/index.ts apps/cli/test/commands/review-subcommands.test.ts
git commit -m "fix(cli): restore review attest and check subcommands"
```

---

### Task 2: Fix `mega up` Target Seeding on Fresh Projects

**Files:**
- Modify: `apps/cli/src/up/apply.ts`
- Modify: `apps/cli/src/commands/up.ts`
- Test: `apps/cli/test/commands/up-apply-seed.test.ts`

**Interfaces:**
- `UpApplyDeps.connectorSync`: `(projectName: string, targetId?: string) => Promise<0 | 1>`

- [ ] **Step 1: Write the failing test**
Create `apps/cli/test/commands/up-apply-seed.test.ts`:
Test that `runUp` in a directory with no `CLAUDE.md` creates `CLAUDE.md` on disk when target is `claude-code`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @megasaver/cli test test/commands/up-apply-seed.test.ts`
Expected: FAIL (CLAUDE.md not created)

- [ ] **Step 3: Implement fix in `apps/cli/src/up/apply.ts` and `apps/cli/src/commands/up.ts`**
- Update `apply.ts` to call `connectorSync(proj.name, target.id)` for planned targets.
- Update `commands/up.ts` to forward `targetId` to `runConnectorSync({ ..., targetFlag: targetId })`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @megasaver/cli test test/commands/up-apply-seed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/up/apply.ts apps/cli/src/commands/up.ts apps/cli/test/commands/up-apply-seed.test.ts
git commit -m "fix(cli): seed connector targets on mega up"
```

---

### Task 3: `mega fence init` Empty Repo Fallback & `--json` Support

**Files:**
- Modify: `apps/cli/src/commands/fence/init.ts`
- Modify: `apps/cli/src/commands/fence/status.ts`
- Modify: `apps/cli/src/commands/fence/allow.ts`
- Test: `apps/cli/test/commands/fence-json.test.ts`

**Interfaces:**
- `runFenceInit`: accepts `json?: boolean`, outputs `"no fence signals detected"` when empty in text mode.
- `runFenceStatus`: accepts `json?: boolean`, outputs JSON statistics when requested.
- `runFenceAllow`: accepts `json?: boolean`, outputs JSON status when requested.

- [ ] **Step 1: Write the failing test**
Create `apps/cli/test/commands/fence-json.test.ts`:
- Tests empty repo text output `"no fence signals detected"`.
- Tests `--json` output format for `init`, `status`, `allow`.

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm --filter @megasaver/cli test test/commands/fence-json.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement empty-state fallback & `--json` support**
Update `apps/cli/src/commands/fence/init.ts`, `status.ts`, `allow.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm --filter @megasaver/cli test test/commands/fence-json.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/src/commands/fence/ apps/cli/test/commands/fence-json.test.ts
git commit -m "fix(fence): empty init message and json support across fence commands"
```

---

### Task 4: Rebuild Standalone Bundle and Guard Command Availability

**Files:**
- Modify: `apps/cli/test/bundle-smoke.test.ts`
- Build: `apps/cli/dist-bundle/mega.mjs`

- [ ] **Step 1: Write test in `apps/cli/test/bundle-smoke.test.ts`**
Add a test in `bundle-smoke.test.ts` verifying that `mega.mjs` recognizes `up`, `cost`, `review`, `budget`, and `fence` commands.

- [ ] **Step 2: Run test against current bundle to verify it fails**
Run: `pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'recognizes all top-level Wave-2 commands'`
Expected: FAIL (commands missing in old bundle)

- [ ] **Step 3: Rebuild standalone bundle**
Run: `pnpm --filter @megasaver/cli bundle`

- [ ] **Step 4: Run bundle smoke tests to verify it passes**
Run: `pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'recognizes all top-level Wave-2 commands'`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/cli/dist-bundle/ apps/cli/test/bundle-smoke.test.ts
git commit -m "build(cli): update standalone bundle with Wave-2 commands"
```

---

### Task 5: Monorepo Verification & DoD Gate

- [ ] **Step 1: Run full verification gate**
Run: `pnpm lint:fix && pnpm verify`
Expected: All tasks 66/66 green, 0 type errors, conventions ok.

- [ ] **Step 2: Update wiki and log**
Update `wiki/log.md`.

- [ ] **Step 3: Final commit & completion marker**
Commit all changes and report completion.
