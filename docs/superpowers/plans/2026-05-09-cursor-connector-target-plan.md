# Cursor connector target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `cursor` as a third connector target alongside `claude-code` and `codex`. The new target writes `.cursor/rules/megasaver.mdc`, prepending YAML frontmatter on first seed via a new optional `ConnectorTarget.header` field.

**Architecture:** Three small additive changes across three packages: (1) `@megasaver/shared`'s `agentIdSchema` widens by one literal (`"cursor"`); (2) `@megasaver/connector-generic-cli`'s `ConnectorTarget` interface gains an optional `header?: string` and exports a new `cursorTarget`; (3) `@megasaver/cli`'s `KNOWN_TARGET_IDS` and `KNOWN_TARGETS` extend, and `runConnectorSync`'s seed branch prepends `target.header`. Existing `claude-code` and `codex` paths stay byte-identical.

**Tech Stack:** TypeScript strict ESM, Node 22, pnpm + Turborepo, Vitest, Biome, Citty, Zod.

**Spec:** `docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md`.

**Working dir for every step:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/cursor-target` (branch `feat/cursor-target`). All `pnpm` invocations run from there.

**Build/test commands:**

```bash
pnpm --filter @megasaver/shared test --run
pnpm --filter @megasaver/connector-generic-cli test --run
pnpm --filter @megasaver/cli test --run
pnpm verify
```

---

## File map

- **Modify** `packages/shared/src/agent-id.ts` — add `"cursor"` to the enum (alphabetical between `"codex"` and `"generic-cli"`).
- **Modify** `packages/shared/test/agent-id.test.ts` — extend the `members` array, add an explicit cursor parse assertion.
- **Modify** `packages/connectors/generic-cli/src/targets.ts` — extend `ConnectorTarget` interface with `readonly header?: string`; export `cursorTarget`; widen `builtinTargets`.
- **Modify** `packages/connectors/generic-cli/src/index.ts` — re-export `cursorTarget`.
- **Modify** `packages/connectors/generic-cli/test/targets.test.ts` — append cursor target tests.
- **Modify** `apps/cli/src/errors.ts` — add `"cursor"` to `KNOWN_TARGET_IDS`.
- **Modify** `apps/cli/src/commands/connector.ts` — import `cursorTarget`, add to `KNOWN_TARGETS`, prepend `target.header ?? ""` on the first-seed write.
- **Modify** `apps/cli/test/connector.test.ts` — three sync tests for cursor (seed creates frontmatter+block; subsequent sync preserves frontmatter; default sync skips missing cursor file).
- **Modify** `apps/cli/test/connector-status.test.ts` — two status tests for cursor.
- **Modify** `apps/cli/test/session.test.ts` — one smoke test for `mega session create --agent cursor`.
- **Create** `.changeset/cursor-connector-target.md` — multi-package: `@megasaver/shared` minor, `@megasaver/connector-generic-cli` minor, `@megasaver/cli` patch.
- **Modify** `wiki/entities/cli.md` — append cursor to known-targets list under `mega connector sync` and `mega connector status`.
- **Modify** `wiki/entities/connectors-generic-cli.md` — note `cursorTarget` in the manifest; mention `header?` field.
- **Modify** `wiki/entities/shared.md` — note AgentId widened to 4 members.
- **Modify** `wiki/index.md` — Status section update; bump test counts.
- **Append** `wiki/log.md` — new schema entry.

No changes to `@megasaver/core`, `@megasaver/connectors-shared`, or `@megasaver/connector-claude-code`.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative; body only when WHY is non-obvious.
- TDD: write failing test, RED, implement, GREEN, commit.
- After every task run the affected package's test command. After T5 run `pnpm verify`.
- Existing tests must stay green; no byte-identical sync regressions on `claude-code` / `codex`.

---

### Task 1: `@megasaver/shared` — AgentId enum widening

**Files:**
- Modify: `packages/shared/src/agent-id.ts`
- Modify: `packages/shared/test/agent-id.test.ts`

**Goal:** Widen the closed `AgentId` enum to include `"cursor"`.

- [ ] **Step 1: Update the test (RED)**

In `packages/shared/test/agent-id.test.ts`, change the `members` array from:

```ts
const members: ReadonlyArray<AgentId> = ["claude-code", "codex", "generic-cli"];
```

to:

```ts
const members: ReadonlyArray<AgentId> = ["claude-code", "codex", "cursor", "generic-cli"];
```

Then append one new test inside the existing `describe("agentIdSchema")` block, AFTER the `"property: any string outside the enum is rejected"` test:

```ts
  it("explicitly accepts 'cursor'", () => {
    expect(agentIdSchema.parse("cursor")).toBe("cursor");
  });

  it("widens to 4 closed-set members", () => {
    expect(members).toHaveLength(4);
  });
