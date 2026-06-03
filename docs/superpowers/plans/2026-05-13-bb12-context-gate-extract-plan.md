# BB12 — context-gate package extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the context-gate orchestrator out of `@megasaver/core` into a standalone `@megasaver/context-gate` package, behavior-preserving, with `@megasaver/core` re-exporting it so all consumers stay unchanged.

**Architecture:** Move 6 src files + barrel into a new workspace package scaffolded like `packages/stats`. Break the lone `context-gate → core` edge (`import type { CoreRegistry }`, 4 files) by replacing it with a 3-property structural port (`OrchestratorRegistry`) defined inside the new package — core's `CoreRegistry` satisfies it structurally, so no call site changes. `@megasaver/core` keeps its `context-gate.ts` barrel as a re-export from the new package (consumer strategy (a) — zero churn for `apps/cli` + `mcp-bridge`). Registry-coupled tests stay in core; registry-free tests + the dep-direction guard move to the new package.

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript (NodeNext ESM, strict), tsup, Vitest, Biome, Changesets.

**Risk:** MEDIUM — behavior-preserving package-boundary refactor. The CRITICAL spawn path (`run-command.ts`) moves verbatim (git mv, no logic edit); it was already reviewed under BB7b. Structural risk only (cycle / consumer break), mitigated by the relocated dep-direction guard + unchanged consumer imports + full `pnpm verify`.

**Execute AFTER BB8 + BB11 merge.** BB8 (mcp-bridge) and BB11 (connector CONTEXT_GATE block) consume the orchestrator via `@megasaver/core`; extracting mid-flight churns their diffs. A BB8 workflow is running concurrently in `.worktrees/bb8-mcp-bridge` — do NOT start the code phase of this plan until BB8 + BB11 are on `main`, then rebase this branch on `main` first.

**Spec:** `docs/superpowers/specs/2026-05-13-bb12-context-gate-extract-design.md` (cites AA1 §2a deferred-extraction trigger + §3c cycle guardrail + §19a/§20e).

---

## File structure map

```
packages/context-gate/                       NEW PACKAGE
  package.json                               NEW   (mirrors packages/stats/package.json)
  tsconfig.json                              NEW   (mirrors packages/stats/tsconfig.json)
  tsconfig.test.json                         NEW   (mirrors packages/core/tsconfig.test.json)
  tsconfig.test-d.json                       NEW   (mirrors packages/stats/tsconfig.test-d.json)
  tsup.config.ts                             NEW   (mirrors packages/stats/tsup.config.ts)
  vitest.config.ts                           NEW   (mirrors packages/stats/vitest.config.ts)
  src/
    registry-port.ts                         NEW   (OrchestratorRegistry structural port)
    index.ts                                 MOVED from packages/core/src/context-gate.ts (barrel)
    run.ts                                   MOVED from packages/core/src/context-gate/run.ts
    run-command.ts                           MOVED from packages/core/src/context-gate/run-command.ts
    read.ts                                  MOVED from packages/core/src/context-gate/read.ts
    fetch-chunk.ts                           MOVED from packages/core/src/context-gate/fetch-chunk.ts
    locate-chunk-set.ts                      MOVED from packages/core/src/context-gate/locate-chunk-set.ts
    types.ts                                 MOVED from packages/core/src/context-gate/types.ts
  test/
    dependency-direction.test.ts             MOVED+REWRITTEN from packages/core/test/context-gate/
    fetch-chunk.test.ts                      MOVED from packages/core/test/context-gate/ (imports repointed)
    locate-chunk-set.test.ts                 MOVED from packages/core/test/context-gate/ (imports repointed)

packages/core/
  src/context-gate.ts                        REWRITTEN → `export * from "@megasaver/context-gate";`
  src/index.ts                               UNCHANGED (still `export * from "./context-gate.js";`)
  src/context-gate/                          DELETED (empty after moves)
  package.json                               MODIFIED (+ "@megasaver/context-gate": "workspace:*")
  test/context-gate/run.test.ts             UNCHANGED imports (stays; core barrel re-exports)
  test/context-gate/read.test.ts            UNCHANGED imports (stays; core barrel re-exports)
  test/context-gate/run-command.test.ts     MODIFIED (1 deep import repointed to @megasaver/context-gate)
  test/context-gate/dependency-direction.test.ts   DELETED (moved to new package)

.changeset/bb12-context-gate-extract.md      NEW
```

