# CLI project CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega project create <name>` and `mega project list` with XDG-default JSON directory store, auto-init on first use, and full TDD coverage.

**Architecture:** Add a public `initStore` helper to `@megasaver/core` (idempotent layout creation). In `@megasaver/cli`, add three new files (`errors.ts`, `store.ts`, `commands/project.ts`) that follow the existing `commands/doctor.ts` pattern: pure helpers exported alongside the Citty `defineCommand` handler, tests in flat `apps/cli/test/<topic>.test.ts` files invoking handlers via `cmd.run?.({ args, ... } as never)` with `console.log` / `console.error` spies and `process.exitCode` assertions.

**Tech Stack:** Node 22 LTS, TypeScript strict ESM, pnpm 9 workspaces, Vitest, Citty, Zod, Biome, tsup, Turborepo. `@megasaver/shared` (`ProjectId`, `RiskLevel`), `@megasaver/core` (`createJsonDirectoryCoreRegistry`, `Project`, registry errors), `@megasaver/cli`.

**Working tree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/cli-project-crud` on branch `feat/cli-project-crud`.

**Spec:** `docs/superpowers/specs/2026-05-06-cli-project-crud-design.md`.

---

## Conventions used in every task

- All commands run from the worktree root (`/Users/halitozger/Desktop/MegaSaver/.worktrees/cli-project-crud`) unless stated otherwise.
- Conventional Commits subjects ≤50 chars, imperative.
- Never `--no-verify`. Never force push. Never bypass hooks.
- Every task ends with a green `pnpm verify` (lint + typecheck + test) at minimum on the touched package.
- Use `pnpm --filter <pkg> test` for fast inner-loop. Save full `pnpm verify` for the final task and selected checkpoints below.
- Handler tests follow the doctor pattern:

  ```ts
  await someCommand.run?.({
    args: { /* parsed flags */ },
    cmd: someCommand,
    rawArgs: [],
    data: undefined,
  } as never);
  ```

- Spies for stdout/stderr:

  ```ts
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // ...
  logSpy.mockRestore();
  errSpy.mockRestore();
  process.exitCode = 0;
  ```

---

## Task 1: `@megasaver/core` — `initStore` foundation

**Files:**
- Create: `packages/core/src/init-store.ts`
- Modify: `packages/core/src/index.ts` (add re-export)
- Test: `packages/core/test/init-store.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/core/test/init-store.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initStore } from "../src/init-store.js";