```

The `members` change retro-fits the existing three tests (they iterate `members`); the two new tests pin the cursor literal explicitly so a future revert of the enum widening fails loudly.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/shared test --run agent-id`
Expected: tests using `members` (`"parses every v0.1 connector id"` and the property tests) fail because `"cursor"` is not yet in the enum, OR the type checker fails because `"cursor" satisfies AgentId` is false (`AgentId` is inferred from the schema). Either signal is acceptable RED.

If the failure is a typecheck error and not a runtime test failure, that is also valid RED — the test cannot run because the schema does not accept `"cursor"`.

- [ ] **Step 3: Implement (GREEN)**

In `packages/shared/src/agent-id.ts`, change the schema from:

```ts
export const agentIdSchema = z.enum(["claude-code", "codex", "generic-cli"]);
```

to:

```ts
export const agentIdSchema = z.enum(["claude-code", "codex", "cursor", "generic-cli"]);
```

The exported `AgentId` type widens automatically.

- [ ] **Step 4: Run all shared tests; confirm GREEN**

Run: `pnpm --filter @megasaver/shared test --run`
Expected: 22 prior + 2 new = **24 passing**.

- [ ] **Step 5: Lint**

Run: `pnpm --filter @megasaver/shared exec biome check src test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agent-id.ts packages/shared/test/agent-id.test.ts
git commit -m "feat(shared): add cursor to AgentId enum"
```

---

### Task 2: `@megasaver/connector-generic-cli` — `cursorTarget` manifest

**Files:**
- Modify: `packages/connectors/generic-cli/src/targets.ts`
- Modify: `packages/connectors/generic-cli/src/index.ts`
- Modify: `packages/connectors/generic-cli/test/targets.test.ts`

**Goal:** Extend `ConnectorTarget` with an optional `header` field, ship `cursorTarget`, append it to `builtinTargets`.

- [ ] **Step 1: Add tests (RED)**

In `packages/connectors/generic-cli/test/targets.test.ts`, append the following test cases at the END of the existing `describe("ConnectorTarget registry", ...)` block (just before the closing `});`):

```ts
  it("ships the cursor target", () => {
    expect(cursorTarget.id).toBe("cursor");
    expect(cursorTarget.agentId).toBe("cursor");
    expect(cursorTarget.relativePath).toBe(".cursor/rules/megasaver.mdc");
  });

  it("cursorTarget header is a Cursor frontmatter block", () => {
    const h = cursorTarget.header;
    expect(h).toBeDefined();
    expect(h ?? "").toMatch(/^---\n/);
    expect(h ?? "").toContain("alwaysApply: true");
    expect(h ?? "").toContain("description: Mega Saver project context");
    expect(h ?? "").toMatch(/---\n\n\n$/);
  });

  it("findTarget returns the cursor target by id", () => {
    expect(findTarget("cursor")).toBe(cursorTarget);
  });

  it("builtinTargets contains both codex and cursor", () => {
    expect(builtinTargets).toHaveLength(2);
    expect(builtinTargets).toContain(codexTarget);
    expect(builtinTargets).toContain(cursorTarget);
  });

  it("codexTarget has no header (legacy targets stay byte-identical)", () => {
    expect(codexTarget.header).toBeUndefined();
  });
```

Update the existing imports at the top of the file:

```ts
import { builtinTargets, codexTarget, cursorTarget, findTarget } from "../src/targets.js";
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/connector-generic-cli test --run targets`
Expected: import fails (`cursorTarget` not exported) OR tests fail because the export is missing.

- [ ] **Step 3: Extend the interface and add the manifest (GREEN)**

In `packages/connectors/generic-cli/src/targets.ts`, change the file from:

```ts
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
}

export const codexTarget: ConnectorTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([codexTarget]);

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
```

to:

```ts
import type { AgentId } from "@megasaver/shared";

export interface ConnectorTarget {
  readonly id: string;
  readonly agentId: AgentId;
  readonly relativePath: string;
  readonly header?: string;
}

export const codexTarget: ConnectorTarget = Object.freeze({
  id: "codex",
  agentId: "codex" satisfies AgentId,
  relativePath: "AGENTS.md",
});

export const cursorTarget: ConnectorTarget = Object.freeze({
  id: "cursor",
  agentId: "cursor" satisfies AgentId,
  relativePath: ".cursor/rules/megasaver.mdc",
  header: [
    "---",
    "description: Mega Saver project context (auto-managed block)",
    "alwaysApply: true",
    "---",
    "",
    "",
  ].join("\n"),
});

export const builtinTargets: readonly ConnectorTarget[] = Object.freeze([
  codexTarget,
  cursorTarget,
]);

export function findTarget(id: string): ConnectorTarget | null {
  return builtinTargets.find((target) => target.id === id) ?? null;
}
```

- [ ] **Step 4: Re-export from index.ts**

In `packages/connectors/generic-cli/src/index.ts`, change the existing re-export line from:

```ts
export {
  builtinTargets,
  codexTarget,
  type ConnectorTarget,
  findTarget,
} from "./targets.js";
```

to:

```ts
export {
  builtinTargets,
  codexTarget,
  type ConnectorTarget,
  cursorTarget,
  findTarget,
} from "./targets.js";
```

- [ ] **Step 5: Run all generic-cli tests; confirm GREEN**

Run: `pnpm --filter @megasaver/connector-generic-cli test --run`
Expected: 21 prior + 5 new = **26 passing**.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @megasaver/connector-generic-cli exec biome check src test`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/connectors/generic-cli/src/targets.ts \
        packages/connectors/generic-cli/src/index.ts \
        packages/connectors/generic-cli/test/targets.test.ts
git commit -m "feat(generic-cli): add cursorTarget manifest"
```

---

### Task 3: `@megasaver/cli` — sync side wiring

**Files:**
- Modify: `apps/cli/src/errors.ts`
- Modify: `apps/cli/src/commands/connector.ts`
- Modify: `apps/cli/test/connector.test.ts`

**Goal:** Register the cursor id in the CLI's known-targets gate, add the manifest to `KNOWN_TARGETS`, and prepend `target.header` on the first-seed write. Three new sync tests.

- [ ] **Step 1: Update `KNOWN_TARGET_IDS`**

