# CC2: connector.ts split (S3 + S4 + S6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `apps/cli/src/commands/connector.ts` (419 LOC, exceeds §8 300-line threshold) into a focused subdirectory mirroring PR #18's `commands/session/{...}` layout. Closes critic backlog items S3 (extract `resolveProjectAndRoot` shared prologue), S4 (file split), and S6 (regression fixture for `upsertBlock` byte-equality predicate).

**Risk:** MEDIUM — structural refactor on a hot path, byte-identical behavior required. All existing snapshot/golden tests in `apps/cli/test/connector.test.ts` and `apps/cli/test/connector-status.test.ts` MUST pass without modification.

**Architecture:** New layout under `apps/cli/src/commands/connector/`:

| File | Responsibility |
|------|----------------|
| `shared.ts` | `resolveProjectAndRoot(input)` shared prologue + `pickLatestOpenSession`, `filterMemoryEntriesForSession`, `buildConnectorContext`, `formatStatusLine`, `TARGET_ID_COLUMN_WIDTH`, common types |
| `sync.ts` | `connectorSyncCommand` + `runConnectorSync(input)` + `RunConnectorSyncInput` |
| `status.ts` | `connectorStatusCommand` + `runConnectorStatus(input)` + `RunConnectorStatusInput` |
| `index.ts` | re-exports of public surface (`connectorCommand`, `connectorSyncCommand`, `connectorStatusCommand`, `runConnectorSync`, `runConnectorStatus`, plus types) + `connectorCommand` defineCommand aggregator |

Old `apps/cli/src/commands/connector.ts` deleted. External importers (`apps/cli/src/main.ts`, two test files) update only the import path (`./commands/connector.js` → `./commands/connector/index.js`); the imported names are unchanged.

**Tech Stack:** TypeScript strict ESM, Citty, Zod, Vitest

---

## File Map

| File | Change |
|------|--------|
| `apps/cli/src/commands/connector/shared.ts` | NEW — extracted helpers + `resolveProjectAndRoot` shared prologue |
| `apps/cli/src/commands/connector/sync.ts` | NEW — sync command + handler, imports from `./shared.js` |
| `apps/cli/src/commands/connector/status.ts` | NEW — status command + handler, imports from `./shared.js` |
| `apps/cli/src/commands/connector/index.ts` | NEW — public re-exports + `connectorCommand` aggregator |
| `apps/cli/src/commands/connector.ts` | DELETED |
| `apps/cli/src/main.ts` | Import path: `./commands/connector.js` → `./commands/connector/index.js` |
| `apps/cli/test/connector.test.ts` | Import path: `../src/commands/connector.js` → `../src/commands/connector/index.js`; +1 S6 byte-equality regression test |
| `apps/cli/test/connector-status.test.ts` | Import path: `../src/commands/connector.js` → `../src/commands/connector/index.js` |

---

### Task 1: Create `commands/connector/shared.ts`

**Files:**
- Create: `apps/cli/src/commands/connector/shared.ts`

- [ ] **Step 1: Extract shared helpers**

Extract from current `connector.ts`:
- `TARGET_ID_COLUMN_WIDTH` constant
- `formatStatusLine(target, status, session?)`
- `pickLatestOpenSession(sessions, agentId)`
- `filterMemoryEntriesForSession(entries, session)`
- `buildConnectorContext(target, project, allSessions, allMemoryEntries)`

- [ ] **Step 2: Add `resolveProjectAndRoot(input)` shared prologue (S3)**

The prologue every command runs: validate `storeFlag` → resolve `rootDir`, parse `projectName` schema, validate `targetFlag` against `KNOWN_TARGETS`, ensure store ready, look up project by name, assert project root. Returns `{ rootDir, projectName, project, registry, initialized }` on success or `{ exitCode, message, kind }` on failure (caller emits to stderr).

Sketch:
```ts
type ResolveOk = {
  ok: true;
  project: Project;
  registry: CoreRegistry; // from ensureStoreReady
  initialized: boolean;
};
type ResolveErr = { ok: false; exitCode: 0 | 1; messages: string[] };

export async function resolveProjectAndRoot(input: {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
}): Promise<ResolveOk | ResolveErr> { ... }
```

Caller pattern in `runConnectorSync` / `runConnectorStatus`:
```ts
const resolved = await resolveProjectAndRoot({...});
if (!resolved.ok) {
  for (const m of resolved.messages) input.stderr(m);
  return resolved.exitCode;
}
const { project, registry, initialized } = resolved;
if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
```

