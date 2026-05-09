# Connector memoryEntries wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `memoryEntries: []` placeholder in `buildConnectorContext` with `registry.listMemoryEntries(project.id)` filtered to project-scoped + current-session-scoped entries.

**Architecture:** Single-package change in `apps/cli/src/commands/connector.ts`. `buildConnectorContext` widens by one argument (`allMemoryEntries`); a new `filterMemoryEntriesForSession` helper applies the filter rule. Two call sites (`runConnectorSync`, `runConnectorStatus`) gain a per-project `registry.listMemoryEntries(project.id)` fetch alongside the existing `listSessions` call. `connectors-shared`'s renderer is unchanged — empty filter result still produces `- none`.

**Tech Stack:** TypeScript strict ESM, Node 22, pnpm + Turborepo, Vitest, Biome, Citty, Zod.

**Spec:** `docs/superpowers/specs/2026-05-09-connector-memory-wiring-design.md`.

**Working dir for every step:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/connector-memory-wiring` (branch `feat/connector-memory-wiring`). All `pnpm` invocations run from there.

**Build/test commands:**

```bash
pnpm --filter @megasaver/cli test --run
pnpm verify
```

**Build dependency:** `pnpm test` calls `pnpm build` first; if you see DTS errors run `pnpm --filter @megasaver/shared build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/connectors-shared build && pnpm --filter @megasaver/connector-generic-cli build` first.

---

## File map

- **Modify** `apps/cli/src/commands/connector.ts`
  - `buildConnectorContext` gains a 4th parameter `allMemoryEntries: readonly MemoryEntry[]`.
  - New module-private helper `filterMemoryEntriesForSession`.
  - `runConnectorSync` adds `const memoryEntries = registry.listMemoryEntries(project.id);` before the per-target loop, passes to `buildConnectorContext`.
  - `runConnectorStatus` does the same.
  - Imports gain `MemoryEntry` type from `@megasaver/core`.
- **Modify** `apps/cli/test/connector.test.ts` — append 5 new tests.
- **Modify** `apps/cli/test/connector-status.test.ts` — append 2 new tests.
- **Modify** `docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md` — drop the "Memory entries are empty in v0.1" line; replace with the new filter rule wording.
- **Modify** `wiki/entities/cli.md` — same wording fix in the `mega connector sync` subsection. Append PR slot in `## Risk` section.
- **Modify** `wiki/index.md` — Status section update; bump test counts.
- **Append** `wiki/log.md` — new schema entry.
- **Create** `.changeset/connector-memory-wiring.md` — `@megasaver/cli` patch.

No changes to `@megasaver/core`, `@megasaver/shared`, `@megasaver/connectors-shared`, or any connector-package.

---

## Conventions every task obeys

- Caveman-commit: subject ≤ 50 chars, imperative.
- TDD: write failing test, RED, implement, GREEN, commit.
- After every task run `pnpm --filter @megasaver/cli test --run`. After T4 run full `pnpm verify`.
- Existing 169 CLI tests must continue to pass byte-identically. The signature widening is implemented in T1 BEFORE any test changes so existing tests still see `memoryEntries: []` semantics (because the new fetch returns `[]` when no memory exists).

---

### Task 1: Production change — filter helper + signature widen + caller updates

**Files:**
- Modify: `apps/cli/src/commands/connector.ts`

**Goal:** Land the production-code surface for the wiring with no test changes. Existing tests continue to pass because empty-memory projects produce `memoryEntries: []` (empty filter result).

- [ ] **Step 1: Add `MemoryEntry` to the existing `@megasaver/core` import**

In `apps/cli/src/commands/connector.ts`, find the existing import from `@megasaver/core`. Likely shape:

```ts
import type { Project, Session } from "@megasaver/core";
```

Add `MemoryEntry`:

```ts
import type { MemoryEntry, Project, Session } from "@megasaver/core";
```

If the existing import already pulls multiple types, slot `MemoryEntry` alphabetically.

- [ ] **Step 2: Add the filter helper**

Insert a new helper above `buildConnectorContext` (around line 54). The helper is module-private (no `export`):

