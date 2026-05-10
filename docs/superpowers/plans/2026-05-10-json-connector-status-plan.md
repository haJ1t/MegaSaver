# --json output for connector status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--json` flag to `connectorStatusCommand` that emits a compact JSON array; preserve byte-identical text default.

**Architecture:** Add `json: boolean` to `RunConnectorStatusInput`; branch inside the per-target loop to collect records vs. emit text; emit JSON after loop when `json: true`. TDD: write failing tests first, then implement.

**Tech Stack:** TypeScript strict ESM, Citty, Vitest, Biome

---

## File Map

| File | Change |
|------|--------|
| `apps/cli/src/commands/connector.ts` | `RunConnectorStatusInput` +1 field; `runConnectorStatus` branch logic; `connectorStatusCommand` +1 arg + pass-through |
| `apps/cli/test/connector-status.test.ts` | +1 describe block (3 new tests) at end of file |

---

### Task 1: Write failing JSON tests

**Files:**
- Modify: `apps/cli/test/connector-status.test.ts` (append at end)

- [ ] **Step 1: Check the end of connector-status.test.ts**

```bash
tail -10 /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status/apps/cli/test/connector-status.test.ts
```

Note the last line number and confirm ending `});`.

- [ ] **Step 2: Append the new describe block**

Append to end of `apps/cli/test/connector-status.test.ts`:

```ts
describe("connectorStatusCommand — --json output", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PROJECT_ID_JSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SESS_JSON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-conn-json-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-conn-json-root-"));
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

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-10T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID_JSON, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(agentId: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id: SESS_JSON,
      projectId: PROJECT_ID_JSON,
      agentId,
      riskLevel: "medium",
      title: null,
      startedAt: "2026-05-10T00:00:00.000Z",
      endedAt: null,
    });
    await writeFile(join(store, "sessions.json"), JSON.stringify(arr));
  }

  async function runStatus(args: { projectName: string; target?: string; json?: boolean }): Promise<void> {
    const cliArgs: Record<string, string | boolean> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    if (args.json === true) cliArgs.json = true;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("--json emits compact JSON array with all targets missing when no files exist", async () => {
    await seedProject();

    await runStatus({ projectName: "demo", json: true });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls).toHaveLength(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as unknown[];
    expect(parsed).toEqual([
      { id: "claude-code", relativePath: "CLAUDE.md", status: "missing", session: null },
      { id: "codex", relativePath: "AGENTS.md", status: "missing", session: null },
      { id: "cursor", relativePath: ".cursor/rules/megasaver.mdc", status: "missing", session: null },
      { id: "aider", relativePath: "CONVENTIONS.md", status: "missing", session: null },
    ]);
  });

  it("--json with --target emits single-element array with correct status and session id", async () => {
    await seedProject();
    await seedSession("claude-code");
    // Seed a synced CLAUDE.md by running sync first.
    const { connectorSyncCommand } = await import("../src/commands/connector.js");
    await connectorSyncCommand.run?.({
      args: { projectName: "demo", target: "claude-code", store },
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
    logSpy.mockClear();

    await runStatus({ projectName: "demo", target: "claude-code", json: true });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls).toHaveLength(1);
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as unknown[];
    expect(parsed).toEqual([
      { id: "claude-code", relativePath: "CLAUDE.md", status: "in-sync", session: SESS_JSON },
    ]);
  });

  it("default (no --json) still emits text lines not JSON", async () => {
    await seedProject();

    await runStatus({ projectName: "demo" });

    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toHaveLength(4);
    // Text lines — NOT parseable as JSON array.
    expect(() => JSON.parse(lines[0] ?? "")).toThrow();
    expect(lines[0]).toMatch(/^claude-code\s+CLAUDE\.md\s+missing/);
  });
});
```

- [ ] **Step 3: Install deps and build (needed for tests to resolve packages)**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
pnpm install 2>&1 | tail -3 && pnpm build 2>&1 | tail -5
```

Expected: install + build succeed.

- [ ] **Step 4: Run the new tests to confirm they FAIL**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
pnpm --filter @megasaver/cli test 2>&1 | grep -E "json output|FAIL|✗|×|passed|failed" | head -15
```

