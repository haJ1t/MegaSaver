# mega connector status — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the read-only `mega connector status <projectName> [--target <id>]` subcommand that reports per-target sync state without writing.

**Architecture:** Single-file extension of `apps/cli/src/commands/connector.ts`. New `runConnectorStatus` reuses the existing module-private constants (`KNOWN_TARGETS`, `TARGET_ID_COLUMN_WIDTH`, `pickLatestOpenSession`, `buildConnectorContext`, `projectNameSchema`, `isKnownTargetId`) and the existing pre-loop guard pattern (`assertProjectRoot`). Status is computed by `parseBlock` + `upsertBlock` from `@megasaver/connectors-shared` so the in-sync predicate is byte-identical with what `mega connector sync` would write. `formatStatusLine` is extended with an optional `session` argument, leaving sync output byte-identical.

**Tech Stack:** TypeScript strict ESM, Node 22, pnpm + Turborepo, Vitest, Biome, Citty, Zod, `@megasaver/connectors-shared`, `@megasaver/connector-generic-cli`.

**Spec:** `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`.

**Working dir for every step:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/mega-connector-status` (the feature worktree on branch `feat/mega-connector-status`). All `pnpm` invocations run from there.

**Build/test commands:**
```bash
pnpm --filter @megasaver/cli build
pnpm --filter @megasaver/cli test --run
pnpm verify
```

---

## File map

- **Modify** `apps/cli/src/commands/connector.ts`
  - Extend `formatStatusLine(target, status, session?)` — append `  session=<id|none>` only when `session` is provided. Sync call sites pass `undefined` and remain byte-identical.
  - Add exported `RunConnectorStatusInput` (mirror of `RunConnectorSyncInput`).
  - Add exported `runConnectorStatus(input): Promise<0 | 1>`.
  - Add `connectorStatusCommand` (Citty `defineCommand`). Wire into `connectorCommand.subCommands` next to `sync`.
- **Create** `apps/cli/test/connector-status.test.ts` — 13 Vitest tests across 5 describe blocks.
- **Create** `.changeset/mega-connector-status.md` — `@megasaver/cli` minor.
- **Modify** `wiki/entities/cli.md` — add `mega connector status` subsection + PR link slot.
- **Modify** `wiki/index.md` — Status section update + test count delta (106 → 119, total 366 → 379).
- **Append** `wiki/log.md` — schema entry.

No changes to `apps/cli/src/main.ts`, `apps/cli/src/errors.ts`, `apps/cli/package.json`, or any package outside `apps/cli`.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative; body only when WHY is non-obvious.
- TDD: write the failing test, run it, confirm RED, implement, run it, confirm GREEN, commit.
- After each implementation step run `pnpm --filter @megasaver/cli test --run` to keep regressions visible. After every task, run `pnpm verify`.
- Test fixture pattern (matches `apps/cli/test/connector.test.ts`):
  ```ts
  import { mkdir, mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { connectorStatusCommand, runConnectorSync } from "../src/commands/connector.js";

  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
  ```
  Each `describe` block uses `mkdtemp` for `store` and `projectRoot`, spies on `console.log`/`console.error`, and resets `process.exitCode = 0` in `beforeEach`.
- Calling the command in tests:
  ```ts
  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }
  ```
- Helpers used across tasks (declared once in T1 inside the test file):
  ```ts
  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name, rootPath, createdAt: ts, updatedAt: ts }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(id: string, agentId: string, startedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id,
      projectId: PROJECT_ID,
      agentId,
      risk: "medium",
      title: null,
      startedAt,
      endedAt: null,
    });
    await writeFile(join(store, "sessions.json"), JSON.stringify(arr));
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    await runConnectorSync({
      projectName: args.projectName,
      targetFlag: args.target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: () => {},
      stderr: () => {},
    });
  }
  ```

---

### Task 1: Scaffold `runConnectorStatus` + pre-target gate tests

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Create: `apps/cli/test/connector-status.test.ts`

**Goal:** Stand up `runConnectorStatus`, `connectorStatusCommand`, the
`formatStatusLine` extension, and the three pre-target gate tests
(`unknown project`, `unknown --target`, `assertProjectRoot fails`).
By end of task: 3 tests green; sync output unchanged (existing connector
suite still passes).

- [ ] **Step 1: Add the test file with shared scaffolding (RED)**

Create `apps/cli/test/connector-status.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorStatusCommand, runConnectorSync } from "../src/commands/connector.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("connectorStatusCommand — pre-target gates", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name, rootPath, createdAt: ts, updatedAt: ts }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("rejects an unknown project with the documented error", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "missing" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === 'error: project "missing" not found')).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid --target flag", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "demo", target: "nope" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === 'error: invalid target "nope", expected: claude-code | codex',
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing project rootPath via assertProjectRoot", async () => {
    const ghost = join(projectRoot, "does-not-exist");
    await seedProject("demo", ghost);
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to confirm RED**