No edit to `pnpm-workspace.yaml` (its `packages/*` glob already matches `packages/context-gate`). No edit to `turbo.json` (task graph is glob-driven). No edit to any consumer (`apps/cli/src/commands/output/*`, `packages/mcp-bridge/*`) — strategy (a).

---

### Task 1: Scaffold the `@megasaver/context-gate` package

**Files:**
- Create: `packages/context-gate/package.json`
- Create: `packages/context-gate/tsconfig.json`
- Create: `packages/context-gate/tsconfig.test.json`
- Create: `packages/context-gate/tsconfig.test-d.json`
- Create: `packages/context-gate/tsup.config.ts`
- Create: `packages/context-gate/vitest.config.ts`

- [ ] **Step 1: Create the package directory**

Run: `mkdir -p packages/context-gate/src packages/context-gate/test`
Expected: no output, exit 0.

- [ ] **Step 2: Write `packages/context-gate/package.json`**

Mirrors `packages/stats/package.json`. Deps are the AA1 §3c allow-list the core-folded orchestrator already used (content-store, output-filter, policy, shared, stats). `zod` is NOT a direct dependency (no moved file imports zod at runtime — confirmed: only type imports from `@megasaver/*`), so it is omitted; the dep-direction test in Task 7 asserts exactly this set. `typecheck` mirrors core's two-pass form because this package ships `.test.ts` integration tests.

```json
{
  "name": "@megasaver/context-gate",
  "version": "0.0.0",
  "private": true,
  "description": "Context-gate orchestrator for Mega Saver — file/exec output pipeline + chunk fetch, composed over policy, output-filter, content-store, and stats.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@megasaver/content-store": "workspace:*",
    "@megasaver/output-filter": "workspace:*",
    "@megasaver/policy": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "@megasaver/stats": "workspace:*",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.19.17",
    "fast-check": "^3.23.2"
  }
}
```

> Note: `zod` IS kept in `dependencies` above to match the existing core context-gate dep-direction allow-list verbatim (which lists `zod`), and because tsup/dts resolution of the `@megasaver/*` packages re-exports zod types. The Task-7 dep-direction test allow-list therefore includes `zod`. If `pnpm verify` later reports `zod` as an extraneous dependency for this package, drop it from BOTH this file and the Task-7 allow-list together — but the default is to keep it, matching the source allow-list being relocated.

