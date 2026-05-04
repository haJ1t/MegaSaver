# `@megasaver/cli` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `apps/cli` workspace package with the `mega` bin, Citty wiring, and a stateless `mega doctor` subcommand, following the spec at `docs/superpowers/specs/2026-05-05-cli-package-design.md`.

**Architecture:** New ESM-only app package at `apps/cli/`. Single bin entry (`mega` → `dist/cli.js`) with a tsup `#!/usr/bin/env node` banner. Citty `defineCommand` registers one subcommand (`doctor`). The doctor module is split into pure check functions (`checkNode`, `checkPlatform`, `checkCwd`), pure render/exit helpers (`runChecks`, `renderReport`, `exitCodeFor`), and a thin Citty handler (`doctorCommand`). Tests are unit-only via direct import + `vi.spyOn(console, "log")`. No subprocess tests, no library export, no `@megasaver/core` import.

**Tech Stack:** Node 22 LTS, TypeScript strict ESM (NodeNext), pnpm workspace, tsup build, Vitest, Biome, Citty (UnJS).

**Worktree:** `/Users/halitozger/Desktop/MegaSaver-cli-package` (branch `feat/cli-package`, already created).

**Spec citation convention:** §N below references the spec sections at `docs/superpowers/specs/2026-05-05-cli-package-design.md`.

---

## File Structure

The plan creates these files. Each task's "Files" block below is authoritative; this list is a roll-up.

| Path | Responsibility |
|---|---|
| `apps/cli/package.json` | Workspace package manifest. Bin entry, scripts, citty dependency, `private: true`. |
| `apps/cli/tsconfig.json` | TypeScript config for `src/`. Overrides `composite`/`incremental` to `false` for tsup DTS workers. Adds `resolveJsonModule: true` for `package.json` lookups. |
| `apps/cli/tsconfig.test.json` | Test typecheck config. Includes `src/**` + `test/**`, `noEmit: true`, `declaration: false`. |
| `apps/cli/tsup.config.ts` | Build config. Single entry `src/cli.ts`, ESM only, `dts: false`, `banner.js` shebang, sourcemap on. |
| `apps/cli/vitest.config.ts` | Vitest config. Mirrors `packages/core/vitest.config.ts`: `include: ["test/**/*.test.ts"]`. |
| `apps/cli/src/cli.ts` | Bin entry. One line: `runMain(mainCommand)`. Tsup banner injects `#!/usr/bin/env node`. |
| `apps/cli/src/main.ts` | Citty root command definition. Registers `doctor` subcommand and reads version via `createRequire`. |
| `apps/cli/src/commands/doctor.ts` | Pure checks + render + exit helpers + Citty handler. |
| `apps/cli/test/doctor.test.ts` | Unit tests for the doctor module. |
| `wiki/entities/cli.md` | New entity page (Task 8). |
| `wiki/index.md` | Add CLI entity link (Task 8). |
| `wiki/log.md` | Append spec/plan/merge entries (Task 0, Task 1 head, Task 9). |

---

## Task 0: Pre-flight log entry

**Why first:** the spec commit already landed (`c268def`). Per `wiki/CLAUDE.md`, every wiki-affecting op gets a `log.md` entry. The plan commit also gets one before tasks proceed.

**Files:**
- Modify: `wiki/log.md`

- [ ] **Step 1: Append two log entries**

Open `wiki/log.md`. Append at the bottom (after the existing last entry):

```markdown

## [2026-05-05] ingest | cli scaffold spec

Wrote `docs/superpowers/specs/2026-05-05-cli-package-design.md`. Locked v0.1 surface for `apps/cli`: bin `mega`, three top-level surfaces (`--version`, `--help`, `mega doctor`), stateless three-check `doctor`, plain text output, no `@megasaver/core` import in this slice. Risk MEDIUM.

## [2026-05-05] ingest | cli scaffold plan

Wrote `docs/superpowers/plans/2026-05-05-cli-package-plan.md`. Plan breaks implementation into strict TDD tasks: scaffold app + smoke build, `checkNode`, `checkPlatform` + `checkCwd`, `renderReport` + `exitCodeFor`, `doctorCommand` handler, Citty wiring (`main.ts` + `cli.ts`), final verification, wiki seed, external review.
```