In `apps/cli/src/errors.ts`, find the existing constant:

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex"] as const;
```

(There may also be a comment above it referencing a "Keep in sync with KNOWN_TARGET_IDS" line elsewhere.)

Change to:

```ts
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor"] as const;
```

The matching `KNOWN_TARGET_IDS` constant in `apps/cli/src/commands/connector.ts` (kept manually in sync) also needs the same update — see Step 2.

- [ ] **Step 2: Update import + `KNOWN_TARGETS` + `KNOWN_TARGET_IDS` in connector.ts**

In `apps/cli/src/commands/connector.ts`, change the existing import block from:

```ts
import { type ConnectorTarget, codexTarget } from "@megasaver/connector-generic-cli";
```

to:

```ts
import {
  type ConnectorTarget,
  codexTarget,
  cursorTarget,
} from "@megasaver/connector-generic-cli";
```

Then find the `KNOWN_TARGET_IDS` constant in `connector.ts`:

```ts
// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex"] as const;
```

Change to:

```ts
// Keep in sync with KNOWN_TARGET_IDS in apps/cli/src/errors.ts.
const KNOWN_TARGET_IDS = ["claude-code", "codex", "cursor"] as const;
```

Find the `KNOWN_TARGETS` constant:

```ts
const KNOWN_TARGETS: readonly ConnectorTarget[] = [CLAUDE_CODE_TARGET, codexTarget];
```

Change to:

```ts
const KNOWN_TARGETS: readonly ConnectorTarget[] = [
  CLAUDE_CODE_TARGET,
  codexTarget,
  cursorTarget,
];
```

- [ ] **Step 3: Add sync tests (RED)**

In `apps/cli/test/connector.test.ts`, append a new describe block at the END of the file (after the `pickLatestOpenSession` block from the prior slot):

```ts
describe("connectorSyncCommand — cursor target", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cursor-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cursor-root-"));
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

  const PROJECT_ID_CURSOR = "88888888-8888-4888-8888-888888888888";
  const SESS_CURSOR = "99999999-9999-4999-8999-999999999999";

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID_CURSOR, name, rootPath, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(id: string, agentId: string, startedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id,
      projectId: PROJECT_ID_CURSOR,
      agentId,
      riskLevel: "medium",
      title: null,
      startedAt,
      endedAt: null,
    });
    await writeFile(join(store, "sessions.json"), JSON.stringify(arr));
  }

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("seeds .cursor/rules/megasaver.mdc with frontmatter + block on first sync", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(SESS_CURSOR, "cursor", "2026-05-09T00:00:00.000Z");
    await runSync({ projectName: "demo", target: "cursor" });

    const path = join(projectRoot, ".cursor/rules/megasaver.mdc");
    const content = await readFile(path, "utf8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("description: Mega Saver project context");
    expect(content).toContain("<!-- MEGA SAVER:BEGIN -->");
    expect(content).toContain("<!-- MEGA SAVER:END -->");

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("cursor       .cursor/rules/megasaver.mdc  created");
  });

  it("preserves the seeded frontmatter on subsequent syncs (block-only update)", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(SESS_CURSOR, "cursor", "2026-05-09T00:00:00.000Z");
    await runSync({ projectName: "demo", target: "cursor" });
    const path = join(projectRoot, ".cursor/rules/megasaver.mdc");
    const seeded = await readFile(path, "utf8");
    const seededFrontmatter = seeded.split("<!-- MEGA SAVER:BEGIN -->")[0] ?? "";

    // mutate the session list so the rendered block changes
    logSpy.mockClear();
    await seedSession(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "cursor",
      "2026-05-09T01:00:00.000Z",
    );
    await runSync({ projectName: "demo", target: "cursor" });

    const updated = await readFile(path, "utf8");
    const updatedFrontmatter = updated.split("<!-- MEGA SAVER:BEGIN -->")[0] ?? "";
    expect(updatedFrontmatter).toBe(seededFrontmatter);

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("cursor       .cursor/rules/megasaver.mdc  wrote");
  });

  it("default sync (no --target) silently skips a missing cursor file", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo" });

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("cursor       .cursor/rules/megasaver.mdc  skipped");
    // file must NOT exist
    await expect(
      readFile(join(projectRoot, ".cursor/rules/megasaver.mdc"), "utf8"),
    ).rejects.toThrow();
  });
});
```

The `cursor` id padded to width 11 yields `"cursor     "` (6 chars + 5 spaces) followed by 2-space gutter, then the path, then 2-space gutter, then the status word. The test strings above use that exact spacing.

- [ ] **Step 4: Run RED**

Run: `pnpm --filter @megasaver/cli test --run connector.test`
Expected: tests fail because `cursorTarget` is not yet in `KNOWN_TARGETS` (the loop never visits it) — so the expected lines do not appear and the file is not created.

- [ ] **Step 5: Implement seed-header prepend (GREEN)**

In `apps/cli/src/commands/connector.ts`, find the per-target loop's first-seed branch inside `runConnectorSync`:

```ts
        if (existing === null) {
          const newContent = renderBlock(context);
          await writeTargetFile({ absPath, content: newContent });
          input.stdout(formatStatusLine(target, "created"));
          continue;
        }