```ts
function filterMemoryEntriesForSession(
  entries: readonly MemoryEntry[],
  session: Session | null,
): MemoryEntry[] {
  return entries.filter((entry) => {
    if (entry.scope === "project") return true;
    return session !== null && entry.sessionId === session.id;
  });
}
```

- [ ] **Step 3: Widen `buildConnectorContext`**

Find the existing `buildConnectorContext` (around line 54-66):

```ts
function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  return assertConnectorContext({
    agentId: target.agentId,
    project,
    session,
    memoryEntries: [],
  });
}
```

Replace with:

```ts
function buildConnectorContext(
  target: ConnectorTarget,
  project: Project,
  allSessions: readonly Session[],
  allMemoryEntries: readonly MemoryEntry[],
): ConnectorContext {
  const session = pickLatestOpenSession(allSessions, target.agentId);
  const memoryEntries = filterMemoryEntriesForSession(allMemoryEntries, session);
  return assertConnectorContext({
    agentId: target.agentId,
    project,
    session,
    memoryEntries,
  });
}
```

- [ ] **Step 4: Update `runConnectorSync` caller**

Find `runConnectorSync` (around line 100). Locate where `sessions` is fetched (likely just after `assertProjectRoot`):

```ts
const sessions = registry.listSessions(project.id);
```

Add the memory fetch right after:

```ts
const memoryEntries = registry.listMemoryEntries(project.id);
```

Then find the `buildConnectorContext` call inside the per-target loop (around line 140). Currently:

```ts
const context = buildConnectorContext(target, project, sessions);
```

Update to:

```ts
const context = buildConnectorContext(target, project, sessions, memoryEntries);
```

- [ ] **Step 5: Update `runConnectorStatus` caller**

Find `runConnectorStatus` (around line 250). Same pattern — add the memory fetch after the existing `sessions` fetch, update the `buildConnectorContext` call (around line 293):

```ts
const sessions = registry.listSessions(project.id);
const memoryEntries = registry.listMemoryEntries(project.id);
// ...
const context = buildConnectorContext(target, project, sessions, memoryEntries);
```

- [ ] **Step 6: Run all CLI tests; confirm GREEN (no regressions)**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: **169 passing** (no test count change). Existing fixtures don't seed memory entries; `registry.listMemoryEntries` returns `[]`; filter on `[]` returns `[]`; `buildConnectorContext` produces `memoryEntries: []` exactly as before. Render path unchanged.

If a test fails, the most likely cause is an import or syntax error in connector.ts; review the diff.