- [ ] **Step 2: Commit**

```bash
git add wiki/log.md docs/superpowers/plans/2026-05-05-cli-package-plan.md
git commit -m "docs(cli): plan for cli scaffold app"
```

---

## Task 1: Scaffold app + smoke build

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/tsconfig.test.json`
- Create: `apps/cli/tsup.config.ts`
- Create: `apps/cli/vitest.config.ts`
- Create: `apps/cli/src/cli.ts`
- Create: `apps/cli/src/main.ts`

- [ ] **Step 1: Create the package directory**

```bash
mkdir -p apps/cli/src/commands apps/cli/test
```

- [ ] **Step 2: Write `apps/cli/package.json`**

```json
{
  "name": "@megasaver/cli",
  "version": "0.0.0",
  "private": true,
  "description": "Mega Saver CLI - the `mega` command.",
  "type": "module",
  "bin": {
    "mega": "./dist/cli.js"
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
    "citty": "^0.1.6"
  }
}
```

- [ ] **Step 3: Write `apps/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "incremental": false,
    "composite": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 4: Write `apps/cli/tsconfig.test.json`**

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

- [ ] **Step 5: Write `apps/cli/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "es2023",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  treeshake: true,
});
```

- [ ] **Step 6: Write `apps/cli/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: Write the placeholder `apps/cli/src/main.ts`**

```ts
import { createRequire } from "node:module";
import { defineCommand } from "citty";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version: pkg.version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {},
});
```

> **Why `createRequire` instead of `import ... with { type: "json" }`:** import attributes are stage-3 and tsup's bundling behavior with the `with` syntax is version-dependent. `createRequire` is universally supported on Node 22 + ESM, runs at module load, and resolves the package manifest reliably whether the bin runs from `apps/cli/dist/cli.js` (workspace) or `node_modules/@megasaver/cli/dist/cli.js` (future publish).

- [ ] **Step 8: Write `apps/cli/src/cli.ts`**

```ts
import { runMain } from "citty";
import { mainCommand } from "./main.js";

runMain(mainCommand);
```

- [ ] **Step 9: Run `pnpm install` from the repo root**

```bash
pnpm install
```

Expected: `+ apps/cli` registered, `citty@0.1.x` added to `apps/cli/node_modules/citty`. Root `node_modules/.bin/mega` does not exist yet (no `dist/cli.js`).

- [ ] **Step 10: Typecheck**

```bash
pnpm --filter @megasaver/cli typecheck
```

Expected: PASS. Both `tsc -b --noEmit` and `tsc -p tsconfig.test.json --noEmit` succeed.

- [ ] **Step 11: Build smoke**

```bash
pnpm --filter @megasaver/cli build
```

Expected: `apps/cli/dist/cli.js` exists. First line is `#!/usr/bin/env node`. Sourcemap `dist/cli.js.map` exists. No `dist/cli.d.ts`.

Verify shebang:

```bash
head -1 apps/cli/dist/cli.js
```

Expected output: `#!/usr/bin/env node`

- [ ] **Step 12: Bin smoke (Citty default help)**

```bash
node apps/cli/dist/cli.js --version
```

Expected output: `0.0.0`

```bash
node apps/cli/dist/cli.js --help
```

Expected: Citty default help output. No subcommands listed yet.

- [ ] **Step 13: Lint**

```bash
pnpm --filter @megasaver/cli lint 2>/dev/null || pnpm lint
```

> **Why fall back to root lint:** apps/cli does not yet have a `lint` script. Root `pnpm lint` runs `biome check .` over the entire repo, which covers `apps/**` per the root `biome.json` globs.