- [ ] **Step 3: Write `packages/context-gate/tsconfig.json`** (identical to `packages/stats/tsconfig.json`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "incremental": false,
    "composite": false
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 4: Write `packages/context-gate/tsconfig.test.json`** (identical to `packages/core/tsconfig.test.json`)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 5: Write `packages/context-gate/tsconfig.test-d.json`** (identical to `packages/stats/tsconfig.test-d.json`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noPropertyAccessFromIndexSignature": false
  },
  "include": ["src/**/*", "test/**/*.test-d.ts"],
  "exclude": ["dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 6: Write `packages/context-gate/tsup.config.ts`** (identical to `packages/stats/tsup.config.ts`)

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
```

- [ ] **Step 7: Write `packages/context-gate/vitest.config.ts`** (identical to `packages/stats/vitest.config.ts`)

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test-d.ts"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.test-d.json",
    },
  },
});
```

- [ ] **Step 8: Install so pnpm links the new workspace package**

Run: `pnpm install`
Expected: pnpm resolves `@megasaver/context-gate` as a workspace package; ends with `Done in …`. (The `packages/*` glob in `pnpm-workspace.yaml` already matches; no YAML edit.)

- [ ] **Step 9: Verify the package is recognised by the workspace**

Run: `pnpm -r --filter @megasaver/context-gate exec node -e "console.log('linked')"`
Expected: prints `linked`. (Confirms the package name resolves before any source exists; tsup/test will fail until Task 2–3 land — expected.)

- [ ] **Step 10: Commit the scaffold**

```bash
git add packages/context-gate/package.json packages/context-gate/tsconfig.json packages/context-gate/tsconfig.test.json packages/context-gate/tsconfig.test-d.json packages/context-gate/tsup.config.ts packages/context-gate/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(context-gate): scaffold @megasaver/context-gate package"
```

---

### Task 2: Move the 6 src files + barrel (git mv, preserve history)

**Files:**
- Move: `packages/core/src/context-gate/{run,run-command,read,fetch-chunk,locate-chunk-set,types}.ts` → `packages/context-gate/src/`
- Move: `packages/core/src/context-gate.ts` → `packages/context-gate/src/index.ts`

- [ ] **Step 1: git mv the six source files**

```bash
git mv packages/core/src/context-gate/run.ts              packages/context-gate/src/run.ts
git mv packages/core/src/context-gate/run-command.ts      packages/context-gate/src/run-command.ts
git mv packages/core/src/context-gate/read.ts             packages/context-gate/src/read.ts
git mv packages/core/src/context-gate/fetch-chunk.ts      packages/context-gate/src/fetch-chunk.ts
git mv packages/core/src/context-gate/locate-chunk-set.ts packages/context-gate/src/locate-chunk-set.ts
git mv packages/core/src/context-gate/types.ts            packages/context-gate/src/types.ts
```
Expected: no output, exit 0. `git status` shows 6 renames.

- [ ] **Step 2: git mv the barrel into the new package's index**

```bash
git mv packages/core/src/context-gate.ts packages/context-gate/src/index.ts
```
Expected: no output, exit 0.

- [ ] **Step 3: Repoint the moved barrel's internal imports**

The barrel currently imports from `./context-gate/<file>.js`. Inside the new package the files are siblings, so the `context-gate/` path segment is dropped. Edit `packages/context-gate/src/index.ts` so every specifier loses the `context-gate/` segment:

```ts
export {
  runOutputPipeline,
  type RunOutputInput,
  type RunOutputResult,
} from "./run.js";
export {
  runOutputExecCommand,
  type RunOutputExecInput,
  type RunOutputExecResult,
  type RunCommandSpawn,
  type ExecResult,
} from "./run-command.js";
export { fetchChunk, type FetchChunkResult } from "./fetch-chunk.js";
export { locateChunkSet, type LocatedChunkSet } from "./locate-chunk-set.js";
export {
  resolveEffectiveSettings,
  runTwoGates,
  readAndFilter,
  persistChunkSet,
  defaultNow,
  defaultNewId,
} from "./read.js";
export type { EffectiveSettings, GateResult, PipelineEnv } from "./types.js";
export type { OrchestratorRegistry, SessionView, ProjectView } from "./registry-port.js";
```

(The final `registry-port.js` line is added now; that file is created in Task 3. The two internal sibling imports already correct — `run.ts`→`read.js`, `fetch-chunk.ts`→`locate-chunk-set.js` — do NOT carry a `context-gate/` segment and need no edit.)

- [ ] **Step 4: Remove the now-empty core context-gate directory**

Run: `rmdir packages/core/src/context-gate`
Expected: succeeds (directory empty after the 6 moves). If it errors "Directory not empty", run `ls packages/core/src/context-gate` to find stragglers — there should be none.

- [ ] **Step 5: Commit the moves (history preserved)**

```bash
git add -A packages/context-gate/src packages/core/src
git commit -m "refactor(context-gate): move orchestrator src into @megasaver/context-gate"
```

Note: do NOT run `pnpm verify` yet — the 4 `../registry.js` imports are now dangling (core path no longer reachable) and the core barrel re-export does not yet exist. Tasks 3 + 5 fix these before any verify.

---

### Task 3: Break the context-gate → core import (the inversion fix)

**Files:**
- Create: `packages/context-gate/src/registry-port.ts`
- Modify: `packages/context-gate/src/types.ts` (line 2, line 13)
- Modify: `packages/context-gate/src/read.ts` (line 11, line 25)
- Modify: `packages/context-gate/src/run.ts` (line 3, line 14)
- Modify: `packages/context-gate/src/run-command.ts` (line 8, line 15)

- [ ] **Step 1: Create the structural port**

`packages/context-gate/src/registry-port.ts`:

```ts
import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";

// Structural port: the slice of a registry the orchestrator reads.
// @megasaver/core's CoreRegistry structurally satisfies this interface, so
// callers keep passing a CoreRegistry with no cast (TS structural typing).
// Defined here to break the context-gate -> core dependency edge (AA1 §3c).
export interface SessionView {
  projectId: ProjectId;
  tokenSaver?: {
    mode: TokenSaverMode;
    maxReturnedBytes?: number;
    storeRawOutput?: boolean;
  };
}

export interface ProjectView {
  rootPath: string;
}

export interface OrchestratorRegistry {
  getSession(id: SessionId): SessionView | null;
  getProject(id: ProjectId): ProjectView | null;
}
```

- [ ] **Step 2: Repoint `types.ts`**

In `packages/context-gate/src/types.ts` replace the core import and the field type.

Old (line 2):
```ts
import type { CoreRegistry } from "../registry.js";
```
New:
```ts
import type { OrchestratorRegistry } from "./registry-port.js";
```

Old (in `PipelineEnv`):
```ts
  registry: CoreRegistry;
```
New:
```ts
  registry: OrchestratorRegistry;
```

- [ ] **Step 3: Repoint `read.ts`**

Old (line 11):
```ts
import type { CoreRegistry } from "../registry.js";
```
New:
```ts
import type { OrchestratorRegistry } from "./registry-port.js";
```

Old (in `resolveEffectiveSettings` signature):
```ts
  registry: CoreRegistry,
```
New:
```ts
  registry: OrchestratorRegistry,
```

- [ ] **Step 4: Repoint `run.ts`**

Old (line 3):
```ts
import type { CoreRegistry } from "../registry.js";
```
New:
```ts
import type { OrchestratorRegistry } from "./registry-port.js";
```

Old (in `RunOutputInput`):
```ts
  registry: CoreRegistry;
```
New:
```ts
  registry: OrchestratorRegistry;
```

- [ ] **Step 5: Repoint `run-command.ts`**

Old (line 8):
```ts
import type { CoreRegistry } from "../registry.js";
```
New:
```ts
import type { OrchestratorRegistry } from "./registry-port.js";
```

Old (in `RunOutputExecInput`):
```ts
  registry: CoreRegistry;
```
New:
```ts
  registry: OrchestratorRegistry;
```

- [ ] **Step 6: Confirm no moved file still references core**

Run: `grep -rn 'CoreRegistry\|\.\./registry\|@megasaver/core' packages/context-gate/src`
Expected: no output (exit 1 from grep). Any hit is a leftover to fix before proceeding.

- [ ] **Step 7: Build the new package in isolation**

Run: `pnpm --filter @megasaver/context-gate build`
Expected: tsup emits `dist/index.js` + `dist/index.d.ts`; ends `⚡️ Build success`. (Build resolves the 5 `@megasaver/*` deps from their already-built `dist/`; if a dep's dist is stale run `pnpm build` once first.)

- [ ] **Step 8: Typecheck the new package**

Run: `pnpm --filter @megasaver/context-gate typecheck`
Expected: exit 0, no diagnostics.

- [ ] **Step 9: Commit the inversion fix**

```bash
git add packages/context-gate/src
git commit -m "refactor(context-gate): replace CoreRegistry import with structural port"
```

---

### Task 4: Wire the `@megasaver/core` re-export (consumer strategy (a))

**Files:**
- Create: `packages/core/src/context-gate.ts` (re-export barrel, replacing the moved-away file)
- Modify: `packages/core/package.json` (add the dependency)

- [ ] **Step 1: Recreate the core barrel as a re-export**

`packages/core/src/context-gate.ts` (NEW — same path as the moved-away file, now a one-line re-export so `packages/core/src/index.ts`'s `export * from "./context-gate.js";` keeps resolving and every consumer's `from "@megasaver/core"` import is unchanged):

```ts
export * from "@megasaver/context-gate";
```

- [ ] **Step 2: Add the dependency to core's package.json**

In `packages/core/package.json`, insert `"@megasaver/context-gate": "workspace:*",` into `dependencies` in alphabetical position (before `@megasaver/content-store`):

```json
  "dependencies": {
    "@megasaver/content-store": "workspace:*",
    "@megasaver/context-gate": "workspace:*",
    "@megasaver/output-filter": "workspace:*",
    "@megasaver/policy": "workspace:*",
    "@megasaver/shared": "workspace:*",
    "@megasaver/stats": "workspace:*",
    "zod": "^3.24.1"
  },
```

- [ ] **Step 3: Re-link the new dependency**

Run: `pnpm install`
Expected: ends `Done in …`; `pnpm-lock.yaml` gains the `@megasaver/core → @megasaver/context-gate` edge.

- [ ] **Step 4: Build core and confirm the re-export resolves**

Run: `pnpm --filter @megasaver/core build`
Expected: `⚡️ Build success`. (Core's `context-gate.ts` now pulls the orchestrator from the new package's `dist`.)

- [ ] **Step 5: Confirm the public surface is byte-identical via a smoke import**

Run: `pnpm --filter @megasaver/core exec node -e "import('@megasaver/core').then(m => console.log(['runOutputPipeline','runOutputExecCommand','fetchChunk','locateChunkSet','resolveEffectiveSettings','runTwoGates','readAndFilter','persistChunkSet','defaultNow','defaultNewId'].every(k => typeof m[k] === 'function') ? 'surface-ok' : 'surface-MISSING'))"`
Expected: prints `surface-ok` (all 10 runtime exports still reachable from `@megasaver/core`).

- [ ] **Step 6: Commit the re-export wiring**

```bash
git add packages/core/src/context-gate.ts packages/core/package.json pnpm-lock.yaml
git commit -m "refactor(core): re-export context-gate from @megasaver/context-gate"
```

---

### Task 5: Repoint the core-resident orchestrator tests

The three registry-coupled tests stay in `packages/core/test/context-gate/` (they test core's composed surface + own the registry). Two of them (`run.test.ts`, `read.test.ts`) import the orchestrator via the core barrel `../../src/index.js` and need NO edit. `run-command.test.ts` has one DEEP import into the now-deleted `../../src/context-gate/run-command.js` and must be repointed.

**Files:**
- Modify: `packages/core/test/context-gate/run-command.test.ts` (line 7)

- [ ] **Step 1: Repoint the one deep import in `run-command.test.ts`**

Old (line 7):
```ts
import { type RunCommandSpawn, runOutputExecCommand } from "../../src/context-gate/run-command.js";
```
New:
```ts
import { type RunCommandSpawn, runOutputExecCommand } from "@megasaver/context-gate";
```

(Line 8 — `import { createJsonDirectoryCoreRegistry } from "../../src/index.js";` — is UNCHANGED: the registry is a core symbol and these tests legitimately consume it from core.)

- [ ] **Step 2: Confirm no other core test reaches into the deleted dir**

Run: `grep -rn 'src/context-gate/' packages/core/test`
Expected: no output (exit 1). The barrel imports `../../src/index.js` in `run.test.ts` + `read.test.ts` are fine and remain.

- [ ] **Step 3: Run the three core-resident orchestrator tests**

Run: `pnpm --filter @megasaver/core test -- context-gate/run.test.ts context-gate/read.test.ts context-gate/run-command.test.ts`
Expected: all three files pass (the same assertions as before the move; `runOutputExecCommand` now comes from `@megasaver/context-gate`, `createJsonDirectoryCoreRegistry` from core — and `CoreRegistry` structurally satisfies `OrchestratorRegistry`, so the call sites type-check unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/context-gate/run-command.test.ts
git commit -m "test(core): repoint run-command orchestrator test to @megasaver/context-gate"
```

---

### Task 6: Move the registry-free tests into the new package

**Files:**
- Move: `packages/core/test/context-gate/fetch-chunk.test.ts` → `packages/context-gate/test/fetch-chunk.test.ts`
- Move: `packages/core/test/context-gate/locate-chunk-set.test.ts` → `packages/context-gate/test/locate-chunk-set.test.ts`

- [ ] **Step 1: git mv the two registry-free tests**

```bash
git mv packages/core/test/context-gate/fetch-chunk.test.ts      packages/context-gate/test/fetch-chunk.test.ts
git mv packages/core/test/context-gate/locate-chunk-set.test.ts packages/context-gate/test/locate-chunk-set.test.ts
```
Expected: no output, exit 0.

- [ ] **Step 2: Repoint `fetch-chunk.test.ts` import**

In `packages/context-gate/test/fetch-chunk.test.ts`, old (line 5):
```ts
import { fetchChunk } from "../../src/index.js";
```
New (now one directory level shallower, into this package's own src):
```ts
import { fetchChunk } from "../src/index.js";
```

- [ ] **Step 3: Repoint `locate-chunk-set.test.ts` import**

In `packages/context-gate/test/locate-chunk-set.test.ts`, old (line 4):
```ts
import { locateChunkSet } from "@megasaver/core";
```
New:
```ts
import { locateChunkSet } from "../src/index.js";
```

- [ ] **Step 4: Run the moved tests from their new home**

Run: `pnpm --filter @megasaver/context-gate test -- fetch-chunk.test.ts locate-chunk-set.test.ts`
Expected: both files pass with the same assertions as before.

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/test/fetch-chunk.test.ts packages/context-gate/test/locate-chunk-set.test.ts
git commit -m "test(context-gate): move registry-free orchestrator tests into package"
```

---

### Task 7: Relocate + rewrite the dependency-direction guard

**Files:**
- Move: `packages/core/test/context-gate/dependency-direction.test.ts` → `packages/context-gate/test/dependency-direction.test.ts`
- Rewrite the moved file to assert the NEW package's `package.json`.

- [ ] **Step 1: git mv the guard**

```bash
git mv packages/core/test/context-gate/dependency-direction.test.ts packages/context-gate/test/dependency-direction.test.ts
```
Expected: no output, exit 0.

- [ ] **Step 2: Confirm the test currently FAILS in its new home (TDD red)**

The moved file still reads `../../package.json` (core's) and asserts core's allow-list. From `packages/context-gate/test/` that path resolves to `packages/package.json` (does not exist) — the test errors. Run:

Run: `pnpm --filter @megasaver/context-gate test -- dependency-direction.test.ts`
Expected: FAIL (ENOENT on `../../package.json`, i.e. `packages/package.json`). This confirms the relocation needs the rewrite below.

- [ ] **Step 3: Rewrite the guard for `@megasaver/context-gate`**

Replace the entire contents of `packages/context-gate/test/dependency-direction.test.ts`. The allow-list is the AA1 §3c set the orchestrator was already constrained to (content-store, output-filter, policy, shared, stats) plus `zod` (kept to match the relocated source allow-list and core's own context-gate guard verbatim). Path is `../package.json` (one level shallower than core's `../../package.json`, matching the output-filter/stats dep-graph tests).

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @megasaver/context-gate (BB12) holds the extracted orchestrator. Its deps are
// the AA1 §3c allow-list the core-folded orchestrator already used: it composes
// policy, output-filter, content-store, and stats and returns data — it MUST NOT
// import @megasaver/core (the make-or-break inversion; the orchestrator reads a
// structural OrchestratorRegistry port, not core's CoreRegistry), nor mcp-bridge,
// nor any app. core -> context-gate (re-export) stays acyclic because the reverse
// edge does not exist.
const ALLOWED_DEPENDENCIES = [
  "@megasaver/content-store",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/shared",
  "@megasaver/stats",
  "zod",
];

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe("@megasaver/context-gate dependency direction (§3c cycle guard)", () => {
  it("declares dependencies as a subset of the allow-list", () => {
    const deps = Object.keys(packageJson.dependencies ?? {});
    for (const dep of deps) {
      expect(ALLOWED_DEPENDENCIES).toContain(dep);
    }
  });

  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });

  it("does not depend on @megasaver/core (the inversion guard)", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    expect(all).not.toContain("@megasaver/core");
  });

  it("does not depend on @megasaver/mcp-bridge", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    expect(all).not.toContain("@megasaver/mcp-bridge");
  });

  it("does not depend on any apps/* package", () => {
    const all = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    for (const dep of all) {
      expect(dep.startsWith("@megasaver/cli")).toBe(false);
      expect(dep.startsWith("@megasaver/gui")).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Run the guard (TDD green)**

Run: `pnpm --filter @megasaver/context-gate test -- dependency-direction.test.ts`
Expected: PASS — all 5 cases green (deps exactly {content-store, output-filter, policy, shared, stats, zod}; no core/mcp-bridge/apps).

- [ ] **Step 5: Commit**

```bash
git add packages/context-gate/test/dependency-direction.test.ts
git commit -m "test(context-gate): relocate dependency-direction guard to new package"
```

---

### Task 8: Changeset + full verify + §2a record

**Files:**
- Create: `.changeset/bb12-context-gate-extract.md`

- [ ] **Step 1: Write the changeset**

`.changeset/bb12-context-gate-extract.md` (new public package → `minor`; core's public surface is structurally identical but its re-export source moved → `patch`; mirrors the frontmatter shape of `.changeset/bb7b-output-exec.md`):

```md
---
"@megasaver/context-gate": minor
"@megasaver/core": patch
---

Extract the context-gate orchestrator out of `@megasaver/core` into a
standalone `@megasaver/context-gate` package (AA1 BB12 — §2a
deferred-extraction trigger fired: 553 LOC > 500). Behavior-preserving:
the orchestrator's `context-gate -> core` edge (a type-only `CoreRegistry`
import in 4 files) is broken by a 3-property structural `OrchestratorRegistry`
port defined in the new package; core's `CoreRegistry` structurally
satisfies it, so no call site changes. `@megasaver/core` now re-exports the
orchestrator from `@megasaver/context-gate`, so `apps/cli` and
`@megasaver/mcp-bridge` consumers keep importing `runOutputPipeline`,
`runOutputExecCommand`, `fetchChunk`, and `locateChunkSet` from
`@megasaver/core` unchanged. No runtime behavior changes.
```

- [ ] **Step 2: Run the full workspace verify (DoD gate)**

Run: `pnpm verify`
Expected: lint + typecheck + test all green across every package. In particular:
- `@megasaver/context-gate`: `fetch-chunk`, `locate-chunk-set`, `dependency-direction` pass; build emits dist.
- `@megasaver/core`: `run`, `read`, `run-command` (under `test/context-gate/`) pass; no dangling `src/context-gate/` import.
- consumers (`apps/cli`, `@megasaver/mcp-bridge`): unchanged, still green.
- no cycle reported.

- [ ] **Step 3: Confirm no cycle via the relocated guard + a core check**

Run: `pnpm --filter @megasaver/context-gate test -- dependency-direction.test.ts && grep -c '@megasaver/core' packages/context-gate/package.json`
Expected: the test passes AND the grep prints `0` (no `@megasaver/core` anywhere in the new package's manifest — neither deps nor devDeps).

- [ ] **Step 4: Capture the §2a record (post-extraction LOC at the new location)**

Run: `wc -l packages/context-gate/src/*.ts`
Expected: the moved files total 553 LOC for the original six (`run` 70, `run-command` 280, `read` 113, `fetch-chunk` 37, `locate-chunk-set` 31, `types` 22) plus `index.ts` (barrel, ~24) and `registry-port.ts` (~22 new). Record this output in the verifier evidence bundle as the AA1 §2a / §20e post-BB7b audit closure: *"trigger fired at 553 LOC in core; extracted to @megasaver/context-gate; new location count attached."*

- [ ] **Step 5: Commit the changeset**

```bash
git add .changeset/bb12-context-gate-extract.md
git commit -m "chore(context-gate): add BB12 extraction changeset"
```

- [ ] **Step 6: Final full-suite confirmation before review handoff**

Run: `pnpm verify`
Expected: green. This is the evidence for CLAUDE.md §9 item 4. Do NOT claim "done" before this passes (CLAUDE.md §9 hard rule).

---

## Self-Review

**1. Spec coverage.** Each SPEC §locked item maps to a task:
- §1 trigger / 553 LOC → Task 8 Step 4 (§2a record).
- §2 inversion check + structural port → Task 3 (create port + repoint 4 files + grep-confirm no core ref).
- §3 new package + deps → Task 1 (scaffold, deps = §3c allow-list).
- §3 consumer strategy (a) (core re-export) → Task 4 (barrel re-export + core dep + surface smoke).
- §3 guard relocation → Task 7 (move + rewrite + green).
- §3 test split (registry-coupled stay, registry-free move) → Task 5 (core tests stay, 1 deep import repointed) + Task 6 (2 tests move).
- §6 DoD: spec/plan exist (this file + the spec); `pnpm verify` green → Task 8 Step 2/6; no cycle → Task 8 Step 3; changeset → Task 8 Step 1; §2a record → Task 8 Step 4.
- Move with history (git mv) → Task 2 + Task 6 + Task 7 all use `git mv`.
No SPEC requirement is left without a task.

**2. Placeholder scan.** No "TBD"/"add appropriate"/"similar to Task N" — every code step shows the full file or the exact old→new edit; every command has expected output. The Task-1 `package.json`, all tsconfigs, tsup, vitest, the `registry-port.ts`, the rewritten barrel, the rewritten dep-direction test, and the changeset are all given in full.

**3. Type consistency.** The structural port names are consistent everywhere: `OrchestratorRegistry` / `SessionView` / `ProjectView` (defined Task 3 Step 1; consumed Task 3 Steps 2–5; re-exported Task 2 Step 3's barrel line and named in the SPEC). The four field edits all change `registry: CoreRegistry` → `registry: OrchestratorRegistry` identically. Public export names in the moved barrel (`runOutputPipeline`, `runOutputExecCommand`, `fetchChunk`, `locateChunkSet`, `resolveEffectiveSettings`, `runTwoGates`, `readAndFilter`, `persistChunkSet`, `defaultNow`, `defaultNewId` + types) match the smoke-import list in Task 4 Step 5 and the changeset prose.

**Fixes applied inline during review:**
- Added the `registry-port.js` re-export line to the moved barrel in Task 2 Step 3 (so the port types are part of the package's public surface, matching SPEC §3 "plus the three port interfaces"), and noted it is created in Task 3.
- Pinned the `zod` decision explicitly (kept, matching the relocated source allow-list + core's own context-gate guard) in both Task 1 Step 2 and Task 7 Step 3, with a documented escape hatch if `pnpm verify` flags it extraneous — closing the only ambiguity in the dep set.
- Made Task 5 explicit that `run.test.ts` + `read.test.ts` need NO edit (barrel import) and only `run-command.test.ts`'s deep import is repointed, preventing an over-eager edit.
- Ordered the commits so `pnpm verify` is never run while imports are dangling (Task 2 note): Task 2 moves, Task 3 fixes the inversion + isolated build, Task 4 wires the re-export, then verify runs full only at Task 8.
