# MemoryEntry CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mega memory create/list/show` subcommands as a thin CLI layer over the already-shipped `CoreRegistry.{createMemoryEntry,getMemoryEntry,listMemoryEntries}` surface.

**Architecture:** New `apps/cli/src/commands/memory/` directory mirroring the post-PR-#18 `commands/session/` layout (one module per subcommand + `shared.ts` for helpers + `index.ts` for parent + re-exports). `apps/cli/src/errors.ts` extends with two new ZodContext variants (`memory_create`, `memoryEntryId`) and four new error helpers. `main.ts` registers `memory` as the fifth top-level subcommand. Core is unchanged.

**Tech Stack:** TypeScript strict ESM, Node 22, pnpm + Turborepo, Vitest, Biome, Citty, Zod.

**Spec:** `docs/superpowers/specs/2026-05-09-memory-entry-cli-design.md`.

**Working dir for every step:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/memory-cli` (branch `feat/memory-cli`).

**Build/test commands:**

```bash
pnpm --filter @megasaver/cli test --run
pnpm verify
```

**Build dependency:** `pnpm test` runs `pnpm build` first; if you see DTS errors run `pnpm --filter @megasaver/shared build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/connector-generic-cli build` first.

---

## File map

- **Modify** `apps/cli/src/errors.ts` — add `kind: "memory_create"` + `kind: "memoryEntryId"` ZodContext variants, four helpers, `KNOWN_SCOPE_IDS` drift-guard, mapper branch for `memory_entry_not_found` CoreRegistryError.
- **Create** `apps/cli/src/commands/memory/index.ts` — parent `memoryCommand` + re-exports.
- **Create** `apps/cli/src/commands/memory/shared.ts` — `contentSchema`, `formatMemoryListLine`, `formatMemoryShowLines`, plus a small UUID `padRight` helper.
- **Create** `apps/cli/src/commands/memory/create.ts` — `RunMemoryCreateInput` + `runMemoryCreate` + `memoryCreateCommand`.
- **Create** `apps/cli/src/commands/memory/list.ts` — `RunMemoryListInput` + `runMemoryList` + `memoryListCommand`.
- **Create** `apps/cli/src/commands/memory/show.ts` — `RunMemoryShowInput` + `runMemoryShow` + `memoryShowCommand`.
- **Modify** `apps/cli/src/main.ts` — register `memory: memoryCommand` in `subCommands`.
- **Create** `apps/cli/test/memory.test.ts` — 19 new behavioural tests across three describe blocks.
- **Modify** `apps/cli/test/errors.test.ts` — append 5 new tests for memory error helpers + Zod routing.
- **Create** `.changeset/memory-entry-cli.md` — `@megasaver/cli` minor.
- **Modify** `wiki/entities/cli.md`, `wiki/index.md`, `wiki/log.md` — record the slot.

No changes to Core, shared, or any connector package.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative.
- TDD: write failing test, RED, implement, GREEN, commit.
- After every task run `pnpm --filter @megasaver/cli test --run`. After T6 run full `pnpm verify`.
- Existing 142 CLI tests pass byte-identically post-T1 (errors module is additive).

---

### Task 1: errors.ts extensions + tests

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Modify: `apps/cli/test/errors.test.ts`

**Goal:** Add the four new helpers + two ZodContext variants + `KNOWN_SCOPE_IDS` drift-guard + mapper branch for `memory_entry_not_found`. Append 5 errors-module tests.

- [ ] **Step 1: Add the failing tests (RED)**

In `apps/cli/test/errors.test.ts`, append the following describe block at the END of the file:

```ts
describe("errors — memory", () => {
  it("memoryEntryNotFoundMessage returns the documented shape", () => {
    expect(memoryEntryNotFoundMessage("01abcdef-abcd-4abc-8abc-abcdefabcdef")).toEqual({
      message: 'error: memory entry "01abcdef-abcd-4abc-8abc-abcdefabcdef" not found',
      exitCode: 1,
    });
  });

  it("invalidScopeMessage returns the documented shape", () => {
    expect(invalidScopeMessage("bogus")).toEqual({
      message: 'error: invalid scope "bogus", expected: project | session',
      exitCode: 1,
    });
  });

  it("scopeProjectWithSessionMessage returns the documented shape", () => {
    expect(scopeProjectWithSessionMessage()).toEqual({
      message: "error: --session is not allowed when --scope is project",
      exitCode: 1,
    });
  });

  it("scopeSessionWithoutSessionMessage returns the documented shape", () => {
    expect(scopeSessionWithoutSessionMessage()).toEqual({
      message: "error: --session is required when --scope is session",
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage routes a Zod issue under kind: memory_create", () => {
    const result = z.string().min(5).safeParse("ab");
    expect(result.success).toBe(false);
    if (!result.success) {
      const cli = mapErrorToCliMessage(result.error, { kind: "memory_create" });
      expect(cli.exitCode).toBe(1);
      expect(cli.message.startsWith("error:")).toBe(true);
    }
  });
});
```

Update the imports at the top of `errors.test.ts` to include the four new helpers:

```ts
import {
  // ...existing...
  invalidScopeMessage,
  memoryEntryNotFoundMessage,
  scopeProjectWithSessionMessage,
  scopeSessionWithoutSessionMessage,
} from "../src/errors.js";
```

If `z` from `zod` is not yet imported in the test file, add `import { z } from "zod";` at the top.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run errors.test`
Expected: 5 new tests fail with "is not a function" or import errors.

- [ ] **Step 3: Implement (GREEN)**

In `apps/cli/src/errors.ts`:

(a) Extend the `ZodContext` union (alphabetically):

```ts
type ZodContext =
  | { kind: "name" }
  | { kind: "store" }
  | { kind: "title" }
  | { kind: "sessionId" }
  | { kind: "memoryEntryId" }
  | { kind: "memory_create" }
  | { kind: "project"; name: string }
  | { kind: "session"; id: string }
  | { kind: "session_update"; id: string }
  | { kind: "connector"; targetId: string; relativePath: string };
```

(b) Add `KNOWN_SCOPE_IDS` next to the existing `KNOWN_TARGET_IDS` constant (alphabetically). Import `MemoryScope` from `@megasaver/core`:

```ts
import type { MemoryScope } from "@megasaver/core";
```

```ts
const KNOWN_SCOPE_IDS = ["project", "session"] as const satisfies readonly MemoryScope[];
```

(c) Add the four helpers at the bottom of the file (after the existing `*Message` helpers, alphabetical-ish):

```ts
export function memoryEntryNotFoundMessage(id: string): CliMessage {
  return { message: `error: memory entry "${id}" not found`, exitCode: 1 };
}

export function invalidScopeMessage(value: string): CliMessage {
  return {
    message: `error: invalid scope "${value}", expected: ${KNOWN_SCOPE_IDS.join(" | ")}`,
    exitCode: 1,
  };
}

export function scopeProjectWithSessionMessage(): CliMessage {
  return {
    message: "error: --session is not allowed when --scope is project",
    exitCode: 1,
  };
}

export function scopeSessionWithoutSessionMessage(): CliMessage {
  return {
    message: "error: --session is required when --scope is session",
    exitCode: 1,
  };
}
```

(d) Add a `memory_entry_not_found` branch to `mapErrorToCliMessage`'s CoreRegistryError handler. Find the existing branch that handles `session_not_found` and `session_already_ended`; add a parallel branch right next to it:

```ts
if (err instanceof CoreRegistryError && err.code === "memory_entry_not_found") {
  // ctx?.kind for memory_create / memoryEntryId may carry no id; the message
  // uses the err's runtime detail. Fall back to the err.message when no
  // explicit id is in scope.
  return { message: `error: memory entry not found`, exitCode: 1 };
}
```

(If the existing pattern uses `ctx?.kind === "session" && ctx.id` to thread the id into the canonical message, mirror that here only if a future caller would need the id-aware shape. For T1's scope, the simple form above is sufficient. T2/T3/T4 use `memoryEntryNotFoundMessage(id)` directly when the id is in scope.)

- [ ] **Step 4: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 142 prior + 5 new = **147 passing**.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/errors.ts apps/cli/test/errors.test.ts
git commit -m "feat(cli): memory error helpers + ZodContext"
```

---

### Task 2: `memory/shared.ts` + `memory/show.ts` + 4 tests

**Files:**
- Create: `apps/cli/src/commands/memory/shared.ts`
- Create: `apps/cli/src/commands/memory/show.ts`
- Modify: `apps/cli/test/memory.test.ts` (create file in this task; subsequent tasks append)

**Goal:** Read-only path (smallest blast radius). Implement `mega memory show <memoryEntryId>` end-to-end. 4 tests.

- [ ] **Step 1: Create the test file with 4 RED tests**

Create `apps/cli/test/memory.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryShowCommand } from "../src/commands/memory/show.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID_PROJECT = "22222222-2222-4222-8222-222222222222";
const MEMORY_ID_SESSION = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-05-09T00:00:00.000Z";

describe("memoryShowCommand", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memshow-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
  });

  async function seed(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await writeFile(
      join(store, "memory-entries.json"),
      JSON.stringify([
        {
          id: MEMORY_ID_PROJECT,
          projectId: PROJECT_ID,
          sessionId: null,
          scope: "project",
          content: "user prefers TS",
          createdAt: TS,
        },
        {
          id: MEMORY_ID_SESSION,
          projectId: PROJECT_ID,
          sessionId: SESSION_ID,
          scope: "session",
          content: "checked CSRF token expiry",
          createdAt: TS,
        },
      ]),
    );
  }

  async function runShow(args: { memoryEntryId: string }): Promise<void> {
    await memoryShowCommand.run?.({
      args: { memoryEntryId: args.memoryEntryId, store },
      cmd: memoryShowCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("renders project-scoped entry as 6-line key=value", async () => {
    await seed();
    await runShow({ memoryEntryId: MEMORY_ID_PROJECT });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      `id          ${MEMORY_ID_PROJECT}`,
      `project     ${PROJECT_ID}`,
      "session     -",
      "scope       project",
      "content     user prefers TS",
      `createdAt   ${TS}`,
    ]);
  });

  it("renders session-scoped entry with full session UUID", async () => {
    await seed();
    await runShow({ memoryEntryId: MEMORY_ID_SESSION });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[2]).toBe(`session     ${SESSION_ID}`);
    expect(lines[3]).toBe("scope       session");
  });

  it("rejects unknown memory entry id with not-found", async () => {
    await seed();
    await runShow({ memoryEntryId: "99999999-9999-4999-8999-999999999999" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => /memory entry "99999999.*" not found/.test(c[0] as string))).toBe(true);
  });

  it("rejects invalid memory entry id (not a uuid)", async () => {
    await seed();
    await runShow({ memoryEntryId: "not-a-uuid" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });
});
```

The fixture writes a `memory-entries.json` file because the JSON-directory registry persists memory entries to that file. (If the registry uses a different filename, adjust per the actual JSON-dir layout — read `packages/core/src/json-directory-registry.ts` to confirm.)

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run memory.test`
Expected: import fails because `memoryShowCommand` does not exist.

- [ ] **Step 3: Create `apps/cli/src/commands/memory/shared.ts`**

```ts
import { memoryEntryIdSchema } from "@megasaver/shared";
import { z } from "zod";
import { NAME_CONTROL_CHARS_MESSAGE } from "../../errors.js";

const SHOW_KEY_WIDTH = 12;

export const contentSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

export { memoryEntryIdSchema };

export function formatMemoryShowLines(entry: {
  id: string;
  projectId: string;
  sessionId: string | null;
  scope: "project" | "session";
  content: string;
  createdAt: string;
}): string[] {
  return [
    `${pad("id")}${entry.id}`,
    `${pad("project")}${entry.projectId}`,
    `${pad("session")}${entry.sessionId ?? "-"}`,
    `${pad("scope")}${entry.scope}`,
    `${pad("content")}${entry.content}`,
    `${pad("createdAt")}${entry.createdAt}`,
  ];
}

function pad(key: string): string {
  return key.padEnd(SHOW_KEY_WIDTH, " ");
}
```

If `NAME_CONTROL_CHARS_MESSAGE` is not exported from `errors.ts`, search the codebase for how `titleSchema` (in `commands/session/shared.ts`) imports its control-char message — reuse that exact import.

- [ ] **Step 4: Create `apps/cli/src/commands/memory/show.ts`**

```ts
import type { CoreRegistry } from "@megasaver/core";
import { defineCommand } from "citty";
import {
  mapErrorToCliMessage,
  memoryEntryNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { formatMemoryShowLines, memoryEntryIdSchema } from "./shared.js";

export type RunMemoryShowInput = {
  memoryEntryId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runMemoryShow(input: RunMemoryShowInput): Promise<0 | 1> {
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

  let parsedId: string;
  try {
    parsedId = memoryEntryIdSchema.parse(input.memoryEntryId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const entry = registry.getMemoryEntry(parsedId as never);
    if (!entry) {
      const cli = memoryEntryNotFoundMessage(parsedId);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    for (const line of formatMemoryShowLines(entry)) input.stdout(line);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryShowCommand = defineCommand({
  meta: { name: "show", description: "Show a memory entry's full details." },
  args: {
    memoryEntryId: {
      type: "positional",
      required: true,
      description: "Memory entry id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runMemoryShow({
      memoryEntryId: typeof args.memoryEntryId === "string" ? args.memoryEntryId : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

The `as never` cast on `parsedId` handles the branded `MemoryEntryId` type expectation. If TS narrows the brand correctly through `memoryEntryIdSchema.parse`, drop the cast.

- [ ] **Step 5: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 147 prior + 4 new = **151 passing**.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/memory/shared.ts \
        apps/cli/src/commands/memory/show.ts \
        apps/cli/test/memory.test.ts
git commit -m "feat(cli): mega memory show + shared helpers"
```

---

### Task 3: `memory/list.ts` + 4 tests

**Files:**
- Create: `apps/cli/src/commands/memory/list.ts`
- Modify: `apps/cli/src/commands/memory/shared.ts` (add `formatMemoryListLine`)
- Modify: `apps/cli/test/memory.test.ts` (append describe block)

**Goal:** `mega memory list <projectName>` end-to-end. 4 tests.

- [ ] **Step 1: Append the failing tests (RED)**

Append to `apps/cli/test/memory.test.ts`:

```ts
import { memoryListCommand } from "../src/commands/memory/list.js";

describe("memoryListCommand", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memlist-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
  });

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await writeFile(join(store, "memory-entries.json"), "[]");
  }

  async function seedEntries(entries: object[]): Promise<void> {
    await writeFile(join(store, "memory-entries.json"), JSON.stringify(entries));
  }

  async function runList(): Promise<void> {
    await memoryListCommand.run?.({
      args: { projectName: "demo", store },
      cmd: memoryListCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("emits empty stdout for project with zero memory entries", async () => {
    await seedProject();
    await runList();
    expect(process.exitCode).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("emits one line for a project-scoped entry", async () => {
    await seedProject();
    await seedEntries([
      {
        id: MEMORY_ID_PROJECT,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "user prefers TS",
        createdAt: TS,
      },
    ]);
    await runList();
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(MEMORY_ID_PROJECT);
    expect(lines[0]).toContain("project");
    expect(lines[0]).toContain("user prefers TS");
  });

  it("renders mixed project- and session-scoped entries in declaration order", async () => {
    await seedProject();
    await seedEntries([
      {
        id: MEMORY_ID_PROJECT,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "first",
        createdAt: TS,
      },
      {
        id: MEMORY_ID_SESSION,
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        scope: "session",
        content: "second",
        createdAt: TS,
      },
    ]);
    await runList();
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(MEMORY_ID_PROJECT);
    expect(lines[0]).toContain("-");
    expect(lines[1]).toContain(MEMORY_ID_SESSION);
    expect(lines[1]).toContain(SESSION_ID);
  });

  it("truncates long content with U+2026 marker", async () => {
    await seedProject();
    const long = "a".repeat(100);
    await seedEntries([
      {
        id: MEMORY_ID_PROJECT,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: long,
        createdAt: TS,
      },
    ]);
    await runList();
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toMatch(/a{59}…$/);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run memory.test`
Expected: import fails.

- [ ] **Step 3: Add `formatMemoryListLine` to `apps/cli/src/commands/memory/shared.ts`**

Append to `shared.ts`:

```ts
const SCOPE_COLUMN_WIDTH = 7;
const SESSION_COLUMN_WIDTH = 36;
const CONTENT_TRUNCATE_AT = 60; // 59 chars + 1 ellipsis

export function formatMemoryListLine(entry: {
  id: string;
  sessionId: string | null;
  scope: "project" | "session";
  content: string;
}): string {
  const id = entry.id;
  const scope = entry.scope.padEnd(SCOPE_COLUMN_WIDTH, " ");
  const session = (entry.sessionId ?? "-").padEnd(SESSION_COLUMN_WIDTH, " ");
  const content = truncate(entry.content, CONTENT_TRUNCATE_AT);
  return `${id}  ${scope}  ${session}  ${content}`;
}

function truncate(value: string, max: number): string {
  if ([...value].length <= max) return value;
  return `${[...value].slice(0, max - 1).join("")}…`;
}
```

The `[...value]` codepoint iteration handles surrogate pairs correctly for any future non-BMP content. Since `contentSchema` rejects control chars, multi-line content is impossible — single-line truncation is safe.

- [ ] **Step 4: Create `apps/cli/src/commands/memory/list.ts`**

```ts
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  mapErrorToCliMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { formatMemoryListLine } from "./shared.js";

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

export type RunMemoryListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runMemoryList(input: RunMemoryListInput): Promise<0 | 1> {
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

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    for (const entry of registry.listMemoryEntries(project.id)) {
      input.stdout(formatMemoryListLine(entry));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryListCommand = defineCommand({
  meta: { name: "list", description: "List memory entries under a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runMemoryList({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

If `projectNameSchema` is exported from a shared location (e.g. `apps/cli/src/commands/session/shared.ts` or `apps/cli/src/commands/project/shared.ts`), prefer importing it. If not, the inline copy here is acceptable; a future cleanup slot can extract it.

- [ ] **Step 5: Run tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 151 prior + 4 new = **155 passing**.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/commands/memory/list.ts \
        apps/cli/src/commands/memory/shared.ts \
        apps/cli/test/memory.test.ts
git commit -m "feat(cli): mega memory list"
```

---

### Task 4: `memory/create.ts` + 11 tests

**Files:**
- Create: `apps/cli/src/commands/memory/create.ts`
- Modify: `apps/cli/test/memory.test.ts` (append describe block)

**Goal:** `mega memory create` end-to-end with full validation. 11 tests.

- [ ] **Step 1: Append the failing tests (RED)**

Append to `apps/cli/test/memory.test.ts`:

```ts
import { memoryCreateCommand } from "../src/commands/memory/create.js";

describe("memoryCreateCommand", () => {
  let store: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-memcreate-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    delete process.env.MEGA_TEST_MEMORY_ENTRY_ID;
    delete process.env.MEGA_TEST_NOW;
    await rm(store, { recursive: true, force: true });
  });

  async function seedProjectOnly(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await writeFile(join(store, "memory-entries.json"), "[]");
  }

  async function seedSessionToo(): Promise<void> {
    await seedProjectOnly();
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
  }

  async function readMemory(): Promise<Array<Record<string, unknown>>> {
    return JSON.parse(await readFile(join(store, "memory-entries.json"), "utf8"));
  }

  async function runCreate(args: Record<string, string>): Promise<void> {
    process.env.NODE_ENV = "test";
    process.env.MEGA_TEST_MEMORY_ENTRY_ID = MEMORY_ID_PROJECT;
    process.env.MEGA_TEST_NOW = TS;
    await memoryCreateCommand.run?.({
      args: { ...args, store },
      cmd: memoryCreateCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("creates a project-scoped entry", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "user prefers TS" });
    expect(process.exitCode).toBe(0);
    const arr = await readMemory();
    expect(arr).toHaveLength(1);
    expect(arr[0]?.scope).toBe("project");
    expect(arr[0]?.sessionId).toBeNull();
    expect(arr[0]?.content).toBe("user prefers TS");
  });

  it("creates a session-scoped entry with --session", async () => {
    await seedSessionToo();
    await runCreate({
      projectName: "demo",
      scope: "session",
      content: "checked CSRF token expiry",
      session: SESSION_ID,
    });
    expect(process.exitCode).toBe(0);
    const arr = await readMemory();
    expect(arr[0]?.scope).toBe("session");
    expect(arr[0]?.sessionId).toBe(SESSION_ID);
  });

  it("stamps id from MEGA_TEST_MEMORY_ENTRY_ID under NODE_ENV=test", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "x" });
    const arr = await readMemory();
    expect(arr[0]?.id).toBe(MEMORY_ID_PROJECT);
  });

  it("stamps createdAt from MEGA_TEST_NOW under NODE_ENV=test", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "x" });
    const arr = await readMemory();
    expect(arr[0]?.createdAt).toBe(TS);
  });

  it("rejects missing project with project_not_found", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "nope", scope: "project", content: "x" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => /project "nope" not found/.test(c[0] as string))).toBe(true);
  });

  it("rejects unknown session id (with --scope session)", async () => {
    await seedProjectOnly(); // session is NOT seeded here
    await runCreate({
      projectName: "demo",
      scope: "session",
      content: "x",
      session: "99999999-9999-4999-8999-999999999999",
    });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => /session "99999999.*" not found/.test(c[0] as string))).toBe(true);
  });

  it("rejects empty --content", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("rejects --content with embedded newline", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "first\nsecond" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("rejects --scope bogus with documented enum error", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "bogus", content: "x" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /^error: invalid scope "bogus", expected: project \| session/.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects --scope project --session combo", async () => {
    await seedProjectOnly();
    await runCreate({
      projectName: "demo",
      scope: "project",
      content: "x",
      session: SESSION_ID,
    });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === "error: --session is not allowed when --scope is project",
      ),
    ).toBe(true);
  });

  it("rejects --scope session without --session", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "session", content: "x" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === "error: --session is required when --scope is session",
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run memory.test`
Expected: 11 fail because `memoryCreateCommand` not yet exported.

- [ ] **Step 3: Create `apps/cli/src/commands/memory/create.ts`**

```ts
import {
  type MemoryEntry,
  memoryEntrySchema,
  memoryScopeSchema,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  NAME_CONTROL_CHARS_MESSAGE,
  invalidScopeMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
  scopeProjectWithSessionMessage,
  scopeSessionWithoutSessionMessage,
} from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";
import { contentSchema } from "./shared.js";

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

function readTestEnv(name: string): string | undefined {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (process.env["NODE_ENV"] !== "test") return undefined;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  return process.env[name];
}

export type RunMemoryCreateInput = {
  projectName: string;
  scopeFlag: string;
  contentFlag: string;
  sessionFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  newId?: () => string;
  now?: () => string;
};

export async function runMemoryCreate(input: RunMemoryCreateInput): Promise<0 | 1> {
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

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Scope validation (closed enum, custom error wording).
  let scope: "project" | "session";
  const scopeResult = memoryScopeSchema.safeParse(input.scopeFlag);
  if (!scopeResult.success) {
    const cli = invalidScopeMessage(input.scopeFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  scope = scopeResult.data;

  // Cross-field guard.
  if (scope === "project" && input.sessionFlag !== undefined) {
    const cli = scopeProjectWithSessionMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }
  if (scope === "session" && input.sessionFlag === undefined) {
    const cli = scopeSessionWithoutSessionMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Session id parse (only if --scope session).
  let parsedSessionId: string | null = null;
  if (input.sessionFlag !== undefined) {
    try {
      parsedSessionId = sessionIdSchema.parse(input.sessionFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  // Content validation (control char + min(1)).
  let content: string;
  try {
    content = contentSchema.parse(input.contentFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    if (parsedSessionId !== null) {
      const session = registry.getSession(parsedSessionId as never);
      if (!session) {
        input.stderr(`error: session "${parsedSessionId}" not found`);
        return 1;
      }
    }

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_MEMORY_ENTRY_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();

    const entry: MemoryEntry = memoryEntrySchema.parse({
      id,
      projectId: project.id,
      sessionId: parsedSessionId,
      scope,
      content,
      createdAt,
    });

    registry.createMemoryEntry(entry);
    input.stdout(entry.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a memory entry on a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    // Keep in sync with memoryScopeSchema in @megasaver/core.
    scope: {
      type: "string",
      required: true,
      description: "Memory scope (project | session).",
    },
    content: {
      type: "string",
      required: true,
      description: "Memory content (non-empty, single-line).",
    },
    session: {
      type: "string",
      description: "Session id (UUID); required when --scope session.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runMemoryCreate({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      scopeFlag: typeof args.scope === "string" ? args.scope : "",
      contentFlag: typeof args.content === "string" ? args.content : "",
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 155 prior + 11 new = **166 passing**.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/memory/create.ts apps/cli/test/memory.test.ts
git commit -m "feat(cli): mega memory create"
```

---

### Task 5: `memory/index.ts` + main.ts wiring

**Files:**
- Create: `apps/cli/src/commands/memory/index.ts`
- Modify: `apps/cli/src/main.ts`

**Goal:** Wire the parent `mega memory` subcommand into the top-level CLI. No new tests. The 19 memory tests + 5 errors tests already exercise the per-subcommand modules end-to-end.

- [ ] **Step 1: Create `apps/cli/src/commands/memory/index.ts`**

```ts
import { defineCommand } from "citty";
import { memoryCreateCommand } from "./create.js";
import { memoryListCommand } from "./list.js";
import { memoryShowCommand } from "./show.js";

export {
  type RunMemoryCreateInput,
  runMemoryCreate,
  memoryCreateCommand,
} from "./create.js";
export {
  type RunMemoryListInput,
  runMemoryList,
  memoryListCommand,
} from "./list.js";
export {
  type RunMemoryShowInput,
  runMemoryShow,
  memoryShowCommand,
} from "./show.js";

export const memoryCommand = defineCommand({
  meta: { name: "memory", description: "Manage Mega Saver memory entries." },
  subCommands: {
    create: memoryCreateCommand,
    list: memoryListCommand,
    show: memoryShowCommand,
  },
});
```

- [ ] **Step 2: Update `apps/cli/src/main.ts`**

Add the memory import + register it in the parent's `subCommands`. Read `main.ts` first to see the existing structure. Typical shape:

```ts
import { memoryCommand } from "./commands/memory/index.js";

// ...inside the existing megaCommand defineCommand:
subCommands: {
  doctor: doctorCommand,
  project: projectCommand,
  session: sessionCommand,
  connector: connectorCommand,
  memory: memoryCommand, // ADD THIS LINE
}
```

(Match the existing alphabetisation / order; the spec says "fifth top-level subcommand" implying chronological order, but if the file alphabetises, follow that.)

- [ ] **Step 3: Run tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: still 166 passing (no test count change in T5).

- [ ] **Step 4: Build smoke**

Run: `pnpm --filter @megasaver/cli build`
Expected: build succeeds. (Run optionally:
`node apps/cli/dist/cli.js memory --help`
should print the parent's help with the three subcommands. This is a manual smoke and not a test gate.)

- [ ] **Step 5: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/memory/index.ts apps/cli/src/main.ts
git commit -m "feat(cli): wire mega memory parent command"
```

---

### Task 6: Ship — changeset + wiki + verify

**Files:**
- Create: `.changeset/memory-entry-cli.md`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

**Goal:** DoD verify, changeset, wiki updates. PR slot left `TBD` (post-merge fill).

- [ ] **Step 1: Initial `pnpm verify`**

Run: `pnpm verify`
Expected: 12/12 tasks green. Total tests: 24 (shared) + 128 (core) + 56 (connectors-shared) + 45 (connector-claude-code) + 26 (connector-generic-cli) + 166 (cli) = **445**.

If verify is red, STOP and report BLOCKED.

- [ ] **Step 2: Write changeset**

Create `.changeset/memory-entry-cli.md`:

```md
---
"@megasaver/cli": minor
---

Add `mega memory create/list/show` subcommands as a thin CLI layer
over the existing `CoreRegistry.{createMemoryEntry,getMemoryEntry,
listMemoryEntries}` surface. Append-only ledger; no `delete` or
`update`. `--content` rejects empty / control-char / multi-line at
the CLI boundary via a new `contentSchema` (mirrors `titleSchema`).
Cross-field guard: `--scope project` rejects `--session`;
`--scope session` requires `--session <uuid>`. `mega connector
sync` / `status` continue to pass `memoryEntries: []` to
`buildConnectorContext` — wiring to read real entries is a
separate slot.
```

- [ ] **Step 3: Update `wiki/entities/cli.md`**

Insert the following subsection between `### \`mega session update\`` and `### \`mega connector sync\``:

```md
### `mega memory create <projectName> --scope <project|session> --content "..." [--session <uuid>]`

Append a memory entry under a project. `--scope` is required and
must be `project` or `session`. `--content` is required, non-empty,
and rejects control characters / multi-line input. When
`--scope session`, `--session <uuid>` is required and must resolve
to an open or ended session under the same project; when
`--scope project`, `--session` is rejected. Output is the new
memory entry id on stdout.

### `mega memory list <projectName>`

Lists memory entries under a project as
`<id>  <scope>  <session|->  <content-truncated>` lines, two
spaces between fields. Content is truncated to 59 chars + `…` when
longer than 60. Empty project → empty stdout, exit 0.

### `mega memory show <memoryEntryId>`

Prints six aligned `key=value` lines (12-char key column,
two-space gutter): `id`, `project`, `session`, `scope`, `content`,
`createdAt`. `null` sessionId renders as `-`.
```

In the `## Risk` section at the bottom, append:

```md
MemoryEntry CLI: PR <https://github.com/haJ1t/MegaSaver/pull/TBD> (TBD).
```

- [ ] **Step 4: Update `wiki/index.md` Status section**

Replace the leading paragraph so MemoryEntry CLI is the lead announcement. Bump test counts:
- cli 142 → 166
- total 421 → 445

Replacement leading paragraph (preserve existing Markdown style):

```
MemoryEntry CLI landed via PR #TBD (`TBD`): new
`mega memory create/list/show` subcommands as a thin CLI layer
over the existing `CoreRegistry.{createMemoryEntry,getMemoryEntry,
listMemoryEntries}` surface. Append-only ledger; no delete/update
in v0.1. `--content` rejects empty / control-char / multi-line at
the CLI boundary; `--scope` cross-field guard enforces
project↔session pairing. `mega connector sync` / `status` continue
to pass `memoryEntries: []` to the block context — wiring to read
the real list is a separate slot. Previously: …
```

(Continue with the existing prior-merge prose.)

In the `## Quick links by question` table, append:

```md
| What does `mega memory` ship?                      | [[entities/cli]]                                |
```

- [ ] **Step 5: Append to `wiki/log.md`**

Append at the END:

```md
## [2026-05-09] schema | MemoryEntry CLI

- Spec: `docs/superpowers/specs/2026-05-09-memory-entry-cli-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-memory-entry-cli-plan.md`
- Branch: `feat/memory-cli`
- Result: `mega memory create/list/show` lands as a thin CLI layer
  over the existing CoreRegistry surface. Append-only ledger; no
  delete/update. `--content` control-char guard at the CLI
  boundary; cross-field scope/session guard. Connector context
  wiring (sync/status reading real `listMemoryEntries`) deferred
  to a separate slot. 24 new tests (19 memory + 5 errors).
  cli 142 → 166, total 421 → 445. PR: TBD.
```

- [ ] **Step 6: Final `pnpm verify`**

Run: `pnpm verify`
Expected: still green.

- [ ] **Step 7: Commit**

```bash
git add .changeset/memory-entry-cli.md \
        wiki/entities/cli.md wiki/index.md wiki/log.md
git commit -m "feat(memory): ship CLI + wiki"
```

---

## Self-review

**Spec coverage:**
- §3.1 surface (3 subcommands, parent registered) → T2 + T3 + T4 + T5. ✓
- §3.2 create flag set + cross-field + pre-flight session check + test injection → T4. ✓
- §3.3 list output format + truncation → T3. ✓
- §3.4 show output format → T2. ✓
- §3.5 errors module extensions → T1. ✓
- §3.6 file layout → T2 (shared+show), T3 (list), T4 (create), T5 (index+main). ✓
- §5 test plan (19 memory + 5 errors = 24) → T1 (5) + T2 (4) + T3 (4) + T4 (11) = 24. ✓
- §6 risk MEDIUM, full chain → T6 runs `pnpm verify`. ✓
- §7 out-of-scope items → no task addresses delete/update/connector-wiring. ✓

**Placeholder scan:** every `TBD` is the intentional post-merge PR-fill marker. No "TODO" / "TBD" appears in production code or test code.

**Type consistency:**
- `memoryEntrySchema`, `memoryScopeSchema` imported from `@megasaver/core` consistently.
- `contentSchema` lives in `commands/memory/shared.ts` and is the only consumer of the control-char guard for `--content`.
- `RunMemoryCreateInput`, `RunMemoryListInput`, `RunMemoryShowInput` follow the existing `Run*Input` shape (`stdout`, `stderr`, `cwd`, `home`, `xdgDataHome`, `storeFlag`).
- `KNOWN_SCOPE_IDS = ["project", "session"] as const satisfies readonly MemoryScope[]` matches the established drift-guard pattern.
- `memoryEntryNotFoundMessage(id)` / `invalidScopeMessage(value)` / `scopeProjectWithSessionMessage()` / `scopeSessionWithoutSessionMessage()` follow the existing `*Message` helper pattern.

**Test math:** T1 +5 (errors), T2 +4 (show), T3 +4 (list), T4 +11 (create), T5 +0 = **24 new tests**. CLI 142 → 166. Project 421 → 445.

---

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task,
   two-stage review (spec compliance → code quality) between tasks.
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
