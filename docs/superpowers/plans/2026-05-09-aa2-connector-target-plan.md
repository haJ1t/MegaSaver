# AA2: Derive connector --target description from KNOWN_TARGET_IDS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive both `--target` arg descriptions in `connector.ts` from `KNOWN_TARGET_IDS` so `--help` enumerates valid target IDs automatically.

**Architecture:** Add `KNOWN_TARGET_IDS` to the existing `known-targets.js` import in `connector.ts`, replace 2 static description strings with template literals, and add 2 drift-guard tests in `connector.test.ts` that `toBe`-pin the derived format. TDD: tests written and confirmed failing before the production change.

**Tech Stack:** TypeScript strict ESM, Citty, Vitest, pnpm

---

## File Map

| File | Change |
|------|--------|
| `apps/cli/src/commands/connector.ts` | Add `KNOWN_TARGET_IDS` to import (line 16); update 2 description strings (lines ~184, ~327) |
| `apps/cli/test/connector.test.ts` | Add 2 drift-guard `it` blocks at end of file (new `describe` block) |

---

### Task 1: Add drift-guard tests (failing)

**Files:**
- Modify: `apps/cli/test/connector.test.ts` (append at end of file)

- [ ] **Step 1: Add the import for KNOWN_TARGET_IDS in the test file**

Open `apps/cli/test/connector.test.ts`. The file currently starts with:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorError } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorStatusCommand, connectorSyncCommand } from "../src/commands/connector.js";
```

Add `KNOWN_TARGET_IDS` import after the existing imports (after line 6):

```ts
import { KNOWN_TARGET_IDS } from "../src/known-targets.js";
```

- [ ] **Step 2: Append drift-guard describe block at end of test file**

Append this block at the very end of `apps/cli/test/connector.test.ts`:

```ts
describe("connector --target drift guards", () => {
  it("--target description on connectorSyncCommand derives from KNOWN_TARGET_IDS", () => {
    const expected = `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to seed when its file does not exist.`;
    expect(connectorSyncCommand.args?.target?.description).toBe(expected);
  });

  it("--target description on connectorStatusCommand derives from KNOWN_TARGET_IDS", () => {
    const expected = `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.`;
    expect(connectorStatusCommand.args?.target?.description).toBe(expected);
  });
});
```

- [ ] **Step 3: Run the new tests to confirm they FAIL**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -A 5 "drift guard\|FAIL\|✗\|×"
```

Expected: 2 test failures — the descriptions are still static strings, not derived.

---

### Task 2: Production change — update connector.ts

**Files:**
- Modify: `apps/cli/src/commands/connector.ts` (line 16 import + lines ~184 and ~327)

- [ ] **Step 1: Add KNOWN_TARGET_IDS to the import on line 16**

Current line 16:
```ts
import { KNOWN_TARGETS, type KnownTargetId, isKnownTargetId } from "../known-targets.js";
```

Replace with:
```ts
import { KNOWN_TARGETS, KNOWN_TARGET_IDS, type KnownTargetId, isKnownTargetId } from "../known-targets.js";
```

- [ ] **Step 2: Update connectorSyncCommand --target description (~line 184)**

Current:
```ts
    target: {
      type: "string",
      description: "Optional target id to seed when its file does not exist.",
    },
```

Replace with:
```ts
    target: {
      type: "string",
      description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to seed when its file does not exist.`,
    },
```

- [ ] **Step 3: Update connectorStatusCommand --target description (~line 327)**

Current:
```ts
    target: { type: "string", description: "Optional target id to filter the report." },
```

Replace with:
```ts
    target: { type: "string", description: `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.` },
```

- [ ] **Step 4: Run the drift-guard tests to confirm they now PASS**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -A 3 "drift guard\|PASS\|✓\|√"
```

Expected: both drift-guard tests pass.

- [ ] **Step 5: Run full verify to confirm nothing broke**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
pnpm verify 2>&1 | tail -20
```

Expected: lint, typecheck, and all tests GREEN.

---

### Task 3: Commit both changes

**Files:**
- `apps/cli/test/connector.test.ts`
- `apps/cli/src/commands/connector.ts`

- [ ] **Step 1: Stage and commit the drift-guard tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
git add apps/cli/test/connector.test.ts
git commit -m "test: drift-guard --target description derivation"
```

- [ ] **Step 2: Stage and commit the production change**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
git add apps/cli/src/commands/connector.ts
git commit -m "feat: derive connector --target descriptions from KNOWN_TARGET_IDS"
```

---

### Task 4: DoD gate — pnpm verify + manual smoke

- [ ] **Step 1: Build the CLI**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
pnpm build 2>&1 | tail -10
```

Expected: build succeeds with no errors.

- [ ] **Step 2: Smoke connector sync --help**

```bash
node /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target/apps/cli/dist/cli.js connector sync --help 2>&1 | grep -i target
```

Expected output contains: `Optional target id (claude-code | codex | cursor | aider) to seed when its file does not exist.`

- [ ] **Step 3: Smoke connector status --help**

```bash
node /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target/apps/cli/dist/cli.js connector status --help 2>&1 | grep -i target
```

Expected output contains: `Optional target id (claude-code | codex | cursor | aider) to filter the report.`

---

### Task 5: Push branch and open PR

- [ ] **Step 1: Push branch**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
git push -u origin feat/aa2-connector-target
```

- [ ] **Step 2: Open PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/aa2-connector-target
gh pr create \
  --title "feat(cli): derive connector --target descriptions from KNOWN_TARGET_IDS" \
  --body "$(cat <<'EOF'
## Summary

- Adds \`KNOWN_TARGET_IDS\` to the existing \`known-targets.js\` import in \`connector.ts\`
- Replaces 2 static \`--target\` description strings with template literals that enumerate valid target IDs in launch order
- Adds 2 drift-guard \`toBe\` tests parallel to PR #23's pattern

## Behavior contract

- Enumeration order is launch order from \`KNOWN_TARGETS\`: \`claude-code | codex | cursor | aider\`
- \`connector sync --help\` shows: \`Optional target id (claude-code | codex | cursor | aider) to seed when its file does not exist.\`
- \`connector status --help\` shows: \`Optional target id (claude-code | codex | cursor | aider) to filter the report.\`
- Adding a 5th target only requires editing \`KNOWN_TARGETS\` in \`known-targets.ts\`

## Test plan

- [ ] \`pnpm verify\` GREEN (lint + typecheck + all tests)
- [ ] Drift-guard test 1: \`connectorSyncCommand.args?.target?.description\` matches derived string
- [ ] Drift-guard test 2: \`connectorStatusCommand.args?.target?.description\` matches derived string
- [ ] Manual smoke: \`connector sync --help\` shows enumerated target IDs
- [ ] Manual smoke: \`connector status --help\` shows enumerated target IDs

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: SendMessage team-lead with PR URL**

Send the PR URL to team-lead so they can run critic review + merge.