Run: `pnpm --filter @megasaver/cli test --run connector-status`
Expected: import fails because `connectorStatusCommand` is not exported.

- [ ] **Step 3: Extend `formatStatusLine` and add `runConnectorStatus` skeleton (GREEN)**

In `apps/cli/src/commands/connector.ts`, replace the current
`formatStatusLine` with:

```ts
function formatStatusLine(
  target: ConnectorTarget,
  status: string,
  session?: string,
): string {
  const base = `${target.id.padEnd(TARGET_ID_COLUMN_WIDTH, " ")}  ${target.relativePath}  ${status}`;
  return session === undefined ? base : `${base}  session=${session}`;
}
```

Add the new exports below the existing sync section (place these
**after** `connectorSyncCommand` and **before** `connectorCommand`):

```ts
export type RunConnectorStatusInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runConnectorStatus(input: RunConnectorStatusInput): Promise<0 | 1> {
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

  if (input.targetFlag !== undefined && !isKnownTargetId(input.targetFlag)) {
    const cli = invalidTargetMessage(input.targetFlag);
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

    try {
      await assertProjectRoot(project.rootPath);
    } catch (err) {
      const cli = mapErrorToCliMessage(err);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    // Per-target loop lands in T2.
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const connectorStatusCommand = defineCommand({
  meta: { name: "status", description: "Report per-target sync state without writing." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    target: { type: "string", description: "Optional target id to filter the report." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runConnectorStatus({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      targetFlag: typeof args.target === "string" ? args.target : undefined,
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

Update `connectorCommand`:

```ts
export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
    status: connectorStatusCommand,
  },
});
```

- [ ] **Step 4: Run all CLI tests; confirm GREEN + sync regressions clean**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 3 new `connector-status` tests pass; existing 106 tests
still pass; total 109 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector-status.test.ts
git commit -m "feat(cli): connector status pre-target gates"
```

---