describe("initStore", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-init-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates rootDir, projects.json, and sessions.json when nothing exists", async () => {
    const target = join(root, "store");
    await initStore(target);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe("[]");
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });

  it("leaves an already-initialized store untouched (byte-identical)", async () => {
    const target = join(root, "store");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');
    await writeFile(join(target, "sessions.json"), '[{"id":"a","projectId":"x"}]');

    await initStore(target);

    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe(
      '[{"id":"a","projectId":"x"}]',
    );
  });

  it("completes a partial store without overwriting the existing file", async () => {
    const target = join(root, "store");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');

    await initStore(target);

    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });

  it("is idempotent across two consecutive calls", async () => {
    const target = join(root, "store");
    await initStore(target);
    await initStore(target);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe("[]");
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter @megasaver/core test -- init-store
```

Expected: import error, `Cannot find module '../src/init-store.js'`.

- [ ] **Step 3: Implement `initStore`**

Create `packages/core/src/init-store.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EMPTY_ARRAY_JSON = "[]";

async function writeIfMissing(path: string): Promise<void> {
  try {
    await writeFile(path, EMPTY_ARRAY_JSON, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return;
    }
    throw error;
  }
}

export async function initStore(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeIfMissing(join(rootDir, "projects.json"));
  await writeIfMissing(join(rootDir, "sessions.json"));
}
```

- [ ] **Step 4: Re-export from package index**

Modify `packages/core/src/index.ts` — add line in alphabetical position:

```ts
export * from "./init-store.js";
```

Final file order:

```ts
export * from "./errors.js";
export * from "./init-store.js";
export * from "./json-directory-registry.js";
export * from "./memory-entry.js";
export * from "./project.js";
export * from "./registry.js";
export * from "./session.js";
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/core test -- init-store
```

Expected: 4 tests passing.

- [ ] **Step 6: Run full core verify**

```bash
pnpm --filter @megasaver/core test
pnpm --filter @megasaver/core typecheck
pnpm --filter @megasaver/core build
```

Expected: all green; `dist/index.js` exports `initStore`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/init-store.ts \
        packages/core/src/index.ts \
        packages/core/test/init-store.test.ts
git commit -m "feat(core): add initStore helper"
```

---

## Task 2: Changeset for new core export

**Files:**
- Create: `.changeset/cli-project-crud-init-store.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/cli-project-crud-init-store.md`:

```md
---
"@megasaver/core": minor
---

Add `initStore(rootDir)` — idempotent helper that creates the JSON
directory store layout (`projects.json`, `sessions.json`) without
overwriting existing files. Used by `@megasaver/cli` for first-run
auto-init.
```

- [ ] **Step 2: Verify changeset is valid**

```bash
pnpm changeset status
```

Expected: lists the new changeset and the affected package.

- [ ] **Step 3: Commit**

```bash
git add .changeset/cli-project-crud-init-store.md
git commit -m "chore(core): add changeset for initStore"
```

---

## Task 3: `@megasaver/cli` — `errors.ts` (Core → CLI error mapping)

**Files:**
- Create: `apps/cli/src/errors.ts`
- Test: `apps/cli/test/errors.test.ts`

Verified core error shape (from `packages/core/src/errors.ts`):

- `CorePersistenceError extends Error` with `code: CorePersistenceErrorCode` and `filePath: string | null`. Codes: `"store_root_invalid"`, `"store_read_failed"`, `"store_write_failed"`, `"store_json_invalid"`, `"store_entity_invalid"`. Maps to spec §4.7's "I/O failure" and "corrupt store" rows depending on `code`.
- `CoreRegistryError extends Error` with `code: CoreRegistryErrorCode`. Codes include `"project_already_exists"` (ID collision in core, distinct from CLI's name-uniqueness pre-check). Mapped via the generic Error fallback because spec §4.6 keeps duplicate-name handling on the CLI side.

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CorePersistenceError } from "@megasaver/core";
import { mapErrorToCliMessage } from "../src/errors.js";

describe("mapErrorToCliMessage", () => {
  it("maps a Zod validation failure on `name` to the documented message", () => {
    const result = z.string().trim().min(1).safeParse("   ");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "name" })).toEqual({
      message: "error: name must be non-empty",
      exitCode: 1,
    });
  });

  it("maps a Zod failure on `--store` to the documented message", () => {
    const result = z.string().trim().min(1).safeParse("");
    if (result.success) throw new Error("unreachable");
    expect(mapErrorToCliMessage(result.error, { kind: "store" })).toEqual({
      message: "error: --store path must be non-empty",
      exitCode: 1,
    });
  });

  it("maps store_json_invalid to a path-bearing corrupt-store message", () => {
    const err = new CorePersistenceError(
      "store_json_invalid",
      "projects.json is not valid JSON",
      { filePath: "/tmp/x/projects.json" },
    );
    expect(mapErrorToCliMessage(err)).toEqual({
      message:
        "error: store at /tmp/x/projects.json is corrupt: projects.json is not valid JSON",
      exitCode: 1,
    });
  });

  it("maps store_entity_invalid the same way as store_json_invalid", () => {
    const err = new CorePersistenceError(
      "store_entity_invalid",
      "stored project failed schema",
      { filePath: "/tmp/y/projects.json" },
    );
    expect(mapErrorToCliMessage(err)).toEqual({
      message:
        "error: store at /tmp/y/projects.json is corrupt: stored project failed schema",
      exitCode: 1,
    });
  });

  it("maps store_read_failed to an I/O message", () => {
    const err = new CorePersistenceError("store_read_failed", "EACCES: permission denied");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store I/O failed: EACCES: permission denied",
      exitCode: 1,
    });
  });

  it("maps store_write_failed to an I/O message", () => {
    const err = new CorePersistenceError("store_write_failed", "ENOSPC: out of space");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store I/O failed: ENOSPC: out of space",
      exitCode: 1,
    });
  });

  it("maps store_root_invalid to an I/O message (root unusable)", () => {
    const err = new CorePersistenceError("store_root_invalid", "rootDir is not a directory");
    expect(mapErrorToCliMessage(err)).toEqual({
      message: "error: store I/O failed: rootDir is not a directory",
      exitCode: 1,
    });
  });

  it("rewraps an unknown Error to a generic message (no leak)", () => {
    expect(mapErrorToCliMessage(new Error("boom"))).toEqual({
      message: "error: unexpected failure: boom",
      exitCode: 1,
    });
  });

  it("rewraps a non-Error throwable to a generic message", () => {
    expect(mapErrorToCliMessage("plain string")).toEqual({
      message: "error: unexpected failure",
      exitCode: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
pnpm --filter @megasaver/cli test -- errors
```

Expected: import error, `Cannot find module '../src/errors.js'`.

- [ ] **Step 3: Implement the mapper**

Create `apps/cli/src/errors.ts`:

```ts
import { ZodError } from "zod";
import { CorePersistenceError } from "@megasaver/core";

export type CliMessage = { message: string; exitCode: 1 };

export type ZodContext = { kind: "name" | "store" };

export function duplicateNameMessage(name: string): CliMessage {
  return {
    message: `error: project "${name}" already exists`,
    exitCode: 1,
  };
}

export function mapErrorToCliMessage(
  err: unknown,
  ctx?: ZodContext,
): CliMessage {
  if (err instanceof ZodError) {
    if (ctx?.kind === "store") {
      return { message: "error: --store path must be non-empty", exitCode: 1 };
    }
    return { message: "error: name must be non-empty", exitCode: 1 };
  }
  if (err instanceof CorePersistenceError) {
    if (err.code === "store_json_invalid" || err.code === "store_entity_invalid") {
      const path = err.filePath ?? "<unknown>";
      return {
        message: `error: store at ${path} is corrupt: ${err.message}`,
        exitCode: 1,
      };
    }
    return {
      message: `error: store I/O failed: ${err.message}`,
      exitCode: 1,
    };
  }
  if (err instanceof Error) {
    return { message: `error: unexpected failure: ${err.message}`, exitCode: 1 };
  }
  return { message: "error: unexpected failure", exitCode: 1 };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/cli test -- errors
```

Expected: 9 tests passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @megasaver/cli typecheck
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/errors.ts apps/cli/test/errors.test.ts
git commit -m "feat(cli): add core-to-cli error mapper"
```

---

## Task 4: `@megasaver/cli` — `store.ts` `resolveStorePath` (pure)

**Files:**
- Create: `apps/cli/src/store.ts` (initial — `resolveStorePath` only; `ensureStoreReady` lands in Task 5)
- Test: `apps/cli/test/store.test.ts` (initial — `resolveStorePath` tests; rest in Task 5)

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveStorePath } from "../src/store.js";

describe("resolveStorePath", () => {
  const home = "/home/user";

  it("returns absolute --store flag verbatim", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/megasaver",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/abs/megasaver");
  });

  it("resolves a relative --store flag against cwd", () => {
    expect(
      resolveStorePath({
        storeFlag: "./local-store",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/repo/local-store");
  });

  it("rejects an empty --store flag", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: "",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toThrow();
  });

  it("rejects a whitespace-only --store flag", () => {
    expect(() =>
      resolveStorePath({
        storeFlag: "   ",
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toThrow();
  });

  it("uses XDG_DATA_HOME when set and non-empty", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: "/xdg/data",
      }),
    ).toBe("/xdg/data/megasaver");
  });

  it("ignores empty XDG_DATA_HOME and falls back to HOME", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: "",
      }),
    ).toBe("/home/user/.local/share/megasaver");
  });

  it("falls back to HOME when XDG_DATA_HOME is undefined", () => {
    expect(
      resolveStorePath({
        storeFlag: undefined,
        cwd: "/repo",
        home,
        xdgDataHome: undefined,
      }),
    ).toBe("/home/user/.local/share/megasaver");
  });

  it("flag wins even when XDG is set", () => {
    expect(
      resolveStorePath({
        storeFlag: "/abs/override",
        cwd: "/repo",
        home,
        xdgDataHome: "/xdg/data",
      }),
    ).toBe("/abs/override");
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
pnpm --filter @megasaver/cli test -- store
```

Expected: import error.

- [ ] **Step 3: Implement `resolveStorePath`**

Create `apps/cli/src/store.ts`:

```ts
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export type ResolveStorePathInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
};

const storeFlagSchema = z.string().trim().min(1);

export function resolveStorePath(input: ResolveStorePathInput): string {
  const { storeFlag, cwd, home, xdgDataHome } = input;
  if (storeFlag !== undefined) {
    storeFlagSchema.parse(storeFlag);
    return isAbsolute(storeFlag) ? storeFlag : resolve(cwd, storeFlag);
  }
  if (xdgDataHome && xdgDataHome.length > 0) {
    return resolve(xdgDataHome, "megasaver");
  }
  return resolve(home, ".local", "share", "megasaver");
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/cli test -- store
```

Expected: 8 tests passing.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @megasaver/cli typecheck
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/store.ts apps/cli/test/store.test.ts
git commit -m "feat(cli): resolve store path with XDG default"
```

---

## Task 5: `@megasaver/cli` — `ensureStoreReady` (I/O, returns `initialized` flag)

**Files:**
- Modify: `apps/cli/src/store.ts` (add `ensureStoreReady`)
- Modify: `apps/cli/test/store.test.ts` (add new `describe` block)

- [ ] **Step 1: Append failing tests to `apps/cli/test/store.test.ts`**

Append to the existing test file:

```ts
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { ensureStoreReady } from "../src/store.js";

describe("ensureStoreReady", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-store-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates the layout when rootDir does not exist and reports initialized:true", async () => {
    const target = join(root, "fresh");
    const result = await ensureStoreReady(target);
    expect(result.initialized).toBe(true);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe("[]");
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
    expect(result.registry).toBeDefined();
  });

  it("reports initialized:false against an already-complete store and does not mutate", async () => {
    const target = join(root, "complete");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');
    await writeFile(join(target, "sessions.json"), "[]");
    const before = await stat(join(target, "projects.json"));

    const result = await ensureStoreReady(target);

    expect(result.initialized).toBe(false);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    const after = await stat(join(target, "projects.json"));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("reports initialized:true when a partial store is completed and preserves the existing file", async () => {
    const target = join(root, "partial");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "projects.json"), '[{"id":"x","name":"y"}]');

    const result = await ensureStoreReady(target);

    expect(result.initialized).toBe(true);
    expect(await readFile(join(target, "projects.json"), "utf8")).toBe(
      '[{"id":"x","name":"y"}]',
    );
    expect(await readFile(join(target, "sessions.json"), "utf8")).toBe("[]");
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
pnpm --filter @megasaver/cli test -- store
```

Expected: import error on `ensureStoreReady`.

- [ ] **Step 3: Implement `ensureStoreReady`**

Append to `apps/cli/src/store.ts`:

```ts
import { access } from "node:fs/promises";
import {
  type CoreRegistry,
  createJsonDirectoryCoreRegistry,
  initStore,
} from "@megasaver/core";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export type EnsureStoreReadyResult = {
  registry: CoreRegistry;
  initialized: boolean;
};

export async function ensureStoreReady(
  rootDir: string,
): Promise<EnsureStoreReadyResult> {
  const projectsPath = resolve(rootDir, "projects.json");
  const sessionsPath = resolve(rootDir, "sessions.json");
  const [rootExists, projectsExists, sessionsExists] = await Promise.all([
    exists(rootDir),
    exists(projectsPath),
    exists(sessionsPath),
  ]);
  const initialized = !(rootExists && projectsExists && sessionsExists);
  await initStore(rootDir);
  const registry = await createJsonDirectoryCoreRegistry({ rootDir });
  return { registry, initialized };
}
```

If `createJsonDirectoryCoreRegistry`'s argument shape differs (e.g. positional `rootDir` instead of an options object), adjust the call to match its actual signature in `packages/core/src/json-directory-registry.ts`. Verify by reading that file.

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/cli test -- store
```

Expected: 11 tests passing (8 existing + 3 new).

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/cli lint
```

Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/store.ts apps/cli/test/store.test.ts
git commit -m "feat(cli): add ensureStoreReady factory"
```

---

## Task 6: `commands/project.ts` — `formatProjectLine` (pure)

**Files:**
- Create: `apps/cli/src/commands/project.ts` (initial — exports `formatProjectLine` only; handlers land in Tasks 7–8)
- Create: `apps/cli/test/project.test.ts` (initial — `formatProjectLine` tests only)

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/project.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatProjectLine } from "../src/commands/project.js";

describe("formatProjectLine", () => {
  it("renders id and name separated by exactly two spaces", () => {
    expect(
      formatProjectLine({
        id: "01HXYZ-aaaa-bbbb-cccc-dddddddddddd",
        name: "demo",
      }),
    ).toBe("01HXYZ-aaaa-bbbb-cccc-dddddddddddd  demo");
  });

  it("preserves whitespace inside name without quoting", () => {
    expect(
      formatProjectLine({
        id: "id1",
        name: "two words",
      }),
    ).toBe("id1  two words");
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
pnpm --filter @megasaver/cli test -- project
```

Expected: import error.

- [ ] **Step 3: Implement `formatProjectLine`**

Create `apps/cli/src/commands/project.ts`:

```ts
import type { Project } from "@megasaver/core";

export function formatProjectLine(project: Project): string {
  return `${project.id}  ${project.name}`;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/cli test -- project
```

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/project.ts apps/cli/test/project.test.ts
git commit -m "feat(cli): format project list line"
```

---

## Task 7: `mega project list` handler

**Files:**
- Modify: `apps/cli/src/commands/project.ts` (add `projectListCommand` and inner handler `runProjectList`)
- Modify: `apps/cli/test/project.test.ts` (add `describe` block for list)

**Citty handler shape (matches doctor precedent):**

```ts
export const projectListCommand = defineCommand({
  meta: { name: "list", description: "List persisted projects." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    await runProjectList({
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      home: process.env.HOME ?? "",
      xdgDataHome: process.env.XDG_DATA_HOME,
      stdout: (s) => console.log(s),
      stderr: (s) => console.error(s),
    });
  },
});
```

- [ ] **Step 1: Append failing handler tests**

Append to `apps/cli/test/project.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { projectListCommand } from "../src/commands/project.js";

describe("projectListCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-list-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true });
  });

  async function runList(): Promise<void> {
    await projectListCommand.run?.({
      args: { store: root },
      cmd: projectListCommand,
      rawArgs: ["--store", root],
      data: undefined,
    } as never);
  }

  it("prints nothing on an empty store, exits 0, and notes first init", async () => {
    await runList();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0] as string).toMatch(
      /^note: initialized store at /,
    );
    expect(process.exitCode).toBe(0);
  });

  it("prints one line per project in projects.json array order", async () => {
    await mkdir(root, { recursive: true });
    const aId = "11111111-1111-4111-8111-111111111111";
    const bId = "22222222-2222-4222-8222-222222222222";
    const ts = "2026-05-06T00:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: aId, name: "alpha", rootPath: "/tmp/a", createdAt: ts, updatedAt: ts },
        { id: bId, name: "beta", rootPath: "/tmp/b", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(root, "sessions.json"), "[]");

    await runList();

    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      `${aId}  alpha`,
      `${bId}  beta`,
    ]);
    expect(errSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("prints no init notice on the second run against the same store", async () => {
    await runList(); // first run initializes
    logSpy.mockClear();
    errSpy.mockClear();
    await runList(); // second run

    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
pnpm --filter @megasaver/cli test -- project
```

Expected: import error on `projectListCommand`.

- [ ] **Step 3: Implement `projectListCommand` and `runProjectList`**

Append to `apps/cli/src/commands/project.ts`:

```ts
import { defineCommand } from "citty";
import { ensureStoreReady, resolveStorePath } from "../store.js";
import { mapErrorToCliMessage } from "../errors.js";

export type RunProjectListInput = {
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runProjectList(input: RunProjectListInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const projects = registry.listProjects();
    for (const project of projects) {
      input.stdout(formatProjectLine(project));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const projectListCommand = defineCommand({
  meta: { name: "list", description: "List persisted projects." },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runProjectList({
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      home: process.env.HOME ?? "",
      xdgDataHome: process.env.XDG_DATA_HOME,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Note: `registry.listProjects()` returns `Project[]` synchronously (verified against `packages/core/src/json-directory-registry.ts`). Do not add an `await`.

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/cli test -- project
```

Expected: 5 tests passing (2 format + 3 list).

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/cli lint
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/project.ts apps/cli/test/project.test.ts
git commit -m "feat(cli): add mega project list"
```

---

## Task 8: `mega project create` handler with duplicate-name guard

**Files:**
- Modify: `apps/cli/src/commands/project.ts` (add `projectCreateCommand` and inner `runProjectCreate`)
- Modify: `apps/cli/test/project.test.ts` (add `describe` block for create)

- [ ] **Step 1: Append failing tests**

Append to `apps/cli/test/project.test.ts`:

```ts
import { projectCreateCommand } from "../src/commands/project.js";

describe("projectCreateCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-create-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(root, { recursive: true, force: true });
  });

  async function runCreate(name: string): Promise<void> {
    await projectCreateCommand.run?.({
      args: { name, store: root },
      cmd: projectCreateCommand,
      rawArgs: [name, "--store", root],
      data: undefined,
    } as never);
  }

  it("creates a project, prints `<id>  <name>` on stdout, and persists it", async () => {
    await runCreate("demo");

    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0] as string).toMatch(
      /^[0-9a-f-]{36}  demo$/,
    );

    const persisted = JSON.parse(
      await readFile(join(root, "projects.json"), "utf8"),
    ) as Array<{ id: string; name: string }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.name).toBe("demo");
  });

  it("emits the init notice exactly once on first invocation", async () => {
    await runCreate("demo");

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0] as string).toMatch(
      /^note: initialized store at /,
    );
  });

  it("rejects an empty name with `error: name must be non-empty` and exit 1, without touching the store", async () => {
    await runCreate("   ");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      "error: name must be non-empty",
    ]);
    expect(logSpy).not.toHaveBeenCalled();

    // Implementation rejects the name before ensureStoreReady runs,
    // so projects.json must NOT have been created.
    await expect(readFile(join(root, "projects.json"), "utf8")).rejects.toThrow();
  });

  it("rejects a duplicate name with the documented message and leaves projects.json unchanged", async () => {
    await runCreate("demo");
    logSpy.mockClear();
    errSpy.mockClear();
    process.exitCode = 0;

    await runCreate("demo");

    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      'error: project "demo" already exists',
    ]);
    expect(logSpy).not.toHaveBeenCalled();

    const persisted = JSON.parse(
      await readFile(join(root, "projects.json"), "utf8"),
    ) as Array<{ id: string; name: string }>;
    expect(persisted).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

```bash
pnpm --filter @megasaver/cli test -- project
```

Expected: import error on `projectCreateCommand`.

- [ ] **Step 3: Implement `projectCreateCommand` and `runProjectCreate`**

Append to `apps/cli/src/commands/project.ts`:

```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { projectIdSchema } from "@megasaver/shared";
import { duplicateNameMessage } from "../errors.js";

const nameSchema = z.string().trim().min(1);

export type RunProjectCreateInput = {
  name: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Override for tests; defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runProjectCreate(
  input: RunProjectCreateInput,
): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let trimmedName: string;
  try {
    trimmedName = nameSchema.parse(input.name);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const existing = registry.listProjects();
    if (existing.some((p) => p.name === trimmedName)) {
      const cli = duplicateNameMessage(trimmedName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const id = projectIdSchema.parse((input.newId ?? randomUUID)());
    const now = (input.now ?? (() => new Date().toISOString()))();
    const created = registry.createProject({
      id,
      name: trimmedName,
      rootPath: input.cwd,
      createdAt: now,
      updatedAt: now,
    });
    input.stdout(formatProjectLine(created));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const projectCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a new project." },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Project name (non-empty after trim).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runProjectCreate({
      name: typeof args.name === "string" ? args.name : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      home: process.env.HOME ?? "",
      xdgDataHome: process.env.XDG_DATA_HOME,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Note: `registry.createProject(project: Project): Project` is synchronous and takes the FULL `Project` (`{ id, name, rootPath, createdAt, updatedAt }`). The CLI generates a UUID via `crypto.randomUUID()` and brands it through `projectIdSchema.parse(...)`. The CLI sets `rootPath` to the invocation cwd (v0.1 default — no `--root` flag yet) and `createdAt`/`updatedAt` to `new Date().toISOString()` (RFC 3339 with offset, the schema requires `.datetime({ offset: true })`). Verified against `packages/core/src/registry.ts` (interface), `packages/core/src/json-directory-registry.ts` (impl), and `packages/core/src/project.ts` (schema with 5 required fields).

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @megasaver/cli test -- project
```

Expected: 9 tests passing (2 format + 3 list + 4 create).

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/cli lint
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/project.ts apps/cli/test/project.test.ts
git commit -m "feat(cli): add mega project create"
```

---

## Task 9: Wire up the `project` parent command in `main.ts`

**Files:**
- Modify: `apps/cli/src/commands/project.ts` (export parent `projectCommand`)
- Modify: `apps/cli/src/main.ts` (register `project` subCommand)

- [ ] **Step 1: Append the parent command to `commands/project.ts`**

Append:

```ts
export const projectCommand = defineCommand({
  meta: { name: "project", description: "Manage Mega Saver projects." },
  subCommands: {
    create: projectCreateCommand,
    list: projectListCommand,
  },
});
```

- [ ] **Step 2: Register in `main.ts`**

Modify `apps/cli/src/main.ts`:

```ts
import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { doctorCommand } from "./commands/doctor.js";
import { projectCommand } from "./commands/project.js";

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
    project: projectCommand,
  },
});
```

- [ ] **Step 3: Build and run a smoke check**

```bash
pnpm --filter @megasaver/cli build
SMOKE_STORE="$(mktemp -d -t megasaver-smoke.XXXXXX)"
node apps/cli/dist/cli.js project list --store "$SMOKE_STORE"
node apps/cli/dist/cli.js project create demo --store "$SMOKE_STORE"
node apps/cli/dist/cli.js project list --store "$SMOKE_STORE"
rm -rf "$SMOKE_STORE"
```

Expected:
- First `list`: stdout empty, stderr `note: initialized store at <path>`, exit 0.
- `create`: stdout single `<uuid>  demo`, stderr empty (init already done), exit 0.
- Second `list`: stdout `<uuid>  demo`, stderr empty, exit 0.

If any step prints unexpected output or exits non-zero, return to the relevant earlier task and fix before proceeding.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/project.ts apps/cli/src/main.ts
git commit -m "feat(cli): wire mega project parent command"
```

---

## Task 10: Final verification and smoke evidence

**Files:**
- (No code changes)

- [ ] **Step 1: Full repo verify**

```bash
pnpm verify
```

Expected: lint + typecheck + test all green across `@megasaver/shared`, `@megasaver/core`, `@megasaver/cli`. Test totals at minimum:

- core: previous 85 + 4 new (`initStore`) = 89.
- cli: previous 17 + 9 errors + 11 store + 9 project = 46.

If any test fails, do not proceed; debug and fix in place before continuing.

- [ ] **Step 2: Capture smoke evidence**

Run the §6.4 smoke from the spec and save the output for the wiki update:

```bash
SMOKE_STORE="$(mktemp -d -t megasaver-smoke.XXXXXX)"
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js project list --store "$SMOKE_STORE" 2>&1
node apps/cli/dist/cli.js project create demo --store "$SMOKE_STORE" 2>&1
node apps/cli/dist/cli.js project list --store "$SMOKE_STORE" 2>&1
rm -rf "$SMOKE_STORE"
```

Save the captured output (or a faithful summary) for inclusion in the wiki ingest entry of Task 11.

- [ ] **Step 3: Confirm changeset still valid**

```bash
pnpm changeset status
```

Expected: lists `cli-project-crud-init-store.md`, no warnings.

---

## Task 11: Wiki ingest entries

**Files:**
- Modify: `wiki/log.md` (append three entries)
- Modify: `wiki/entities/cli.md` (document new commands)
- Modify: `wiki/entities/core.md` (document `initStore`)
- Modify: `wiki/index.md` (Status section)

- [ ] **Step 1: Append spec ingest entry to `wiki/log.md`**

Add at the end:

```md
## [2026-05-06] ingest | cli project crud spec

Wrote `docs/superpowers/specs/2026-05-06-cli-project-crud-design.md`. Locked v0.1 first user-facing CRUD: `mega project create <name>` and `mega project list`, XDG-default store at `$XDG_DATA_HOME/megasaver` (fallback `~/.local/share/megasaver`), root `--store` override, auto-init on first use with one-line stderr notice, plain `<id>  <name>` output, duplicate-name reject, every typed core error mapped to exit 1. Layout aligned with existing `commands/doctor.ts` pattern (single file per command + helpers + handlers, flat tests). Risk HIGH.
```

- [ ] **Step 2: Append plan ingest entry**

Add:

```md
## [2026-05-06] ingest | cli project crud plan

Wrote `docs/superpowers/plans/2026-05-06-cli-project-crud-plan.md`. Plan breaks implementation into TDD tasks: core `initStore` helper + changeset, CLI `errors.ts`, CLI `store.ts` (`resolveStorePath` + `ensureStoreReady`), `commands/project.ts` (format → list → create → parent), `main.ts` wire-up, full verification with smoke evidence, and wiki ingest. Each task ends with a green per-package verify and a Conventional Commit.
```

- [ ] **Step 3: Append implementation entry**

Add (substitute the captured smoke output where indicated):

```md
## [2026-05-06] schema | cli project crud implemented

Implemented `mega project create` and `mega project list` in `feat/cli-project-crud`: new `@megasaver/core` export `initStore` (idempotent layout), new CLI files `errors.ts`, `store.ts`, `commands/project.ts`, `main.ts` wires the `project` parent. Evidence before review: `pnpm --filter @megasaver/core test` passed (89 tests across 10 files), `pnpm --filter @megasaver/cli test` passed (46 tests across 4 files), `pnpm verify` green, build smoke against a temp store directory printed empty list → `<uuid>  demo` → `<uuid>  demo` with the init notice on the first invocation only, and the temp directory was removed.
```

- [ ] **Step 4: Update `wiki/entities/cli.md`**

Bump `updated:` to `2026-05-06`. In the body, document:

- the new `mega project create <name>` and `mega project list` commands;
- the XDG default store location;
- the `--store <dir>` override;
- the first-run `note: initialized store at <path>` stderr line;
- the duplicate-name rejection rule.

Keep the page ≤100 lines (wiki schema rule). Replace the v0.1 surface section ("doctor only") with the new surface; do not duplicate spec content — reference the spec by path.

- [ ] **Step 5: Update `wiki/entities/core.md`**

Bump `updated:` to `2026-05-06`. Add `initStore` to the public surface section with one sentence: "Idempotent helper that creates `rootDir`, `projects.json`, and `sessions.json` (each `[]`) without overwriting existing files. Used by `@megasaver/cli` for first-run auto-init." Add the new spec to `sources:` only after the spec is referenced from this page.

- [ ] **Step 6: Update `wiki/index.md` Status block**

Replace the current Status block with:

```md
## Status

CLI project CRUD implemented. Bootstrap, project skeleton,
`@megasaver/shared`, `@megasaver/core` (with `initStore` and
JSON directory persistence), and `@megasaver/cli` (with
`mega doctor`, `mega project create`, `mega project list`) are
all on `feat/cli-project-crud`, awaiting external review and
merge to `origin/main`. Next slot: connector specs
(`connectors/claude-code` or `connectors/generic-cli`) or first
`Session` CRUD.
```

- [ ] **Step 7: Commit wiki updates**

```bash
git add wiki/log.md wiki/entities/cli.md wiki/entities/core.md wiki/index.md
git commit -m "docs(wiki): record cli project crud"
```

---

## Task 12: Pre-merge gate

**Files:**
- (No code changes)

- [ ] **Step 1: Final `pnpm verify`**

```bash
pnpm verify
```

Expected: green.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/cli-project-crud
```

- [ ] **Step 3: Request external reviews**

Per CLAUDE.md §12 (HIGH risk), both `code-reviewer` and `critic` passes are required before merge. Dispatch them as separate agents (author and reviewer never share an active context). Capture their findings in a follow-up plan or directly fix and re-review until both report no Critical/Important/Minor issues.

- [ ] **Step 4: Status note**

After both reviewers report ready-to-merge, append a `[2026-05-06] schema | cli project crud review passed` entry to `wiki/log.md` summarizing the reviewer findings and the pre-merge evidence. Then proceed with the merge protocol used for prior packages (PR or fast-forward, your choice; record the result in another wiki log entry post-merge).

---

## Spec → task coverage matrix

| Spec section | Covered by |
|---|---|
| §4.1 commands `create` + `list` | Task 7 (list), Task 8 (create), Task 9 (parent + main wiring) |
| §4.2 `--store` flag at root level | Task 7 (list arg), Task 8 (create arg), Task 9 (parent) |
| §4.3 default store dir + XDG fallback | Task 4 (`resolveStorePath`) |
| §4.4 auto-init + stderr notice | Task 5 (`ensureStoreReady`) + Task 7 (list-side notice) + Task 8 (create-side notice) |
| §4.5 output format `<id>  <name>` | Task 6 (`formatProjectLine`) + Task 7 + Task 8 |
| §4.6 duplicate-name reject | Task 8 |
| §4.7 errors and exit codes | Task 3 (`mapErrorToCliMessage`) + Task 7 + Task 8 |
| §5.1 module layout | Tasks 3–9 (file creation order) |
| §5.2 pure helpers | Tasks 4 + 6 |
| §5.3 `ensureStoreReady` semantics | Task 5 |
| §5.4 error mapping helper | Task 3 |
| §5.5 `initStore` core export | Task 1 |
| §6.1 pure unit tests | Tasks 3, 4, 6 |
| §6.2 integration tests | Tasks 5, 7, 8 |
| §6.3 core init-store test | Task 1 |
| §6.4 build smoke | Tasks 9 + 10 |
| §7 DoD items | Task 10 (verify), Task 2 (changeset), Task 11 (wiki) |
| §10 documentation | Task 11 |