```

Change ONLY the `renderBlock(context)` line:

```ts
        if (existing === null) {
          const newContent = (target.header ?? "") + renderBlock(context);
          await writeTargetFile({ absPath, content: newContent });
          input.stdout(formatStatusLine(target, "created"));
          continue;
        }
```

For `claude-code` (`CLAUDE_CODE_TARGET.header` is `undefined`) and `codex` (`codexTarget.header` is `undefined`) the prefix is empty and the output stays byte-identical. For `cursor` the prefix prepends the frontmatter exactly once on first seed.

- [ ] **Step 6: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 121 prior + 3 new = **124 passing**. Existing sync tests for `claude-code` and `codex` MUST still be green (their stored content has no frontmatter — their writes still produce frontmatter-less output).

- [ ] **Step 7: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/errors.ts apps/cli/src/commands/connector.ts apps/cli/test/connector.test.ts
git commit -m "feat(cli): wire cursor target sync"
```

---

### Task 4: `@megasaver/cli` — status + session smoke

**Files:**
- Modify: `apps/cli/test/connector-status.test.ts`
- Modify: `apps/cli/test/session.test.ts`

**Goal:** Verify cursor target appears in status output (missing + in-sync paths) and that `mega session create --agent cursor` works end-to-end.

- [ ] **Step 1: Append status tests (RED)**

In `apps/cli/test/connector-status.test.ts`, append a new describe block at the END of the file:

```ts
describe("connectorStatusCommand — cursor target", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cursor-status-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cursor-status-root-"));
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

  const PROJECT_ID_CURSOR_S = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const SESS_CURSOR_S = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID_CURSOR_S, name, rootPath, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(id: string, agentId: string, startedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id,
      projectId: PROJECT_ID_CURSOR_S,
      agentId,
      riskLevel: "medium",
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

  it("reports cursor as missing when no .cursor/rules/megasaver.mdc exists", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      "claude-code  CLAUDE.md  missing  session=none",
      "codex        AGENTS.md  missing  session=none",
      "cursor       .cursor/rules/megasaver.mdc  missing  session=none",
    ]);
  });

  it("round-trips cursor: sync seed then status reports in-sync", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(SESS_CURSOR_S, "cursor", "2026-05-09T00:00:00.000Z");
    await runSync({ projectName: "demo", target: "cursor" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo", target: "cursor" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      `cursor       .cursor/rules/megasaver.mdc  in-sync  session=${SESS_CURSOR_S}`,
    ]);
  });
});
```

- [ ] **Step 2: Append session smoke test (RED)**

In `apps/cli/test/session.test.ts`, append one test inside the existing `describe` block for `mega session create` (or wherever the existing `--agent <id>` happy-path tests live). The test:

```ts
  it("creates a session with --agent cursor", async () => {
    const store = await mkdtemp(join(tmpdir(), "megasaver-cli-session-cursor-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-session-cursor-root-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;

    try {
      // seed project
      await mkdir(store, { recursive: true });
      const ts = "2026-05-09T00:00:00.000Z";
      const PID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
      await writeFile(
        join(store, "projects.json"),
        JSON.stringify([
          { id: PID, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
        ]),
      );
      await writeFile(join(store, "sessions.json"), "[]");

      await sessionCreateCommand.run?.({
        args: { projectName: "demo", agent: "cursor", risk: "medium", store },
        cmd: sessionCreateCommand,
        rawArgs: [],
        data: undefined,
      } as never);

      expect(process.exitCode).toBe(0);
      // Session id was printed on stdout (one log call, the new uuid)
      expect(logSpy.mock.calls).toHaveLength(1);
      const sessions = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.agentId).toBe("cursor");
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      process.exitCode = 0;
      await rm(store, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
```

You may need to add `vi`, `mkdir`, `mkdtemp`, `readFile`, `rm`, `writeFile`, `tmpdir`, `join`, and `sessionCreateCommand` to the imports if the existing test file does not already use that helper-self-contained shape. Mirror the existing file's import block — most of these helpers are already imported.