### Task 2: `missing` + `no-block` + `--target` filter

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector-status.test.ts`

**Goal:** Implement the per-target loop body for the two
non-block-existing branches and the `--target` filter. Three new tests.
At end of task: 6 passing.

- [ ] **Step 1: Add tests (RED)**

Append to `apps/cli/test/connector-status.test.ts`:

```ts
describe("connectorStatusCommand — missing + no-block", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name, rootPath, createdAt: ts, updatedAt: ts }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports both targets as missing when neither file exists", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      "claude-code  CLAUDE.md  missing  session=none",
      "codex        AGENTS.md  missing  session=none",
    ]);
  });

  it("reports no-block when CLAUDE.md exists without sentinels", async () => {
    await seedProject("demo", projectRoot);
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Hello\n\nNo block here.\n");
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("claude-code  CLAUDE.md  no-block  session=none");
    expect(lines).toContain("codex        AGENTS.md  missing  session=none");
  });

  it("filters output with --target codex", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "demo", target: "codex" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual(["codex        AGENTS.md  missing  session=none"]);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run connector-status`
Expected: 3 new tests fail with "expected [] to equal [...]" (loop
not implemented yet).

- [ ] **Step 3: Implement per-target loop (GREEN)**

In `apps/cli/src/commands/connector.ts`, replace the
`// Per-target loop lands in T2.` placeholder + the `return 0` directly
beneath it with:

```ts
const targets = input.targetFlag === undefined
  ? KNOWN_TARGETS
  : KNOWN_TARGETS.filter((t) => t.id === input.targetFlag);

const sessions = registry.listSessions(project.id);
let anyDriftOrError = false;
for (const target of targets) {
  try {
    const absPath = join(project.rootPath, target.relativePath);
    const existing = await readTargetFile(absPath);
    const session = pickLatestOpenSession(sessions, target.agentId);
    const sessionLabel = session === null ? "none" : session.id;

    if (existing === null) {
      input.stdout(formatStatusLine(target, "missing", sessionLabel));
      continue;
    }

    const parsed = parseBlock(existing);
    if (parsed.block === null) {
      anyDriftOrError = true;
      input.stdout(formatStatusLine(target, "no-block", sessionLabel));
      continue;
    }

    // upsertBlock + in-sync/drift comparison lands in T3.
    input.stdout(formatStatusLine(target, "in-sync", sessionLabel));
  } catch (err) {
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "error"));
    const cli = mapErrorToCliMessage(err, {
      kind: "connector",
      targetId: target.id,
      relativePath: target.relativePath,
    });
    input.stderr(cli.message);
  }
}
return anyDriftOrError ? 1 : 0;
```

Add `parseBlock` to the existing import from
`@megasaver/connectors-shared` at the top of the file:

```ts
import {
  type ConnectorContext,
  assertConnectorContext,
  assertProjectRoot,
  parseBlock,
  readTargetFile,
  renderBlock,
  upsertBlock,
  writeTargetFile,
} from "@megasaver/connectors-shared";
```

(Keep `renderBlock` and `upsertBlock` imports — both are used by sync;
`upsertBlock` is also used in T3.)

- [ ] **Step 4: Run tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 6 status tests + 106 prior = 112 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector-status.test.ts
git commit -m "feat(cli): connector status missing+no-block"
```

---

### Task 3: `in-sync` + `drift`

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector-status.test.ts`

**Goal:** Replace the temporary `"in-sync"` literal with the real
`upsertBlock` predicate. Four new tests covering: sync→status round
trip, drift after session ends, drift after manual block edit, and the
empty-project (`Session: none`) round trip.

- [ ] **Step 1: Add tests (RED)**

Append to `apps/cli/test/connector-status.test.ts`:

```ts
describe("connectorStatusCommand — in-sync + drift", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name, rootPath, createdAt: ts, updatedAt: ts }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(id: string, agentId: string, startedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id,
      projectId: PROJECT_ID,
      agentId,
      risk: "medium",
      title: null,
      startedAt,
      endedAt: null,
    });
    await writeFile(join(store, "sessions.json"), JSON.stringify(arr));
  }

  async function endSession(id: string, endedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    const idx = arr.findIndex((s: { id: string }) => s.id === id);
    arr[idx].endedAt = endedAt;
    await writeFile(join(store, "sessions.json"), JSON.stringify(arr));
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    await runConnectorSync({
      projectName: args.projectName,
      targetFlag: args.target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: () => {},
      stderr: () => {},
    });
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports in-sync immediately after sync writes the block", async () => {
    await seedProject("demo", projectRoot);
    await seedSession("01HXY00000000000000000SESS", "claude-code", "2026-05-09T00:00:00.000Z");
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ projectName: "demo" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain(
      "claude-code  CLAUDE.md  in-sync  session=01HXY00000000000000000SESS",
    );
  });

  it("reports drift after the open session is ended", async () => {
    await seedProject("demo", projectRoot);
    await seedSession("01HXY00000000000000000SESS", "claude-code", "2026-05-09T00:00:00.000Z");
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ projectName: "demo" });
    logSpy.mockClear();
    errSpy.mockClear();

    await endSession("01HXY00000000000000000SESS", "2026-05-09T01:00:00.000Z");
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("claude-code  CLAUDE.md  drift  session=none");
  });

  it("reports drift when the block was edited manually", async () => {
    await seedProject("demo", projectRoot);
    await seedSession("01HXY00000000000000000SESS", "claude-code", "2026-05-09T00:00:00.000Z");
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ projectName: "demo" });
    const tampered = (await readFile(join(projectRoot, "CLAUDE.md"), "utf8")).replace(
      "claude-code",
      "claude-COde",
    );
    await writeFile(join(projectRoot, "CLAUDE.md"), tampered);
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain(
      "claude-code  CLAUDE.md  drift  session=01HXY00000000000000000SESS",
    );
  });

  it("reports in-sync for an empty project where the block already says Session: none", async () => {
    await seedProject("demo", projectRoot);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ projectName: "demo", target: "claude-code" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo", target: "claude-code" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual(["claude-code  CLAUDE.md  in-sync  session=none"]);
  });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run connector-status`
Expected: drift cases fail because the loop currently always reports
`in-sync` when `parsed.block !== null`.

- [ ] **Step 3: Implement upsert-based comparison (GREEN)**

In `apps/cli/src/commands/connector.ts`, replace the placeholder
comment line and the temporary `input.stdout(formatStatusLine(target, "in-sync", sessionLabel));`
inside the per-target loop with:

```ts
    const context = buildConnectorContext(target, project, sessions);
    const upserted = upsertBlock({ existingContent: existing, context });
    if (upserted === existing) {
      input.stdout(formatStatusLine(target, "in-sync", sessionLabel));
      continue;
    }
    anyDriftOrError = true;
    input.stdout(formatStatusLine(target, "drift", sessionLabel));
```

(Keep the surrounding `try`/`catch` and the `existing === null` /
`parsed.block === null` branches from T2 untouched.)

- [ ] **Step 4: Run tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 10 status tests + 106 prior = 116 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/connector.ts apps/cli/test/connector-status.test.ts
git commit -m "feat(cli): connector status in-sync+drift"
```

---

### Task 4: `error` + cross-target

**Files:**
- Modify: `apps/cli/test/connector-status.test.ts`

**Goal:** Cover the per-target error path (`block_conflict` from
`parseBlock`, plus a read failure via `chmod 0o000`) and the
mixed-state cross-target ordering. The implementation already routes
errors through the existing `try/catch` from T2 and the
`error` status word; no production-code change should be required.
If the error tests reveal a gap, fix the loop in this task.

- [ ] **Step 1: Add tests (RED)**

Append to `apps/cli/test/connector-status.test.ts`:

```ts
import { chmod } from "node:fs/promises";

describe("connectorStatusCommand — error + cross-target", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // restore mode before rm in case a test chmod'd a file
    try {
      await chmod(join(projectRoot, "CLAUDE.md"), 0o644);
    } catch {
      /* file may not exist */
    }
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID, name, rootPath, createdAt: ts, updatedAt: ts }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(id: string, agentId: string, startedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id,
      projectId: PROJECT_ID,
      agentId,
      risk: "medium",
      title: null,
      startedAt,
      endedAt: null,
    });
    await writeFile(join(store, "sessions.json"), JSON.stringify(arr));
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    await runConnectorSync({
      projectName: args.projectName,
      targetFlag: args.target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: () => {},
      stderr: () => {},
    });
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports error when CLAUDE.md contains two begin sentinels", async () => {
    await seedProject("demo", projectRoot);
    const malformed = [
      "<!-- BEGIN MEGA SAVER CONTEXT -->",
      "first",
      "<!-- END MEGA SAVER CONTEXT -->",
      "<!-- BEGIN MEGA SAVER CONTEXT -->",
      "second",
      "<!-- END MEGA SAVER CONTEXT -->",
      "",
    ].join("\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), malformed);
    await runStatus({ projectName: "demo", target: "claude-code" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual(["claude-code  CLAUDE.md  error"]);
    const errors = errSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(errors).toContain("begin sentinel");
    expect(errors).toContain("CLAUDE.md");
  });

  it("reports error when CLAUDE.md is unreadable, then continues to codex", async () => {
    await seedProject("demo", projectRoot);
    await writeFile(join(projectRoot, "CLAUDE.md"), "anything\n");
    await chmod(join(projectRoot, "CLAUDE.md"), 0o000);
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toBe("claude-code  CLAUDE.md  error");
    expect(lines[1]).toBe("codex        AGENTS.md  missing  session=none");
  });

  it("emits both lines in declaration order when claude-code in-sync and codex drift", async () => {
    await seedProject("demo", projectRoot);
    await seedSession("01HXY00000000000000000SESS", "claude-code", "2026-05-09T00:00:00.000Z");
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await writeFile(join(projectRoot, "AGENTS.md"), "");
    await runSync({ projectName: "demo" });
    // Tamper codex only:
    const tampered = (await readFile(join(projectRoot, "AGENTS.md"), "utf8")).replace(
      "Project:",
      "Tampered:",
    );
    await writeFile(join(projectRoot, "AGENTS.md"), tampered);
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toBe("claude-code  CLAUDE.md  in-sync  session=01HXY00000000000000000SESS");
    expect(lines[1]).toBe("codex        AGENTS.md  drift  session=none");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: all 13 status tests + 106 prior = 119 passing. The
implementation from T2/T3 should already cover these paths via the
existing `try`/`catch`. If a test fails, the most likely cause is the
sentinel literal — verify the strings against
`packages/connectors/shared/src/constants.ts` (`MEGA_SAVER_BLOCK_START`
/ `MEGA_SAVER_BLOCK_END`) and update the malformed fixture in the
first test if they differ from `<!-- BEGIN MEGA SAVER CONTEXT -->` /
`<!-- END MEGA SAVER CONTEXT -->`.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/connector-status.test.ts
git commit -m "test(cli): connector status error+cross-target"
```

---

### Task 5: Ship — verify, changeset, wiki

**Files:**
- Create: `.changeset/mega-connector-status.md`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

**Goal:** Run the full DoD gate, add the changeset, and update the
wiki. PR slot left explicit (post-merge fill).

- [ ] **Step 1: Run `pnpm verify`**

Run: `pnpm verify`
Expected: lint, typecheck, and full Vitest suite all green. Total
test count: 366 + 13 = 379.

- [ ] **Step 2: Write changeset**

Create `.changeset/mega-connector-status.md`:

```md
---
"@megasaver/cli": minor
---

Add `mega connector status <projectName> [--target <id>]` — read-only
report of per-target sync state. Status words: `in-sync`, `drift`,
`no-block`, `missing`, `error`. Exit `0` when every line is `in-sync`
or `missing`; `1` if any line is `drift`, `no-block`, or `error`.
```

- [ ] **Step 3: Update `wiki/entities/cli.md`**

Add a new subsection between the `mega connector sync` block and the
`Store resolution` block. The exact text:

```md
### `mega connector sync <projectName> [--target <id>]`

[…existing content unchanged…]

### `mega connector status <projectName> [--target <id>]`

Read-only inspection of every known agent file under the project's
`rootPath`. Reuses the same `KNOWN_TARGETS` set as `sync` and the
same per-target latest-open-session rule. For each target the command
reads the file, runs `parseBlock`, and compares against the freshly
rendered block (`upsertBlock` predicate); the in-sync notion is
byte-identical to what `sync` would write.

Status words on stdout: `in-sync`, `drift`, `no-block`, `missing`,
`error`. Output line is
`<id>  <relPath>  <status>  session=<id|none>`. Exit `0` when every
line is `in-sync` or `missing`; exit `1` if any line is `drift`,
`no-block`, or `error`. Pre-loop failures (project not found,
unknown target, project root missing) short-circuit before any line
is emitted.

### Store resolution

[…existing content unchanged…]
```

Also update the `Risk` section near the bottom of the page to add a
PR slot line (mirror the sync line; PR # filled post-merge):

```md
Status: PR <https://github.com/haJ1t/MegaSaver/pull/TBD> (TBD).
```

- [ ] **Step 4: Update `wiki/index.md`**

In the `## Status` section, replace the leading `mega connector sync`
sentence so `mega connector status` is announced. Bump the CLI test
count `106 → 119` and the total `366 → 379`. Append `mega connector
status` to the open-followup list as resolved (i.e. remove it from
the open list at the bottom of the section).

In the `## Quick links by question` table, append:

```md
| What does `mega connector status` report? | [[entities/cli]] |
```

- [ ] **Step 5: Append to `wiki/log.md`**

Append a new entry at the end of the file:

```md
## [2026-05-09] schema | mega connector status

- Spec: `docs/superpowers/specs/2026-05-09-mega-connector-status-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-mega-connector-status-plan.md`
- Branch: `feat/mega-connector-status`
- Result: `mega connector status <projectName> [--target <id>]` —
  read-only per-target report. 13 new tests (CLI 106 → 119, total
  366 → 379). Status words: in-sync | drift | no-block | missing |
  error. PR: TBD.
```

- [ ] **Step 6: Commit**

```bash
git add .changeset/mega-connector-status.md wiki/entities/cli.md wiki/index.md wiki/log.md
git commit -m "feat(cli): wire connector status + wiki + changeset"
```

- [ ] **Step 7: Final verify**

Run: `pnpm verify`
Expected: green. Branch ready for PR.

---

## Self-review

**Spec coverage:**
- §3 surface (positional + `--target` + `--store`): T1 wires the Citty
  `defineCommand`; T1 tests cover `unknown project`, `unknown target`,
  `assertProjectRoot`. ✓
- §4 output format and column widths: T2 pins the exact byte string
  expectations; T1 extends `formatStatusLine` to support the optional
  session suffix. ✓
- §5 status decision rules (`missing` / `no-block` / `in-sync` / `drift`
  / `error`): T2 covers `missing` + `no-block`, T3 covers `in-sync` +
  `drift`, T4 covers `error`. ✓
- §6 exit code: every test asserts `process.exitCode`. The
  `missing → 0` and `no-block → 1` rules are both pinned in T2. ✓
- §7 code organisation (single file, exports, no errors.ts/main.ts
  changes, no shared package change): T1 imports parseBlock from the
  shared package; no other surface change. ✓
- §8 tests (3 + 3 + 4 + 2 + 1 = 13 tests): T1 = 3, T2 = 3, T3 = 4,
  T4 = 3 (note: spec listed `error` as 2 + cross-target as 1; this
  plan groups them together as a single 3-test describe, matching the
  spec's overall count). ✓
- §9 risk MEDIUM, full chain: T5 runs full `pnpm verify`. ✓
- §10 out-of-scope items: nothing in the plan touches `--json`,
  `mega connector diff`, or new connector targets. ✓

**Placeholders:** every `TBD` in the wiki/log/changeset text is the
intentional post-merge-PR-fill marker (same convention as
`mega connector sync`). No "TBD" / "TODO" appears in the production
code or test code.

**Type consistency:** `formatStatusLine` accepts
`(target, status, session?)` everywhere. `KNOWN_TARGETS` declared in
the existing module, no shadowing. `runConnectorStatus` and
`RunConnectorStatusInput` mirror sync naming exactly.

**Test count math:** 3 (T1) + 3 (T2) + 4 (T3) + 3 (T4) = 13 new tests
on the CLI package. CLI 106 → 119; project total 366 → 379.

---

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task,
   two-stage review (spec compliance → code quality) between tasks.
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