- [ ] **Step 7: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/commands/connector.ts
git commit -m "feat(cli): wire connector memoryEntries"
```

---

### Task 2: Sync tests — 5 new behavioural tests

**Files:**
- Modify: `apps/cli/test/connector.test.ts`

**Goal:** Append 5 tests that exercise the filter rule via the public `mega connector sync` surface.

- [ ] **Step 1: Append failing tests (RED)**

Append a new describe block to the END of `apps/cli/test/connector.test.ts`:

```ts
describe("connectorSyncCommand — memoryEntries wiring", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-conn-mem-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-conn-mem-root-"));
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

  const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
  const SESSION_CC = "22222222-2222-4222-8222-222222222222"; // claude-code session
  const SESSION_CC_OLD = "33333333-3333-4333-8333-333333333333"; // ended claude-code session
  const SESSION_CODEX = "44444444-4444-4444-8444-444444444444"; // codex session
  const MEM_PROJECT = "55555555-5555-4555-8555-555555555555";
  const MEM_CC_CURRENT = "66666666-6666-4666-8666-666666666666";
  const MEM_CC_OLD = "77777777-7777-4777-8777-777777777777";
  const MEM_CODEX = "88888888-8888-4888-8888-888888888888";
  const MEM_ORPHAN = "99999999-9999-4999-8999-999999999999";
  const TS = "2026-05-09T00:00:00.000Z";
  const TS_LATER = "2026-05-09T01:00:00.000Z";

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(store, "memory"), { recursive: true });
  }

  async function seedSessions(sessions: object[]): Promise<void> {
    await writeFile(join(store, "sessions.json"), JSON.stringify(sessions));
  }

  async function seedMemory(entries: object[]): Promise<void> {
    const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), body);
  }

  async function runSync(args: { target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: "demo", store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("renders project-scoped memory in the block", async () => {
    await seedProject();
    await seedSessions([
      {
        id: SESSION_CC,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS,
        endedAt: null,
      },
    ]);
    await seedMemory([
      {
        id: MEM_PROJECT,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "user prefers TS",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claude).toContain(`- [project:${MEM_PROJECT}] user prefers TS`);
  });

  it("includes session-scoped memory belonging to the current session", async () => {
    await seedProject();
    await seedSessions([
      {
        id: SESSION_CC,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS,
        endedAt: null,
      },
    ]);
    await seedMemory([
      {
        id: MEM_CC_CURRENT,
        projectId: PROJECT_ID,
        sessionId: SESSION_CC,
        scope: "session",
        content: "checked CSRF token expiry",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claude).toContain(`- [session:${MEM_CC_CURRENT}] checked CSRF token expiry`);
  });

  it("excludes session-scoped memory belonging to other sessions", async () => {
    await seedProject();
    await seedSessions([
      {
        id: SESSION_CC,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS_LATER,
        endedAt: null,
      },
      {
        id: SESSION_CC_OLD,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS,
        endedAt: TS_LATER,
      },
    ]);
    await seedMemory([
      {
        id: MEM_CC_OLD,
        projectId: PROJECT_ID,
        sessionId: SESSION_CC_OLD,
        scope: "session",
        content: "old work note",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claude).not.toContain(MEM_CC_OLD);
    expect(claude).toContain("- none");
  });

  it("filters out session-scoped memory when no current session", async () => {
    await seedProject();
    // No sessions seeded → pickLatestOpenSession returns null
    await seedMemory([
      {
        id: MEM_ORPHAN,
        projectId: PROJECT_ID,
        sessionId: SESSION_CC,
        scope: "session",
        content: "orphan note",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claude).toContain("Session: none");
    expect(claude).not.toContain(MEM_ORPHAN);
    expect(claude).toContain("- none");
  });

  it("isolates per-agent session-scoped memory across targets", async () => {
    await seedProject();
    await seedSessions([
      {
        id: SESSION_CC,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS,
        endedAt: null,
      },
      {
        id: SESSION_CODEX,
        projectId: PROJECT_ID,
        agentId: "codex",
        riskLevel: "medium",
        title: null,
        startedAt: TS,
        endedAt: null,
      },
    ]);
    await seedMemory([
      {
        id: MEM_CC_CURRENT,
        projectId: PROJECT_ID,
        sessionId: SESSION_CC,
        scope: "session",
        content: "claude-code note",
        createdAt: TS,
      },
      {
        id: MEM_CODEX,
        projectId: PROJECT_ID,
        sessionId: SESSION_CODEX,
        scope: "session",
        content: "codex note",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await writeFile(join(projectRoot, "AGENTS.md"), "");
    await runSync({});  // no --target → both files written

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const agents = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(claude).toContain(MEM_CC_CURRENT);
    expect(claude).not.toContain(MEM_CODEX);
    expect(agents).toContain(MEM_CODEX);
    expect(agents).not.toContain(MEM_CC_CURRENT);
  });
});
```

The tests assume `connectorSyncCommand` is already imported at the top of the file. The fixture helpers (`mkdtemp`, `mkdir`, `writeFile`, `readFile`, `rm`, `join`, `tmpdir`) should also be imported — verify by reading the existing test file and reusing its imports.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @megasaver/cli test --run connector.test`
Expected: 5 new tests fail because they assert specific entry IDs in the rendered block, but the existing T1 production code wires `memoryEntries` correctly; tests should actually PASS already if T1 was implemented correctly. Verify both: (a) tests pass without needing further production code changes (TDD-RED is somewhat artificial here because T1 already wires the production code), or (b) if a test fails for a real reason, fix the test fixture.

(This task is technically GREEN-out-of-the-gate because T1 production code is correct. The "tests" exist primarily to lock the wiring contract. If RED is desired in pure TDD spirit, T2 should land BEFORE T1's production code and skip Step 6 of T1.)

- [ ] **Step 3: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 169 prior + 5 new = **174 passing**.

- [ ] **Step 4: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/test/connector.test.ts
git commit -m "test(cli): connector sync memoryEntries"
```

---

### Task 3: Status tests — 2 new behavioural tests

**Files:**
- Modify: `apps/cli/test/connector-status.test.ts`

**Goal:** Append 2 status tests covering drift detection on memory create + in-sync after re-sync.

- [ ] **Step 1: Append failing tests (RED)**

Append to the END of `apps/cli/test/connector-status.test.ts`:

```ts
describe("connectorStatusCommand — memoryEntries drift", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-status-mem-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-status-mem-root-"));
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

  const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SESSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const MEM_FIRST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const MEM_SECOND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const TS = "2026-05-09T00:00:00.000Z";
  const TS_LATER = "2026-05-09T01:00:00.000Z";

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
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
    await mkdir(join(store, "memory"), { recursive: true });
  }

  async function writeMemory(entries: object[]): Promise<void> {
    const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), body);
  }

  async function runSync(args: { target?: string }): Promise<void> {
    await runConnectorSync({
      projectName: "demo",
      targetFlag: args.target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      stdout: () => {},
      stderr: () => {},
    });
  }

  async function runStatus(args: { target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: "demo", store };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports drift after a new memory entry is created post-sync", async () => {
    await seedProject();
    await writeMemory([
      {
        id: MEM_FIRST,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "first",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });
    logSpy.mockClear();
    errSpy.mockClear();

    // Simulate `mega memory create` adding a second entry
    await writeMemory([
      {
        id: MEM_FIRST,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "first",
        createdAt: TS,
      },
      {
        id: MEM_SECOND,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "second",
        createdAt: TS_LATER,
      },
    ]);

    await runStatus({ target: "claude-code" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("drift"))).toBe(true);
  });

  it("reports in-sync after re-sync following a memory create", async () => {
    await seedProject();
    await writeMemory([
      {
        id: MEM_FIRST,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "first",
        createdAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });

    // Add second entry
    await writeMemory([
      {
        id: MEM_FIRST,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "first",
        createdAt: TS,
      },
      {
        id: MEM_SECOND,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        content: "second",
        createdAt: TS_LATER,
      },
    ]);

    // Re-sync
    await runSync({ target: "claude-code" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ target: "claude-code" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("in-sync"))).toBe(true);
  });
});
```

The tests assume `connectorStatusCommand` and `runConnectorSync` are already imported at the top of the file. Reuse the file's existing imports.

- [ ] **Step 2: Run all CLI tests; confirm GREEN**

Run: `pnpm --filter @megasaver/cli test --run`
Expected: 174 prior + 2 new = **176 passing**.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @megasaver/cli exec biome check src test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/test/connector-status.test.ts
git commit -m "test(cli): connector status memoryEntries drift"
```

---

### Task 4: Ship — spec drift fix + changeset + wiki + verify

**Files:**
- Modify: `docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`
- Create: `.changeset/connector-memory-wiring.md`

**Goal:** DoD verify, changeset, wiki updates, prior-spec drift fix.

- [ ] **Step 1: Initial `pnpm verify`**

Run: `pnpm verify`
Expected: 12/12 tasks green. Total tests: 24 (shared) + 128 (core) + 56 (connectors-shared) + 45 (connector-claude-code) + 26 (connector-generic-cli) + 176 (cli) = **455**.

If verify is red, STOP and report BLOCKED.

- [ ] **Step 2: Fix spec drift in `docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md`**

Read the file. Find the line that says (or contains a similar phrase):

> Memory entries are empty in v0.1.

Replace with:

> Memory entries: project-scoped entries (always) plus
> session-scoped entries belonging to the target's currently-
> picked open session (`pickLatestOpenSession`). Other agents'
> session-scoped memory is filtered out so each block reflects
> only the relevant context.

If the exact wording differs, find the closest equivalent and apply the same substantive change.

- [ ] **Step 3: Write changeset**

Create `.changeset/connector-memory-wiring.md`:

```md
---
"@megasaver/cli": patch
---

Wire `mega connector sync` and `mega connector status` to read
real memory entries via `registry.listMemoryEntries(project.id)`.
The connector context now includes project-scoped entries plus
session-scoped entries belonging to the target's
currently-picked open session. Other agents' session-scoped
memory is filtered out. Empty-memory projects continue to render
`- none` byte-identically.
```

- [ ] **Step 4: Update `wiki/entities/cli.md`**

Find the `### \`mega connector sync\`` subsection. It contains the line:

> Memory entries are empty in v0.1.

Replace with:

> Memory entries: project-scoped (always) plus session-scoped
> entries belonging to the target's currently-picked open
> session. Other agents' session-scoped memory is filtered out.

In the `## Risk` section near the bottom, append:

```md
Connector memoryEntries wiring: PR <https://github.com/haJ1t/MegaSaver/pull/TBD> (TBD).
```

- [ ] **Step 5: Update `wiki/index.md` Status section**

Replace the leading paragraph so the wiring slot is the lead announcement. Bump test counts:
- cli 169 → 176
- total 448 → 455

The replacement leading paragraph (preserve existing Markdown style):

```
Connector memoryEntries wiring landed via PR #TBD (`TBD`):
`mega connector sync` and `mega connector status` now read real
memory entries via `registry.listMemoryEntries(project.id)` and
filter them per-target to "project-scoped + current-session-
scoped". Empty-memory projects continue to render `- none`
byte-identically. Critic backlog item W11 (deferred-state lock
test) closes by superseding — the wiring slot itself locks the
real state. Previously: …
```

(Continue with the existing prior-merge prose.)

- [ ] **Step 6: Append to `wiki/log.md`**

Append at the END:

```md
## [2026-05-09] schema | connector memoryEntries wiring

- Spec: `docs/superpowers/specs/2026-05-09-connector-memory-wiring-design.md`
- Plan: `docs/superpowers/plans/2026-05-09-connector-memory-wiring-plan.md`
- Branch: `feat/connector-memory-wiring`
- Result: `mega connector sync` / `status` flow real memory
  entries through `buildConnectorContext`, filtered to
  "project-scoped + current-session-scoped" per target.
  Production change is one new helper + one signature widen + 2
  call site updates. 7 new tests (5 sync + 2 status) lock the
  filter contract end-to-end. Spec drift in
  `2026-05-09-mega-connector-sync-design.md` ("memory entries
  empty in v0.1") corrected. Closes critic backlog W11.
  cli 169 → 176, total 448 → 455. PR: TBD.
```

- [ ] **Step 7: Final `pnpm verify`**

Run: `pnpm verify`
Expected: still green.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-mega-connector-sync-design.md \
        wiki/entities/cli.md wiki/index.md wiki/log.md \
        .changeset/connector-memory-wiring.md
git commit -m "feat(connector): ship memoryEntries wiring + wiki"
```

---

## Self-review

**Spec coverage:**
- §3.1 production change (filter helper + signature widen) → T1. ✓
- §3.2 caller updates (sync + status) → T1. ✓
- §3.3 filter rule table → T1 (helper) + T2/T3 (tests). ✓
- §3.4 render path no change → no task touches `connectors-shared`. ✓
- §3.5 spec drift fix → T4. ✓
- §4 output examples → T2's first test reads CLAUDE.md and asserts the bullet shape. ✓
- §5 test plan (5 sync + 2 status = 7) → T2 (5) + T3 (2). ✓
- §6 risk MEDIUM-LOW, full chain → T4 runs `pnpm verify`. ✓
- §7 out-of-scope items → no task addresses W4-W10 / `--limit` / delete/update. ✓
- §8 W11 closure → T4 wiki update marks W11 as closed-by-superseding. ✓

**Placeholder scan:** every `TBD` is the intentional post-merge PR-fill marker. No "TODO" / "TBD" appears in production code or test code.

**Type consistency:** `MemoryEntry` imported from `@megasaver/core` in T1 and used in `filterMemoryEntriesForSession` and `buildConnectorContext` parameters. `Session | null` filter input matches `pickLatestOpenSession` return type. `registry.listMemoryEntries(project.id)` is the existing CoreRegistry method (no new method).

**Test math:** T1 +0 (production only), T2 +5, T3 +2, T4 +0 = **+7 new tests**. CLI 169 → 176. Project 448 → 455.

---

## Execution

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task,
   two-stage review (spec compliance → code quality) between tasks.
2. **Inline Execution** — same session, batch checkpoints.

Defaults to subagent-driven if not specified.