WAIT — `note: initialized store at ${rootDir}` requires `rootDir`. Either include `rootDir` in the resolve result, or emit the init notice from inside `resolveProjectAndRoot` via an injected stderr callback. Use the latter — pass `stderr` to keep the caller flat. The `messages` array on the error path is then unnecessary; switch to direct stderr calls in both success+error paths so the prologue owns ALL prologue stderr output, identical to today's behavior.

Final shape:
```ts
type ResolveOk = { ok: true; project: Project; registry: CoreRegistry };
type ResolveErr = { ok: false; exitCode: 0 | 1 };

export async function resolveProjectAndRoot(input: {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stderr: (line: string) => void;
}): Promise<ResolveOk | ResolveErr>
```

- [ ] **Step 3: Verify file**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/cc2-connector-split
pnpm --filter @megasaver/cli typecheck 2>&1 | tail -5
```

Expected: typecheck still green (file is created but not yet imported, so no breakage; sanity check only).

---

### Task 2: Create `commands/connector/sync.ts`

**Files:**
- Create: `apps/cli/src/commands/connector/sync.ts`

- [ ] **Step 1: Move sync command + handler**

Copy lines 69-208 of current `connector.ts` (`RunConnectorSyncInput`, `runConnectorSync`, `connectorSyncCommand`). Replace inline prologue (resolveStorePath → projectNameSchema → isKnownTargetId → ensureStoreReady → project lookup → assertProjectRoot) with `resolveProjectAndRoot` call. Imports: `./shared.js` for `formatStatusLine`, `buildConnectorContext`, `resolveProjectAndRoot`. Drop `parseBlock` import (sync doesn't use it).

- [ ] **Step 2: Verify file**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/cc2-connector-split
pnpm --filter @megasaver/cli typecheck 2>&1 | tail -5
```

Expected: typecheck remains green.

---

### Task 3: Create `commands/connector/status.ts`

**Files:**
- Create: `apps/cli/src/commands/connector/status.ts`

- [ ] **Step 1: Move status command + handler**

Copy lines 210-411 of current `connector.ts` (`RunConnectorStatusInput`, `runConnectorStatus`, `connectorStatusCommand`). Replace inline prologue with `resolveProjectAndRoot` call. Imports: `./shared.js` + `parseBlock` from `@megasaver/connectors-shared`.

- [ ] **Step 2: Verify file**

```bash
pnpm --filter @megasaver/cli typecheck 2>&1 | tail -5
```

Expected: typecheck remains green.

---

### Task 4: Create `commands/connector/index.ts`

**Files:**
- Create: `apps/cli/src/commands/connector/index.ts`

- [ ] **Step 1: Re-export public surface and define connectorCommand**

```ts
import { defineCommand } from "citty";
import { connectorStatusCommand } from "./status.js";
import { connectorSyncCommand } from "./sync.js";

export {
  type RunConnectorSyncInput,
  runConnectorSync,
  connectorSyncCommand,
} from "./sync.js";
export {
  type RunConnectorStatusInput,
  runConnectorStatus,
  connectorStatusCommand,
} from "./status.js";

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
    status: connectorStatusCommand,
  },
});
```

Pattern matches `commands/session/index.ts` exactly.

---

### Task 5: Update import paths and delete old file

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/test/connector.test.ts`
- Modify: `apps/cli/test/connector-status.test.ts`
- Delete: `apps/cli/src/commands/connector.ts`

- [ ] **Step 1: Update `main.ts`**

```ts
- import { connectorCommand } from "./commands/connector.js";
+ import { connectorCommand } from "./commands/connector/index.js";
```

- [ ] **Step 2: Update `connector.test.ts`**

```ts
- import { connectorStatusCommand, connectorSyncCommand } from "../src/commands/connector.js";
+ import { connectorStatusCommand, connectorSyncCommand } from "../src/commands/connector/index.js";
```

- [ ] **Step 3: Update `connector-status.test.ts`**

```ts
- import {
-   connectorStatusCommand,
-   runConnectorStatus,
-   runConnectorSync,
- } from "../src/commands/connector.js";
+ import {
+   connectorStatusCommand,
+   runConnectorStatus,
+   runConnectorSync,
+ } from "../src/commands/connector/index.js";
```

- [ ] **Step 4: Delete old file**

```bash
rm apps/cli/src/commands/connector.ts
```

- [ ] **Step 5: Run typecheck + tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/cc2-connector-split
pnpm --filter @megasaver/cli typecheck 2>&1 | tail -5
pnpm --filter @megasaver/cli test 2>&1 | tail -10
```