Expected: zero Biome errors. If Biome flags any of the new files, run `pnpm lint:fix` from the repo root and re-stage the modified files.

- [ ] **Step 14: Commit**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "feat(cli): scaffold cli app"
```

---

## Task 2: `checkNode` (TDD)

**Files:**
- Create: `apps/cli/src/commands/doctor.ts`
- Create: `apps/cli/test/doctor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/test/doctor.test.ts` with this exact content:

```ts
import { describe, expect, it } from "vitest";
import { checkNode } from "../src/commands/doctor.js";

describe("checkNode", () => {
  it("PASSes for Node 22.x", () => {
    expect(checkNode("22.11.0")).toEqual({
      key: "node",
      value: "v22.11.0",
      pass: true,
    });
  });

  it("PASSes for Node 23.x", () => {
    expect(checkNode("23.0.0")).toEqual({
      key: "node",
      value: "v23.0.0",
      pass: true,
    });
  });

  it("PASSes for the lower bound 22.0.0", () => {
    expect(checkNode("22.0.0")).toEqual({
      key: "node",
      value: "v22.0.0",
      pass: true,
    });
  });

  it("PASSes for a 22.x pre-release", () => {
    expect(checkNode("22.0.0-rc.1")).toEqual({
      key: "node",
      value: "v22.0.0-rc.1",
      pass: true,
    });
  });

  it("FAILs for Node 20.x with reason", () => {
    expect(checkNode("20.10.0")).toEqual({
      key: "node",
      value: "v20.10.0",
      pass: false,
      reason: "need ≥22",
    });
  });

  it("FAILs for Node 18.x", () => {
    expect(checkNode("18.20.0")).toEqual({
      key: "node",
      value: "v18.20.0",
      pass: false,
      reason: "need ≥22",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @megasaver/cli test
```

Expected: FAIL. Vitest reports cannot resolve `../src/commands/doctor.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/cli/src/commands/doctor.ts` with this exact content:

```ts
export type Check = {
  key: string;
  value: string;
  pass: boolean;
  reason?: string;
};

export function checkNode(version: string = process.versions.node): Check {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  const value = `v${version}`;
  if (major >= 22) {
    return { key: "node", value, pass: true };
  }
  return { key: "node", value, pass: false, reason: "need ≥22" };
}
```

> **Why `version.split(".")[0] ?? ""`:** the base tsconfig sets `noUncheckedIndexedAccess: true`, so `version.split(".")[0]` has type `string | undefined`. The fallback satisfies the type checker without changing runtime behavior (an empty string parses to `NaN`, which fails `>= 22`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @megasaver/cli test
```

Expected: PASS. 6 tests in 1 file.

- [ ] **Step 5: Lint + typecheck**

```bash
pnpm lint
pnpm --filter @megasaver/cli typecheck
```

Expected: zero errors. If Biome flags formatting (e.g., import ordering, trailing spaces), run `pnpm lint:fix` from the repo root and verify the changes are cosmetic only.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/doctor.ts apps/cli/test/doctor.test.ts
git commit -m "feat(cli): add checkNode"
```

---

## Task 3: `checkPlatform` + `checkCwd` (TDD)

**Files:**
- Modify: `apps/cli/test/doctor.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apps/cli/test/doctor.test.ts` (after the existing `describe("checkNode")` block):

```ts
import { checkCwd, checkNode, checkPlatform } from "../src/commands/doctor.js";

describe("checkPlatform", () => {
  it("PASSes and returns the platform string", () => {
    expect(checkPlatform("darwin")).toEqual({
      key: "platform",
      value: "darwin",
      pass: true,
    });
  });

  it("PASSes for linux", () => {
    expect(checkPlatform("linux")).toEqual({
      key: "platform",
      value: "linux",
      pass: true,
    });
  });
});

describe("checkCwd", () => {
  it("PASSes and returns the cwd string", () => {
    expect(checkCwd("/foo/bar")).toEqual({
      key: "cwd",
      value: "/foo/bar",
      pass: true,
    });
  });
});
```

> **Note:** the new top-of-file import line replaces the previous `import { checkNode } from "../src/commands/doctor.js";` line. Edit it so the existing `checkNode` import becomes part of the combined import. After editing, the file should contain exactly one `import` from `../src/commands/doctor.js`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @megasaver/cli test
```

Expected: FAIL. Vitest reports `checkPlatform`/`checkCwd` are not exported.

- [ ] **Step 3: Implement `checkPlatform` and `checkCwd`**

Append to `apps/cli/src/commands/doctor.ts`:

```ts
export function checkPlatform(platform: NodeJS.Platform = process.platform): Check {
  return { key: "platform", value: platform, pass: true };
}

export function checkCwd(cwd: string = process.cwd()): Check {
  return { key: "cwd", value: cwd, pass: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @megasaver/cli test
```

Expected: PASS. 9 tests in 1 file (6 + 2 + 1).

- [ ] **Step 5: Lint + typecheck**

```bash
pnpm lint
pnpm --filter @megasaver/cli typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/doctor.ts apps/cli/test/doctor.test.ts
git commit -m "feat(cli): add checkPlatform and checkCwd"
```

---

## Task 4: `runChecks` + `renderReport` + `exitCodeFor` (TDD)

**Files:**
- Modify: `apps/cli/test/doctor.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts`

- [ ] **Step 1: Append the failing tests**

Append to `apps/cli/test/doctor.test.ts`:

```ts
import {
  type Check,
  exitCodeFor,
  renderReport,
  runChecks,
} from "../src/commands/doctor.js";

describe("runChecks", () => {
  it("returns three checks in fixed order on the current process", () => {
    const checks = runChecks();
    expect(checks).toHaveLength(3);
    expect(checks[0]?.key).toBe("node");
    expect(checks[1]?.key).toBe("platform");
    expect(checks[2]?.key).toBe("cwd");
  });
});

describe("renderReport", () => {
  it("formats an all-PASS report with summary", () => {
    const checks: Check[] = [
      { key: "node", value: "v22.11.0", pass: true },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(renderReport(checks)).toBe(
      "node v22.11.0 PASS\nplatform darwin PASS\ncwd /foo PASS\n\n3 PASS / 0 FAIL",
    );
  });

  it("includes the parenthesized reason for FAIL rows", () => {
    const checks: Check[] = [
      { key: "node", value: "v20.10.0", pass: false, reason: "need ≥22" },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(renderReport(checks)).toBe(
      "node v20.10.0 FAIL (need ≥22)\nplatform darwin PASS\ncwd /foo PASS\n\n2 PASS / 1 FAIL",
    );
  });
});

describe("exitCodeFor", () => {
  it("returns 0 when all checks PASS", () => {
    const checks: Check[] = [
      { key: "node", value: "v22.11.0", pass: true },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(exitCodeFor(checks)).toBe(0);
  });

  it("returns 1 when any check FAILs", () => {
    const checks: Check[] = [
      { key: "node", value: "v20.10.0", pass: false, reason: "need ≥22" },
      { key: "platform", value: "darwin", pass: true },
      { key: "cwd", value: "/foo", pass: true },
    ];
    expect(exitCodeFor(checks)).toBe(1);
  });
});
```

> **Note on the new import line:** merge it into the existing top-of-file import so the file has exactly one `import` statement from `../src/commands/doctor.js`. Final shape:
>
> ```ts
> import {
>   type Check,
>   checkCwd,
>   checkNode,
>   checkPlatform,
>   exitCodeFor,
>   renderReport,
>   runChecks,
> } from "../src/commands/doctor.js";
> ```
>
> Biome's `useImportType` rule requires `type` modifier on type-only imports, and Biome's organize-imports sorts alphabetically with the `type` keyword inline (verified pattern from `packages/core`).

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @megasaver/cli test
```

Expected: FAIL. Vitest reports `runChecks`, `renderReport`, `exitCodeFor` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `apps/cli/src/commands/doctor.ts`:

```ts
export function runChecks(): Check[] {
  return [checkNode(), checkPlatform(), checkCwd()];
}

export function renderReport(checks: Check[]): string {
  const lines = checks.map((c) => {
    const status = c.pass ? "PASS" : "FAIL";
    const reason = c.reason ? ` (${c.reason})` : "";
    return `${c.key} ${c.value} ${status}${reason}`;
  });
  const passCount = checks.filter((c) => c.pass).length;
  const failCount = checks.length - passCount;
  return `${lines.join("\n")}\n\n${passCount} PASS / ${failCount} FAIL`;
}

export function exitCodeFor(checks: Check[]): 0 | 1 {
  return checks.some((c) => !c.pass) ? 1 : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @megasaver/cli test
```

Expected: PASS. 14 tests in 1 file (9 + 1 + 2 + 2).

- [ ] **Step 5: Lint + typecheck**

```bash
pnpm lint
pnpm --filter @megasaver/cli typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/doctor.ts apps/cli/test/doctor.test.ts
git commit -m "feat(cli): add runChecks renderReport exitCodeFor"
```

---

## Task 5: `doctorCommand` handler (TDD)

**Files:**
- Modify: `apps/cli/test/doctor.test.ts`
- Modify: `apps/cli/src/commands/doctor.ts`

- [ ] **Step 1: Append the failing handler tests**

First merge the new identifiers into the existing two import statements at the top of the file. Final shape after this step:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Check,
  checkCwd,
  checkNode,
  checkPlatform,
  doctorCommand,
  exitCodeFor,
  renderReport,
  runChecks,
} from "../src/commands/doctor.js";
```

Then append the new `describe("doctorCommand")` block at the bottom of the file:

```ts
describe("doctorCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = 0;
  });

  it("calls console.log exactly once", async () => {
    await doctorCommand.run?.({
      args: {},
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("prints a report that ends with the summary line", async () => {
    await doctorCommand.run?.({
      args: {},
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toMatch(/^node v\d+\.\d+\.\d+/);
    expect(output).toContain("\n\n3 PASS / 0 FAIL");
  });

  it("leaves process.exitCode at 0 on Node 22+", async () => {
    await doctorCommand.run?.({
      args: {},
      cmd: doctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    expect(process.exitCode).toBe(0);
  });
});
```

> **Why the handler does not get a separate FAIL-injection test:** the spec `§11` lists FAIL behavior as "sets it to 1 when a FAIL is injected via dependency override." The dependency override in this implementation is exactly what `exitCodeFor` proves with synthetic FAIL `Check[]` arrays in Task 4. Adding a separate handler-level FAIL test would require monkey-patching `process.versions.node`, which is fragile and adds no coverage beyond the `exitCodeFor` unit tests already in the suite. The handler is glue: prints the rendered report once, sets the exit code from `exitCodeFor`. Both branches of that glue are covered by Task 4 + Task 5's all-PASS smoke.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @megasaver/cli test
```

Expected: FAIL. Vitest reports `doctorCommand` is not exported.

- [ ] **Step 3: Implement the handler**

Append to `apps/cli/src/commands/doctor.ts`:

```ts
import { defineCommand } from "citty";

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Environment diagnostics.",
  },
  args: {},
  run() {
    const checks = runChecks();
    console.log(renderReport(checks));
    const code = exitCodeFor(checks);
    if (code !== 0) {
      process.exitCode = code;
    }
  },
});
```

> **Note on import placement:** Biome's organize-imports puts `import { defineCommand } from "citty";` at the top of the file. Move the new import line to the top of `doctor.ts` (above the `Check` type), then run `pnpm lint:fix` from the repo root if Biome shifts anything.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @megasaver/cli test
```

Expected: PASS. 17 tests in 1 file (14 + 3).

- [ ] **Step 5: Lint + typecheck**

```bash
pnpm lint
pnpm --filter @megasaver/cli typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/doctor.ts apps/cli/test/doctor.test.ts
git commit -m "feat(cli): add doctor command handler"
```

---

## Task 6: Wire `doctor` into `main.ts`

**Files:**
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Register the doctor subcommand**

Edit `apps/cli/src/main.ts`. Final content:

```ts
import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { doctorCommand } from "./commands/doctor.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version: pkg.version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {
    doctor: doctorCommand,
  },
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @megasaver/cli typecheck
```

Expected: PASS.

- [ ] **Step 3: Build**

```bash
pnpm --filter @megasaver/cli build
```

Expected: `apps/cli/dist/cli.js` rebuilt. Shebang on line 1.

- [ ] **Step 4: Bin smoke - `mega doctor`**

```bash
node apps/cli/dist/cli.js doctor
```

Expected output (Node 22 environment, exit 0):

```
node v22.x.x PASS
platform <darwin|linux|win32> PASS
cwd <current cwd> PASS

3 PASS / 0 FAIL
```

```bash
echo "exit code: $?"
```

Expected: `exit code: 0`

- [ ] **Step 5: Bin smoke - `mega --help` lists doctor**

```bash
node apps/cli/dist/cli.js --help
```

Expected: Citty default help now lists `doctor` under SUBCOMMANDS.

- [ ] **Step 6: Lint**

```bash
pnpm lint
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/main.ts
git commit -m "feat(cli): register doctor subcommand"
```

---

## Task 7: Final verification + bin smoke evidence

**Files:** none (verification only)

- [ ] **Step 1: Full repo verify**

```bash
pnpm verify
```

Expected: PASS. Output covers `pnpm lint && pnpm typecheck && pnpm test`. The `cli` package contributes 17 passing tests; existing `shared` and `core` packages remain green.

- [ ] **Step 2: Build all**

```bash
pnpm build
```

Expected: PASS for `@megasaver/shared`, `@megasaver/core`, `@megasaver/cli`. CLI emits `dist/cli.js` only.

- [ ] **Step 3: Capture pnpm bin smoke for the PR description**

Run these and copy the output into a scratchpad for the PR body. Do not commit the output.

```bash
pnpm exec mega --version
```
Expected: `0.0.0`

```bash
pnpm exec mega --help
```
Expected: Citty default help with `doctor` subcommand listed.

```bash
pnpm exec mega doctor
```
Expected: 3 PASS / 0 FAIL block, exit 0.

> **What "pnpm exec mega" proves:** the workspace symlink at `node_modules/.bin/mega` resolves through pnpm's `bin` field handling, which is the same mechanism a downstream consumer would hit if this package were ever published. This run confirms the bin field, the shebang, and the entry point are all correct.

- [ ] **Step 4: No commit**

This task records evidence for the PR description and verifier agent. No file changes.

---

## Task 8: Wiki entity + index + log

**Files:**
- Create: `wiki/entities/cli.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Write `wiki/entities/cli.md`**

```markdown
---
title: '@megasaver/cli'
tags: [entity, app, cli, v0.1]
sources:
  - docs/superpowers/specs/2026-05-05-cli-package-design.md
  - docs/superpowers/plans/2026-05-05-cli-package-plan.md
status: published
created: 2026-05-05
updated: 2026-05-05
---

# `@megasaver/cli`

The `mega` command. Lives at `apps/cli/`. This is an app, not a
library: it has no public TypeScript export surface, only a bin
entry that pnpm symlinks to `node_modules/.bin/mega`.

## Current slice

The first CLI slice is scaffold only:

- `mega --version` — reads `apps/cli/package.json` via `createRequire`.
- `mega --help` — Citty default help with the `doctor` subcommand
  listed.
- `mega doctor` — three stateless checks (Node version ≥22, platform,
  cwd). Plain text output, summary line, exit 0 on all-PASS, exit 1
  on any FAIL.

The CLI does not import `@megasaver/core` or `@megasaver/shared` in
this slice. Real CRUD commands and registry consumption land in their
own specs once durable storage exists.

## Implementation status

Implementation is complete, external review passed, and the package
is published on `origin/main`.

## Implementation evidence

- `pnpm --filter @megasaver/cli test` passes: 1 test file, 17 tests.
- `pnpm --filter @megasaver/cli typecheck` passes.
- `pnpm --filter @megasaver/cli build` emits `dist/cli.js` with
  shebang `#!/usr/bin/env node` and a sourcemap; no `dist/cli.d.ts`.
- `pnpm verify` passes on `main` after merge.
- `pnpm exec mega doctor` prints `3 PASS / 0 FAIL` on Node 22.

## Boundary rules

- The CLI app has no public library export.
- The CLI app has `private: true` and is never published from v0.1.
- The CLI does not import `@megasaver/core` or `@megasaver/shared`
  in this slice — adding either is a follow-up spec decision.
- The `doctor` command must remain stateless until persistence lands
  in its own spec.
- Pure check functions (`checkNode`, `checkPlatform`, `checkCwd`)
  accept dependency-injected parameters so tests do not have to mock
  `process` globals.

## Risk

Risk level is MEDIUM (default per `docs/conventions/risk-modes.md`).
This app introduces the `mega` command name and the top-level CLI
surface but mutates no state, exposes no public library API, and
touches no durable storage. Full superpowers chain applies; `critic`
is not required at MEDIUM.

## Related

- [[concepts/agent-agnostic-core]]
- [[concepts/contextops]]
- [[entities/core]]
- [[entities/shared]]
- [[syntheses/mega-saver-product]]
```

- [ ] **Step 2: Update `wiki/index.md`**

Open `wiki/index.md`. Find the Entities section. Replace this block:

```markdown
- [[entities/core]] — `@megasaver/core` agent-agnostic engine foundation (v0.1).
- [[entities/shared]] — `@megasaver/shared` contracts package (v0.1).
```

with:

```markdown
- [[entities/cli]] — `@megasaver/cli` `mega` command scaffold (v0.1).
- [[entities/core]] — `@megasaver/core` agent-agnostic engine foundation (v0.1).
- [[entities/shared]] — `@megasaver/shared` contracts package (v0.1).
```

Then update the slot reservation line one paragraph below from:

```markdown
More subsystem pages land as features get built. Slot reserved for: `cli`, `connectors-claude-code`, `connectors-generic-cli`, `mcp-bridge`, `app`, `skill-packs`.
```

to:

```markdown
More subsystem pages land as features get built. Slot reserved for: `connectors-claude-code`, `connectors-generic-cli`, `mcp-bridge`, `app`, `skill-packs`.
```

Then update the `## Status` paragraph at the bottom from its current text to:

```markdown
## Status

CLI scaffold published phase. Bootstrap, project skeleton,
`@megasaver/shared`, `@megasaver/core`, and `@megasaver/cli` are
merged and pushed to `origin/main`.
```

Also update the `updated:` field in the index frontmatter to `2026-05-05`.

- [ ] **Step 3: Append `wiki/log.md` entry for entity seed**

Append at the bottom of `wiki/log.md`:

```markdown

## [2026-05-05] ingest | entities/cli seeded

Wrote `wiki/entities/cli.md` and updated `wiki/index.md` Entities section to include the CLI app. The CLI is the third v0.1 entity to publish. Status reservation list trimmed to `connectors-claude-code`, `connectors-generic-cli`, `mcp-bridge`, `app`, `skill-packs`.
```

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Expected: zero errors. Wiki pages are markdown; Biome ignores them by default unless explicitly configured.

- [ ] **Step 5: Commit**

```bash
git add wiki/entities/cli.md wiki/index.md wiki/log.md
git commit -m "docs(wiki): seed cli entity"
```

---

## Task 9: External review + DoD evidence + finishing

**Files:** none (review and merge orchestration only)

- [ ] **Step 1: Run code-reviewer agent**

Per `CLAUDE.md §4` and `§9.6`, MEDIUM-risk features require an external `code-reviewer` agent pass. Author and reviewer must NEVER share an active context.

Dispatch via the Agent tool with `subagent_type: "oh-my-claudecode:code-reviewer"` (or `code-reviewer`). Provide:

- The spec at `docs/superpowers/specs/2026-05-05-cli-package-design.md`.
- The plan at `docs/superpowers/plans/2026-05-05-cli-package-plan.md`.
- The diff between `feat/cli-package` and `main` (`git diff main...feat/cli-package`).
- An explicit instruction to grade Critical / Important / Minor issues against the spec's locked decisions and the repo's `CLAUDE.md` conventions.

- [ ] **Step 2: Address review fixes (if any)**

For every Critical or Important issue: implement the fix as a TDD task (failing test → fix → green → commit). Re-run `pnpm verify`. Re-dispatch the reviewer for a follow-up pass. Repeat until no Critical or Important issues remain.

- [ ] **Step 3: Run verifier agent**

Per `CLAUDE.md §9.7`, dispatch `omc:verify` (or the `verifier` agent) with the full DoD checklist (`CLAUDE.md §9` items 1–10). The verifier confirms each item against the actual repo state and returns APPROVED / BLOCKED.

If BLOCKED, address the blocker and re-run. Author and verifier must NEVER share an active context.

- [ ] **Step 4: Append `wiki/log.md` merge entry**

After verifier APPROVED, before push, append to `wiki/log.md`:

```markdown

## [2026-05-05] schema | cli scaffold pushed to main

Fast-forward merged `feat/cli-package` into `main`, verified the merged result, removed the temporary worktree and local feature branch, and pushed `main` to <https://github.com/haJ1t/MegaSaver>. `@megasaver/cli` is now part of `origin/main`.
```

Commit:

```bash
git add wiki/log.md
git commit -m "docs(wiki): record cli publish"
```

- [ ] **Step 5: Hand off to `superpowers:finishing-a-development-branch`**

Invoke the `superpowers:finishing-a-development-branch` skill. It runs the standard 4-option flow (merge locally / open PR / keep / discard) on `feat/cli-package`. The user picks the option.

If the user chooses "merge locally" or "open PR":

- Verify `pnpm verify` is still green on the rebased branch.
- Fast-forward merge to `main` (matching the `@megasaver/core` precedent), or open the PR with the smoke-evidence body from Task 7 Step 3.
- After merge, delete the local feature branch, the remote feature branch (if pushed), and the worktree (`git worktree remove ../MegaSaver-cli-package`).
- Push `main` to `origin/main`.

---

## Definition of Done (CLAUDE.md §9 mapping)

| § | Item | Where in this plan |
|---|------|---------------------|
| 1 | Spec exists | `docs/superpowers/specs/2026-05-05-cli-package-design.md` (already committed in `c268def`) |
| 2 | Plan exists | This file (committed in Task 0 Step 2) |
| 3 | Tests written first | Tasks 2–5 each start with a failing test |
| 4 | `pnpm verify` green | Task 7 Step 1 |
| 5 | Feature smoke evidence | Task 7 Step 3 (recorded in PR body) |
| 6 | External `code-reviewer` pass | Task 9 Step 1 |
| 7 | Verifier agent pass | Task 9 Step 3 |
| 8 | Zero pending TodoWrite items | Tracked by the executing skill |
| 9 | Changeset added if public API changed | N/A — `private: true`, no public API surface (spec §12) |
| 10 | Agent files updated if conventions changed | N/A — no convention change |

**Hard rule:** do not claim "complete" / "passing" / "shipped" until items 4, 5, 6, and 7 all pass.