Expected: 3 new tests fail (the `json` arg doesn't exist yet).

---

### Task 2: Production change — connector.ts

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`

- [ ] **Step 1: Add `json: boolean` to `RunConnectorStatusInput`**

Find:
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
```

Replace with:
```ts
export type RunConnectorStatusInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
```

- [ ] **Step 2: Add collect-then-emit logic in `runConnectorStatus`**

Find the section in `runConnectorStatus` that starts the per-target loop. It currently looks like:

```ts
    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    let anyDriftOrError = false;
    for (const target of targets) {
      const session = pickLatestOpenSession(sessions, target.agentId);
      const sessionLabel = session === null ? "none" : session.id;
      try {
        const absPath = join(project.rootPath, target.relativePath);
        const existing = await readTargetFile(absPath);

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

        const context = buildConnectorContext(target, project, sessions, memoryEntries);
        const upserted = upsertBlock({ existingContent: existing, context });
        if (upserted === existing) {
          input.stdout(formatStatusLine(target, "in-sync", sessionLabel));
          continue;
        }
        anyDriftOrError = true;
        input.stdout(formatStatusLine(target, "drift", sessionLabel));
      } catch (err) {
        anyDriftOrError = true;
        input.stdout(formatStatusLine(target, "error", sessionLabel));
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

Replace with:

```ts
    const sessions = registry.listSessions(project.id);
    const memoryEntries = registry.listMemoryEntries(project.id);
    let anyDriftOrError = false;
    type StatusRecord = { id: string; relativePath: string; status: string; session: string | null };
    const records: StatusRecord[] = [];
    const emit = (target: (typeof targets)[number], statusWord: string, session: ReturnType<typeof pickLatestOpenSession>) => {
      if (input.json) {
        records.push({ id: target.id, relativePath: target.relativePath, status: statusWord, session: session === null ? null : session.id });
      } else {
        input.stdout(formatStatusLine(target, statusWord, session === null ? "none" : session.id));
      }
    };
    for (const target of targets) {
      const session = pickLatestOpenSession(sessions, target.agentId);
      try {
        const absPath = join(project.rootPath, target.relativePath);
        const existing = await readTargetFile(absPath);

        if (existing === null) {
          emit(target, "missing", session);
          continue;
        }

        const parsed = parseBlock(existing);
        if (parsed.block === null) {
          anyDriftOrError = true;
          emit(target, "no-block", session);
          continue;
        }

        const context = buildConnectorContext(target, project, sessions, memoryEntries);
        const upserted = upsertBlock({ existingContent: existing, context });
        if (upserted === existing) {
          emit(target, "in-sync", session);
          continue;
        }
        anyDriftOrError = true;
        emit(target, "drift", session);
      } catch (err) {
        anyDriftOrError = true;
        emit(target, "error", session);
        const cli = mapErrorToCliMessage(err, {
          kind: "connector",
          targetId: target.id,
          relativePath: target.relativePath,
        });
        input.stderr(cli.message);
      }
    }
    if (input.json) {
      input.stdout(JSON.stringify(records));
    }
    return anyDriftOrError ? 1 : 0;
```

- [ ] **Step 3: Add `json` arg to `connectorStatusCommand` and pass it through**

Find:
```ts
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
```

Replace with:
```ts
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", description: "Emit machine-readable JSON array." },
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
      json: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
```

- [ ] **Step 4: Fix any existing call sites of `runConnectorStatus` in tests that now need `json: false`**

```bash
grep -rn "runConnectorStatus\b" /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status/apps/cli/test/
```

If any test calls `runConnectorStatus` directly (not via `connectorStatusCommand.run`), it needs `json: false` added. If all tests go through `connectorStatusCommand.run`, no change needed.

- [ ] **Step 5: Run the tests to confirm all 3 new tests now PASS**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
pnpm --filter @megasaver/cli test 2>&1 | grep -E "json output|FAIL|✗|×|passed|failed" | head -15
```

Expected: all tests pass.

---

### Task 3: pnpm verify + fix lint if needed

- [ ] **Step 1: Run full verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
pnpm verify 2>&1 | tail -20
```

Expected: lint + typecheck + tests all GREEN.

- [ ] **Step 2: Fix any Biome formatting issues if they arise**

Biome will flag long lines or inline type declarations. Run `pnpm lint:fix` if needed:
```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
pnpm lint:fix && pnpm verify 2>&1 | tail -10
```

---

### Task 4: Commit both changes

- [ ] **Step 1: Commit failing tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
git add apps/cli/test/connector-status.test.ts
git commit -m "test: --json output for connector status"
```

- [ ] **Step 2: Commit production change**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
git add apps/cli/src/commands/connector.ts
git commit -m "feat: --json flag for connector status command"
```

---

### Task 5: Smoke test + push + PR

- [ ] **Step 1: Build and smoke test**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
pnpm build 2>&1 | tail -5
node apps/cli/dist/cli.js connector status --help 2>&1 | grep json
```

Expected: `--json` appears in help output.

- [ ] **Step 2: Push**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
git push -u origin feat/json-connector-status
```

- [ ] **Step 3: Open PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/json-connector-status
gh pr create \
  --title "feat(cli): --json output for connector status" \
  --body "..."
```

- [ ] **Step 4: SendMessage team-lead with PR URL**