Expected: typecheck green, all 207 existing CLI tests still passing.

---

### Task 6: S6 regression fixture — byte-equality

**Files:**
- Modify: `apps/cli/test/connector.test.ts`

- [ ] **Step 1: TDD — write the failing test (it should pass against current correct behavior)**

The test asserts: for each `KNOWN_TARGETS` entry, after `mega connector sync` writes a fresh block, calling `upsertBlock({ existingContent: written, context })` returns the byte-identical string (`result === existing`). This inoculates the byte-equality predicate driving the `noop` status word — if a future change to render/upsert logic introduces non-determinism (e.g. timestamp drift), the test fires.

Append a new describe block at the end of `apps/cli/test/connector.test.ts`:

```ts
import { upsertBlock } from "@megasaver/connectors-shared";
// ...

describe("upsertBlock — byte-equality regression fixture (S6)", () => {
  // For each known target: sync writes a fresh block, then upsertBlock
  // re-applied to that exact content must return the same string instance
  // (or at minimum a byte-identical string). This pins the predicate that
  // drives the `noop` status word — any non-determinism in render/upsert
  // breaks here before it ships.

  let store: string;
  let projectRoot: string;
  // ...standard setup...

  for (const target of KNOWN_TARGETS) {
    it(`${target.id}: re-applying upsertBlock to a freshly-written file is a no-op`, async () => {
      // seed project + matching open session for target.agentId
      // first sync (target=target.id) writes the file
      // read written content
      // build context the same way runConnectorSync does
      // assert upsertBlock({existingContent: written, context}) === written
    });
  }
});
```

(The test computes `context` via `buildConnectorContext` directly imported from `../src/commands/connector/shared.js`.)

- [ ] **Step 2: Run new test**

```bash
pnpm --filter @megasaver/cli test connector.test.ts 2>&1 | tail -10
```

Expected: 4 new tests (one per target) all pass — they pin existing correct behavior.

---

### Task 7: pnpm verify

- [ ] **Step 1: Full verify from monorepo root**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/cc2-connector-split
pnpm verify 2>&1 | tail -20
```

Expected: lint + typecheck + tests all GREEN. CLI test count: 207 → 211 (+4 from S6 per-target fixture).

- [ ] **Step 2: Confirm new file LOCs**

```bash
wc -l apps/cli/src/commands/connector/*.ts
```

Expected: every file well under 300 LOC.

---

### Task 8: Commits + push + PR

- [ ] **Step 1: Commits (one per logical step)**

```bash
git add apps/cli/src/commands/connector/shared.ts
git commit -m "refactor(cli): extract connector shared prologue (S3)"

git add apps/cli/src/commands/connector/sync.ts
git commit -m "refactor(cli): extract connector sync subcommand (S4)"

git add apps/cli/src/commands/connector/status.ts
git commit -m "refactor(cli): extract connector status subcommand (S4)"

git add apps/cli/src/commands/connector/index.ts apps/cli/src/main.ts \
        apps/cli/test/connector.test.ts apps/cli/test/connector-status.test.ts
git rm apps/cli/src/commands/connector.ts
git commit -m "refactor(cli): wire connector subdir + drop old file (S4)"

git add apps/cli/test/connector.test.ts
git commit -m "test(cli): byte-equality regression fixture (S6)"
```

(If staged ordering forces multiple commits to share a working tree, fold related steps into single commits — keep each commit a coherent logical unit.)

- [ ] **Step 2: Push**

```bash
git push -u origin feat/cc2-connector-split
```

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --title "refactor: split connector.ts (CC2 — S3 + S4 + S6)" \
  --body "..."
```

PR body lists: layout, closed items (S3, S4, S6), test counts before/after, new file LOCs, `pnpm verify` outcome.

---

## Verification checkpoint matrix

| After task | Command | Expected |
|------------|---------|----------|
| 1, 2, 3 | `pnpm --filter @megasaver/cli typecheck` | green (intermediate states fine — old file still in place) |
| 5 | `pnpm --filter @megasaver/cli typecheck` + `test` | green; 207 tests pass |
| 6 | `pnpm --filter @megasaver/cli test` | 211 tests pass |
| 7 | `pnpm verify` | green |