- [ ] **Step 3: Run RED then GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: the cursor status tests pass once Task 3's `KNOWN_TARGETS` change is in place (which it is at this point); the session test passes because `--agent cursor` is now accepted by the AgentId enum (Task 1) and `sessionCreateCommand` already routes it through. **NO additional production code change should be needed in T4.**

If a test fails for a non-trivial reason, STOP and report — do NOT introduce new production code in T4 without a clear plan correction.

CLI test count: 121 (post-PR #16) + 3 (T3 sync) + 2 (T4 status) + 1 (T4 session) = **127**.

- [ ] **Step 4: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/connector-status.test.ts apps/cli/test/session.test.ts
git commit -m "test(cli): cursor target status + session smoke"
```

---

### Task 5: Ship — changeset + wiki + verify

**Files:**
- Create: `.changeset/cursor-connector-target.md`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/entities/connectors-generic-cli.md`
- Modify: `wiki/entities/shared.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

**Goal:** Run the DoD gate, add the multi-package changeset, update the wiki. PR slot is `TBD` post-merge.

- [ ] **Step 1: `pnpm verify`**

Run: `pnpm verify`
Expected: lint + typecheck + Vitest all green. Total tests: 24 (shared) + 116 (core) + 56 (connectors-shared) + 45 (connector-claude-code) + 26 (generic-cli) + 127 (cli) = **394**.

If verify is red, STOP and report BLOCKED.

- [ ] **Step 2: Write changeset**

Create `.changeset/cursor-connector-target.md`:

```md
---
"@megasaver/shared": minor
"@megasaver/connector-generic-cli": minor
"@megasaver/cli": patch
---

Add Cursor as a connector target. `agentIdSchema` widens to four
members (adds `"cursor"`); `@megasaver/connector-generic-cli`
ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
and gains an optional `ConnectorTarget.header` field that the CLI
prepends on first seed (used to write Cursor's required YAML
frontmatter once). Existing `claude-code` and `codex` paths are
byte-identical. `mega session create --agent cursor` and
`mega connector sync demo --target cursor` work end-to-end.
```

- [ ] **Step 3: Update `wiki/entities/cli.md`**

Find the `### \`mega connector sync ...\`` subsection. Inside it there is a list of v0.1 known targets:

```
v0.1 known targets:
- `claude-code` → `CLAUDE.md`
- `codex` → `AGENTS.md`
```

Add a third bullet:

```
- `cursor` → `.cursor/rules/megasaver.mdc` (frontmatter prepended on first seed)
```

If the `### \`mega connector status ...\`` subsection enumerates targets, add cursor there too. Otherwise the wording "Reuses the same `KNOWN_TARGETS` set as `sync`" already covers it.

Also append a new line in the `## Risk` section, mirroring the existing per-PR lines:

```
Cursor connector target: PR <https://github.com/haJ1t/MegaSaver/pull/TBD> (TBD).
```

- [ ] **Step 4: Update `wiki/entities/connectors-generic-cli.md`**

Add a sentence (or short paragraph) noting:

> The package now exports `cursorTarget` alongside `codexTarget`.
> `cursorTarget` writes `.cursor/rules/megasaver.mdc` and carries an
> optional `header` field on the `ConnectorTarget` interface that
> CLI consumers prepend exactly once when seeding a non-existing
> file. Empty header on `codexTarget` keeps existing AGENTS.md
> writes byte-identical.

If the file has a list of `builtinTargets`, update its length from 1 to 2.

- [ ] **Step 5: Update `wiki/entities/shared.md`**

Find the section that documents `agentIdSchema` (it lists the v0.1 enum members). Update the enum from:

```
agentIdSchema enum: claude-code | codex | generic-cli
```

(or however it is phrased) to:

```
agentIdSchema enum: claude-code | codex | cursor | generic-cli
```

If a member-count appears anywhere ("3 members"), bump to "4 members".

- [ ] **Step 6: Update `wiki/index.md` Status section**

Replace the leading paragraph of the Status section so cursor is the lead announcement. Bump test counts: shared 22 → 24, generic-cli 21 → 26, cli 121 → 127, total 381 → 394.

The replacement structure (preserving the existing Markdown style):

> Cursor connector target landed via PR #TBD (`TBD`): `agentIdSchema` widens to four members (adds `"cursor"`), `@megasaver/connector-generic-cli` ships `cursorTarget` writing `.cursor/rules/megasaver.mdc` with optional `ConnectorTarget.header` for first-seed YAML frontmatter, and the CLI registers cursor in `KNOWN_TARGET_IDS` / `KNOWN_TARGETS`. `mega session create --agent cursor` and `mega connector sync demo --target cursor` work end-to-end. Existing `claude-code` and `codex` paths byte-identical. Previously: …

Continue with the existing prior-merge prose (PR #16 followups, PR #15 connector status, PR #14 sync, etc.) updated to reflect the new test counts:

- `@megasaver/shared` count: 24 (was 22)
- `@megasaver/connector-generic-cli` count: 26 (was 21)
- `@megasaver/cli` count: 127 (was 121)
- Total: 394 (was 381)

- [ ] **Step 7: Append to `wiki/log.md`**

Append a new entry at the END of the file:

```md
## [2026-05-09] schema | cursor connector target

- Spec: `docs/superpowers/specs/2026-05-09-cursor-connector-target-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-cursor-connector-target-plan.md`
- Branch: `feat/cursor-target`
- Result: `cursor` is now a v0.1 connector target alongside
  `claude-code` and `codex`. `agentIdSchema` widens to 4 members.
  `@megasaver/connector-generic-cli` ships `cursorTarget` and an
  optional `ConnectorTarget.header` field. `apps/cli`'s
  `KNOWN_TARGET_IDS` and `KNOWN_TARGETS` register cursor; sync
  prepends `target.header` once on first seed. 13 new tests
  (2 shared + 5 generic-cli + 6 cli). shared 22 → 24, generic-cli
  21 → 26, cli 121 → 127, total 381 → 394. PR: TBD.
```

- [ ] **Step 8: Final `pnpm verify`**

Run: `pnpm verify`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add .changeset/cursor-connector-target.md \
        wiki/entities/cli.md wiki/entities/connectors-generic-cli.md \
        wiki/entities/shared.md wiki/index.md wiki/log.md
git commit -m "feat(cursor): wire cursor target + wiki + changeset"
```

---

## Self-review

**Spec coverage:**
- §3.1 shared enum widening → T1. ✓
- §3.2 ConnectorTarget interface + cursorTarget + builtinTargets → T2. ✓
- §3.3 CLI KNOWN_TARGET_IDS, KNOWN_TARGETS, header seed prefix → T3. ✓
- §4 output format (3-line example with cursor) → T3 + T4 (sync + status tests assert exact strings). ✓
- §5 first-seeded file body (frontmatter + block) → T3 sync test asserts both substrings. ✓
- §6 test plan (13 tests across 3 packages) → T1 (2) + T2 (5) + T3 (3) + T4 (3) = 13. ✓
- §7 risk MEDIUM, full chain → T5 runs `pnpm verify`; code-reviewer + critic v0.2 followup will run after T5 the same way prior slots did. ✓
- §9 migration: no migration required → no migration step in any task. ✓

**Placeholder scan:** every `TBD` is the intentional post-merge PR-fill marker (sync's pattern). No "TBD" / "TODO" appears in production code or test code.

**Type consistency:** `cursorTarget` everywhere has shape `{ id: "cursor", agentId: "cursor", relativePath: ".cursor/rules/megasaver.mdc", header: "---\n…" }`. `ConnectorTarget.header` is `readonly header?: string`. `KNOWN_TARGET_IDS` is `["claude-code", "codex", "cursor"] as const` in both `errors.ts` and `connector.ts`. `KNOWN_TARGETS` order matches: `[CLAUDE_CODE_TARGET, codexTarget, cursorTarget]`.

**Test math:** T1 +2, T2 +5, T3 +3, T4 +3 = 13 new tests. CLI 121 → 127 (T3 +3, T4 +3). Project 381 → 394.

---

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task,
   two-stage review (spec compliance → code quality) between
   tasks.
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
