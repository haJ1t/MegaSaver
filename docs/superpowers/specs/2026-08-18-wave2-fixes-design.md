---
title: Wave-2 Closeout Bugfixes Design
risk: MEDIUM
created: 2026-08-18
sources:
  - apps/cli/tsup.bundle.config.ts
  - apps/cli/src/commands/review/index.ts
  - apps/cli/src/commands/up.ts
  - apps/cli/src/up/apply.ts
  - apps/cli/src/commands/fence/init.ts
---

# Wave-2 Closeout Bugfixes Design

## Summary

This design addresses four specific bugs and UX gaps identified during post-implementation review of the Wave-2 features:
1. **Stale Standalone CLI Bundle**: `apps/cli/dist-bundle/mega.mjs` was not rebuilt with the new Wave-2 command surfaces (`up`, `cost`, `review`, `budget`, `fence`). Add automated freshness testing in `bundle-smoke.test.ts` and ensure the bundle build runs cleanly.
2. **Review Subcommands Regression**: `apps/cli/src/commands/review/index.ts` omitted `attest` and `check` subcommands when `pack` was added. Restore `attest` and `check` alongside `pack` and add command registry unit test.
3. **`mega up` Connector Seeding**: `up/apply.ts` called `connectorSync(proj.name)` with `targetFlag: undefined`. `connector/sync.ts` skips non-existent target files unless `targetFlag === target.id`. `mega up` must pass the planned target IDs (`claude-code` or specific target) so fresh files like `CLAUDE.md` are seeded on creation.
4. **`mega fence init` Empty Repo Fallback & `--json` Support**: In a repo with no fence signals, `mega fence init` exited 0 silently. It should print `"no fence signals detected"` in text mode when no entries were derived. Furthermore, add `--json` support across `mega fence init`, `mega fence status`, and `mega fence allow`.

---

## Technical Specifications

### 1. Standalone Bundle Freshness & Guard
- **Problem**: `dist-bundle/mega.mjs` is the standalone entrypoint published to npm / GitHub Releases. When new commands are registered in `apps/cli/src/main.ts`, omitting `pnpm --filter @megasaver/cli bundle` leaves the bundle without those commands.
- **Solution**:
  - Rebuild bundle: `pnpm --filter @megasaver/cli bundle`.
  - In `apps/cli/test/bundle-smoke.test.ts`, add test cases executing the bundle binary with `--help` and verifying that `up`, `cost`, `review`, `budget`, `fence` subcommands are present and functional.

### 2. Restore `mega review attest` and `mega review check`
- **File**: `apps/cli/src/commands/review/index.ts`
- **Specification**:
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
- **Tests**: Add test in `apps/cli/test/commands/review.test.ts` verifying that `reviewCommand.subCommands` contains `attest`, `check`, and `pack`.

### 3. Fix `mega up` Target Seeding on Fresh Projects
- **Problem**: `up/apply.ts:85` called `input.deps.connectorSync(proj.name)`. In `apps/cli/src/commands/up.ts:310`, `targetFlag` was `undefined`. Since `connector/sync.ts:90-93` skips targets where `existing === null` unless `input.targetFlag === target.id`, running `mega up` in a project without `CLAUDE.md` skipped creating `CLAUDE.md`.
- **Solution**:
  - Update `UpApplyDeps.connectorSync` signature in `apps/cli/src/up/apply.ts` to `(projectName: string, targetId?: string) => Promise<0 | 1>`.
  - In `up/apply.ts`, iterate over `input.state.targets` and call `connectorSync(proj.name, target.id)` for each target planned for install/repair, or pass each target ID.
  - In `apps/cli/src/commands/up.ts`, pass `targetId` to `runConnectorSync({ ..., targetFlag: targetId })`.
- **Tests**: Add an integration test in `apps/cli/test/commands/up-apply-seed.test.ts` verifying that `mega up` in a directory with no `CLAUDE.md` actually creates `CLAUDE.md` on disk with the expected connector content.

### 4. `mega fence init` Fallback & `--json` Support
- **Files**:
  - `apps/cli/src/commands/fence/init.ts`
  - `apps/cli/src/commands/fence/status.ts`
  - `apps/cli/src/commands/fence/allow.ts`
- **Specification**:
  - In `runFenceInit`:
    - If `existing === null` and `derived.file.entries.length === 0`:
      - In text mode: print `"no fence signals detected"`.
    - If `input.json` is `true`:
      - Output JSON: `{ root, entries: derived.file.entries, skipped: derived.skipped, degradedSignals: derived.degradedSignals, written: boolean }`.
  - In `runFenceStatus`:
    - If `input.json` is `true`:
      - Output JSON: `{ root: fenceRoot, allowCount: file.allow.length, totalEntries: file.entries.length, warnCount, denyCount, classCounts: Object.fromEntries(classCounts) }` or `{ disabled: true }` if missing/disabled.
  - In `runFenceAllow`:
    - If `input.json` is `true`:
      - Output JSON: `{ path: targetGlob, status: alreadyAllowed ? "already-allowed" : "allowed" }`.
- **Tests**: Add tests in `apps/cli/test/commands/fence.test.ts` verifying:
  - `mega fence init` in an empty repo prints `"no fence signals detected"`.
  - `mega fence init --json` returns structured JSON.
  - `mega fence status --json` returns structured status JSON.
  - `mega fence allow <path> --json` returns structured allow JSON.

---

## Verification Plan

1. **Unit & Integration Tests**:
   - `pnpm --filter @megasaver/cli test test/commands/fence.test.ts`
   - `pnpm --filter @megasaver/cli test test/commands/up.test.ts`
   - `pnpm --filter @megasaver/cli test test/commands/review.test.ts`
   - `pnpm --filter @megasaver/cli test test/bundle-smoke.test.ts`
2. **Bundle Build & Verification**:
   - `pnpm --filter @megasaver/cli bundle`
   - `MEGA_REQUIRE_BUNDLE=1 pnpm --filter @megasaver/cli test test/bundle-smoke.test.ts`
3. **Monorepo Verification**:
   - `pnpm verify` (lint + typecheck + test + conventions:check).
