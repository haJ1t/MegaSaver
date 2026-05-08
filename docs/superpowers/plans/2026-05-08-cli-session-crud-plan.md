# CLI Session CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mega session create / list / show / end` CLI subcommands backed by a new `endSession` core method and one new `session_already_ended` error code.

**Architecture:** Mirror the existing `mega project` CLI shape (Citty `defineCommand` + injected `now` / `newId` / `stdout` / `stderr`). Extend `CoreRegistry` with one mutation (`endSession(id, { endedAt })`) implemented in both the in-memory and JSON-directory registries; the JSON-directory implementation reuses the existing `withDirLock` primitive. Project-name → ProjectId resolution lives inline in CLI handlers (CLAUDE.md: Core must not enforce display-layer policies).

**Tech Stack:** TypeScript strict + ESM, Node 22, Vitest, Citty, Zod, `@megasaver/core`, `@megasaver/shared`. pnpm workspaces, Biome lint/format, `pnpm verify` as DoD gate.

**Spec:** `docs/superpowers/specs/2026-05-08-cli-session-crud-design.md` (commit `5909f86`).

**Risk:** HIGH — Core public surface gains a mutating method; CLI gains four user-facing commands against persistent storage.

**Worktree:** `.worktrees/cli-session-crud` on branch `feat/cli-session-crud`.

---

## File Structure

| File | Responsibility | New / Modify |
|------|----------------|--------------|
| `packages/core/src/errors.ts` | `CoreRegistryErrorCode` enum | Modify (add `"session_already_ended"`) |
| `packages/core/src/registry.ts` | `CoreRegistry` interface + in-memory impl | Modify (add `endSession` to interface + in-memory) |
| `packages/core/src/json-directory-registry.ts` | JSON-directory impl | Modify (add `endSession`) |
| `packages/core/test/json-directory-registry-end-session.test.ts` | endSession + lock + race coverage | Create |
| `packages/core/test/in-memory-registry-end-session.test.ts` | In-memory endSession parity | Create |
| `apps/cli/src/errors.ts` | CLI error mapping + helpers | Modify (session_not_found, session_already_ended path, helper) |
| `apps/cli/src/commands/session.ts` | All four `mega session` subcommands + parent | Create (built up across T6–T9) |
| `apps/cli/src/main.ts` | Root command registration | Modify (register `session: sessionCommand`) |
| `apps/cli/test/session.test.ts` | CLI handler tests | Create (built up across T6–T9) |
| `wiki/entities/cli.md` | Wiki entity page | Modify (post-merge log) |
| `wiki/entities/core.md` | Wiki entity page | Modify (post-merge log) |
| `wiki/log.md` | Wiki append-only log | Modify (append entry) |
| `.changeset/<auto>.md` | Changeset for `@megasaver/core` minor + `@megasaver/cli` minor | Create |

---

## Task 1: Core — add `session_already_ended` error code

**Files:**
- Modify: `packages/core/src/errors.ts:3-10`

- [ ] **Step 1: Extend the enum**

Edit `packages/core/src/errors.ts`. Replace the `coreRegistryErrorCodeSchema` definition with:

```ts
export const coreRegistryErrorCodeSchema = z.enum([
  "project_already_exists",
  "project_not_found",
  "session_already_exists",
  "session_already_ended",
  "session_not_found",
  "session_project_mismatch",
  "memory_entry_already_exists",
]);
```

(Only `"session_already_ended"` is added; alphabetical order between `session_already_exists` and `session_not_found` keeps the diff small.)

- [ ] **Step 2: Verify typecheck still passes**

Run from worktree root:

```bash
pnpm --filter @megasaver/core typecheck
```

Expected: exit 0 (no type errors — `CoreRegistryErrorCode` is a derived type from the schema, no consumer references the new variant yet).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/errors.ts
git commit -m "feat(core): add session_already_ended error code"
```

---

## Task 2: Core — `endSession` interface + in-memory implementation + tests

**Files:**
- Modify: `packages/core/src/registry.ts:7-17` (interface)
- Modify: `packages/core/src/registry.ts:53-77` (in-memory impl block after `listSessions`)
- Create: `packages/core/test/in-memory-registry-end-session.test.ts`

- [ ] **Step 1: Write the failing test (in-memory parity)**

Create `packages/core/test/in-memory-registry-end-session.test.ts`:

```ts
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const STARTED_AT = "2026-05-08T12:00:00.000Z";
const ENDED_AT = "2026-05-08T13:00:00.000Z";

function seedProjectAndSession(registry: ReturnType<typeof createInMemoryCoreRegistry>): void {
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: agentIdSchema.parse("claude-code"),
    riskLevel: riskLevelSchema.parse("medium"),
    title: "first session",
    startedAt: STARTED_AT,
    endedAt: null,
  });
}

describe("createInMemoryCoreRegistry — endSession", () => {
  it("sets endedAt on an open session and returns the updated entity", () => {
    const registry = createInMemoryCoreRegistry();
    seedProjectAndSession(registry);

    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    expect(ended.id).toBe(SESSION_ID);
    expect(ended.endedAt).toBe(ENDED_AT);
    const refetched = registry.getSession(SESSION_ID);
    expect(refetched?.endedAt).toBe(ENDED_AT);
  });

  it("throws session_not_found when the id is unknown", () => {
    const registry = createInMemoryCoreRegistry();
    const unknownId = sessionIdSchema.parse("33333333-3333-4333-8333-333333333333");

    let err: unknown;
    try {
      registry.endSession(unknownId, { endedAt: ENDED_AT });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_not_found");
  });

  it("throws session_already_ended on the second call", () => {
    const registry = createInMemoryCoreRegistry();
    seedProjectAndSession(registry);
    registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: "2026-05-08T14:00:00.000Z" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_already_ended");
  });

  it("rejects an invalid endedAt via the existing Zod sessionSchema", () => {
    const registry = createInMemoryCoreRegistry();
    seedProjectAndSession(registry);

    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: "not-a-timestamp" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // ZodError or CorePersistenceError("store_entity_invalid") — either is acceptable
    // for the in-memory layer; the JSON-directory layer wraps it as the latter.
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @megasaver/core test -- in-memory-registry-end-session
```

Expected: tests fail with `TypeError: registry.endSession is not a function` (or a TS compile error in the test file if running typecheck). Failure is required before implementing.

- [ ] **Step 3: Add `endSession` to the `CoreRegistry` interface**

In `packages/core/src/registry.ts`, replace the interface block with:

```ts
export interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
  endSession(id: SessionId, opts: { endedAt: string }): Session;
  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
}
```

(Only the `endSession` line is new; placement after `listSessions` groups all session methods.)

- [ ] **Step 4: Implement `endSession` in the in-memory registry**

In the same file, in the `createInMemoryCoreRegistry` returned object, insert the `endSession` method **between** the existing `listSessions` and `createMemoryEntry` blocks:

```ts
    endSession(id, opts) {
      const existing = sessions.get(id);
      if (!existing) {
        throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
      }
      if (existing.endedAt !== null) {
        throw new CoreRegistryError(
          "session_already_ended",
          `Session already ended: ${id}`,
        );
      }
      const updated = sessionSchema.parse({ ...existing, endedAt: opts.endedAt });
      sessions.set(id, updated);
      return updated;
    },
```

- [ ] **Step 5: Run the test, expect green**

```bash
pnpm --filter @megasaver/core test -- in-memory-registry-end-session
```

Expected: 4 tests pass.

- [ ] **Step 6: Run the full core test suite to confirm no regression**

```bash
pnpm --filter @megasaver/core test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/registry.ts \
  packages/core/test/in-memory-registry-end-session.test.ts
git commit -m "feat(core): add endSession (in-memory)"
```

---

## Task 3: Core — `endSession` JSON-directory implementation + tests

**Files:**
- Modify: `packages/core/src/json-directory-registry.ts:139-166` (insert `endSession` between `listSessions` and `createMemoryEntry`)
- Create: `packages/core/test/json-directory-registry-end-session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/json-directory-registry-end-session.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentIdSchema,
  projectIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const STARTED_AT = "2026-05-08T12:00:00.000Z";
const ENDED_AT = "2026-05-08T13:00:00.000Z";

describe("createJsonDirectoryCoreRegistry — endSession", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "megasaver-core-end-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function seed(registry: ReturnType<typeof createJsonDirectoryCoreRegistry>): void {
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: STARTED_AT,
      updatedAt: STARTED_AT,
    });
    registry.createSession({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: agentIdSchema.parse("claude-code"),
      riskLevel: riskLevelSchema.parse("medium"),
      title: "first session",
      startedAt: STARTED_AT,
      endedAt: null,
    });
  }

  it("persists endedAt to sessions.json and returns the updated entity", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);

    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    expect(ended.endedAt).toBe(ENDED_AT);
    const persisted = JSON.parse(
      await readFile(join(rootDir, "sessions.json"), "utf8"),
    ) as Array<{ id: string; endedAt: string | null }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.endedAt).toBe(ENDED_AT);
  });

  it("throws session_not_found for an unknown id (no file mutation)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);
    const before = await readFile(join(rootDir, "sessions.json"), "utf8");
    const unknownId = sessionIdSchema.parse("33333333-3333-4333-8333-333333333333");

    let err: unknown;
    try {
      registry.endSession(unknownId, { endedAt: ENDED_AT });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_not_found");

    const after = await readFile(join(rootDir, "sessions.json"), "utf8");
    expect(after).toBe(before);
  });

  it("throws session_already_ended on the second call (idempotency rejected by design)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);
    registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: "2026-05-08T14:00:00.000Z" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CoreRegistryError);
    expect((err as CoreRegistryError).code).toBe("session_already_ended");
  });

  it("releases the .projects.lock after a successful end", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);
    registry.endSession(SESSION_ID, { endedAt: ENDED_AT });

    const { existsSync } = await import("node:fs");
    expect(existsSync(join(rootDir, ".projects.lock"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-end-session
```

Expected: tests fail with `TypeError: registry.endSession is not a function`.

- [ ] **Step 3: Implement `endSession` in the JSON-directory registry**

In `packages/core/src/json-directory-registry.ts`, in the `createJsonDirectoryCoreRegistry` returned object, insert the `endSession` method **between** the existing `listSessions` and `createMemoryEntry` blocks:

```ts
    endSession(id, opts) {
      return withDirLock(options.rootDir, () => {
        const sessions = readSessions(paths);
        const existingRaw = sessions.find((candidate) => candidate.id === id);
        if (!existingRaw) {
          throw new CoreRegistryError(
            "session_not_found",
            `Session does not exist: ${id}`,
          );
        }
        const existing = sessionSchema.parse(existingRaw);
        if (existing.endedAt !== null) {
          throw new CoreRegistryError(
            "session_already_ended",
            `Session already ended: ${id}`,
          );
        }
        const updated = sessionSchema.parse({ ...existing, endedAt: opts.endedAt });
        const next = sessions.map((session) => (session.id === id ? updated : session));
        writeSessions(paths, next);
        return updated;
      });
    },
```

- [ ] **Step 4: Run the test, expect green**

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-end-session
```

Expected: 4 tests pass.

- [ ] **Step 5: Run the full core suite for regression**

```bash
pnpm --filter @megasaver/core test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/json-directory-registry.ts \
  packages/core/test/json-directory-registry-end-session.test.ts
git commit -m "feat(core): add endSession (json-directory)"
```

---

## Task 4: Core — lock concurrency test for `endSession`

**Files:**
- Modify: `packages/core/test/json-directory-registry-end-session.test.ts` (append one block)

- [ ] **Step 1: Add the failing concurrency test**

Append to `packages/core/test/json-directory-registry-end-session.test.ts` inside the existing `describe("createJsonDirectoryCoreRegistry — endSession", …)` block:

```ts
  it("blocks while a stale lock holder PID is alive (5s timeout, surfaces CorePersistenceError)", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);

    const { writeFile } = await import("node:fs/promises");
    const { CorePersistenceError } = await import("../src/errors.js");
    await writeFile(join(rootDir, ".projects.lock"), String(process.pid), "utf8");

    const start = Date.now();
    let err: unknown;
    try {
      registry.endSession(SESSION_ID, { endedAt: ENDED_AT });
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;
    expect(err).toBeInstanceOf(CorePersistenceError);
    expect(elapsed).toBeGreaterThanOrEqual(4500);
  }, 10000);

  it("recovers immediately when the lock holder PID is dead", async () => {
    const registry = createJsonDirectoryCoreRegistry({ rootDir });
    seed(registry);

    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(rootDir, ".projects.lock"), "99999999", "utf8");

    const start = Date.now();
    const ended = registry.endSession(SESSION_ID, { endedAt: ENDED_AT });
    const elapsed = Date.now() - start;
    expect(ended.endedAt).toBe(ENDED_AT);
    expect(elapsed).toBeLessThan(2000);
  });
```

- [ ] **Step 2: Run the new tests, expect green (impl already covers the path)**

```bash
pnpm --filter @megasaver/core test -- json-directory-registry-end-session
```

Expected: 6 tests pass total (4 from Task 3 + 2 new).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/json-directory-registry-end-session.test.ts
git commit -m "test(core): cover endSession lock + stale recovery"
```

---

## Task 5: CLI errors module — session error mappings + helper

**Files:**
- Modify: `apps/cli/src/errors.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/errors.test.ts` if it does not exist; otherwise extend it. Append (or create file with header):

```ts
import { CoreRegistryError } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import {
  mapErrorToCliMessage,
  sessionAlreadyEndedMessage,
  sessionNotFoundMessage,
} from "../src/errors.js";

describe("session error mappings", () => {
  it("sessionNotFoundMessage formats the documented text and exit code 1", () => {
    expect(sessionNotFoundMessage("abc")).toEqual({
      message: 'error: session "abc" not found',
      exitCode: 1,
    });
  });

  it("sessionAlreadyEndedMessage includes the existing endedAt timestamp", () => {
    expect(sessionAlreadyEndedMessage("abc", "2026-05-08T13:00:00.000Z")).toEqual({
      message: 'error: session "abc" already ended at 2026-05-08T13:00:00.000Z',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels session_not_found through sessionNotFoundMessage", () => {
    const err = new CoreRegistryError("session_not_found", "Session does not exist: abc");
    expect(mapErrorToCliMessage(err, { kind: "session", id: "abc" })).toEqual({
      message: 'error: session "abc" not found',
      exitCode: 1,
    });
  });

  it("mapErrorToCliMessage funnels project_not_found through projectNotFoundMessage", () => {
    const err = new CoreRegistryError("project_not_found", "Project does not exist: demo");
    expect(mapErrorToCliMessage(err, { kind: "project", name: "demo" })).toEqual({
      message: 'error: project "demo" not found',
      exitCode: 1,
    });
  });
});
```

(The `kind: "session"` and `kind: "project"` discriminants on `ZodContext` are added in this task; previously only `"name"` and `"store"` existed.)

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm --filter @megasaver/cli test -- errors
```

Expected: import errors for `sessionAlreadyEndedMessage`, `sessionNotFoundMessage`, and the new context kinds.

- [ ] **Step 3: Implement the helpers**

Replace the body of `apps/cli/src/errors.ts` with:

```ts
import { CorePersistenceError, CoreRegistryError } from "@megasaver/core";
import { ZodError } from "zod";

export type CliMessage = { message: string; exitCode: 1 };

export type ZodContext =
  | { kind: "name" }
  | { kind: "store" }
  | { kind: "agent" }
  | { kind: "risk" }
  | { kind: "title" }
  | { kind: "sessionId" }
  | { kind: "project"; name: string }
  | { kind: "session"; id: string };

export const NAME_CONTROL_CHARS_MESSAGE = "name must not contain control characters";
export const TITLE_EMPTY_MESSAGE = "title must not be empty";
export const AGENT_INVALID_MESSAGE_PREFIX = "error: invalid agent";
export const RISK_INVALID_MESSAGE_PREFIX = "error: invalid risk";
export const SESSION_ID_INVALID_PREFIX = "error: invalid session id";

const AGENT_VALUES = ["claude-code", "codex", "generic-cli"] as const;
const RISK_VALUES = ["low", "medium", "high", "critical"] as const;

export function duplicateNameMessage(name: string): CliMessage {
  return {
    message: `error: project "${name}" already exists`,
    exitCode: 1,
  };
}

export function projectNotFoundMessage(name: string): CliMessage {
  return {
    message: `error: project "${name}" not found`,
    exitCode: 1,
  };
}

export function sessionNotFoundMessage(id: string): CliMessage {
  return {
    message: `error: session "${id}" not found`,
    exitCode: 1,
  };
}

export function sessionAlreadyEndedMessage(id: string, endedAt: string): CliMessage {
  return {
    message: `error: session "${id}" already ended at ${endedAt}`,
    exitCode: 1,
  };
}

export function invalidAgentMessage(value: string): CliMessage {
  return {
    message: `${AGENT_INVALID_MESSAGE_PREFIX} "${value}", expected: ${AGENT_VALUES.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidRiskMessage(value: string): CliMessage {
  return {
    message: `${RISK_INVALID_MESSAGE_PREFIX} "${value}", expected: ${RISK_VALUES.join(" | ")}`,
    exitCode: 1,
  };
}

export function invalidSessionIdMessage(value: string): CliMessage {
  return { message: `${SESSION_ID_INVALID_PREFIX} "${value}"`, exitCode: 1 };
}

export function mapErrorToCliMessage(err: unknown, ctx?: ZodContext): CliMessage {
  if (err instanceof ZodError) {
    if (ctx?.kind === "store") {
      return { message: "error: --store path must be non-empty", exitCode: 1 };
    }
    if (ctx?.kind === "title") {
      return { message: `error: ${TITLE_EMPTY_MESSAGE}`, exitCode: 1 };
    }
    if (ctx?.kind === "sessionId") {
      const issue = err.issues[0];
      const value = (issue && "received" in issue ? String(issue.received) : "<unknown>");
      return invalidSessionIdMessage(value);
    }
    const firstIssue = err.issues[0];
    if (firstIssue?.message === NAME_CONTROL_CHARS_MESSAGE) {
      return {
        message: "error: name must not contain control characters",
        exitCode: 1,
      };
    }
    return { message: "error: name must be non-empty", exitCode: 1 };
  }
  if (err instanceof CoreRegistryError) {
    if (err.code === "project_not_found" && ctx?.kind === "project") {
      return projectNotFoundMessage(ctx.name);
    }
    if (err.code === "session_not_found" && ctx?.kind === "session") {
      return sessionNotFoundMessage(ctx.id);
    }
    if (err.code === "session_not_found") {
      // Fallback when no ctx is supplied (rare; surface the raw message).
      return { message: `error: ${err.message}`, exitCode: 1 };
    }
    return { message: `error: ${err.message}`, exitCode: 1 };
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

- [ ] **Step 4: Run the test, expect green**

```bash
pnpm --filter @megasaver/cli test -- errors
```

Expected: 4 new tests pass + any pre-existing errors-module tests stay green.

- [ ] **Step 5: Run the full CLI suite to ensure nothing broke for `project`**

```bash
pnpm --filter @megasaver/cli test
```

Expected: all CLI tests pass (project tests should be unaffected — `ZodContext` is widened, not narrowed).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/errors.ts apps/cli/test/errors.test.ts
git commit -m "feat(cli): add session error mappings + helpers"
```

---

## Task 6: CLI — `runSessionCreate` + `sessionCreateCommand`

**Files:**
- Create: `apps/cli/src/commands/session.ts`
- Create: `apps/cli/test/session.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/cli/test/session.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCreateCommand } from "../src/commands/session.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-05-08T12:00:00.000Z";

async function seedProject(root: string, name: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "projects.json"),
    JSON.stringify([
      {
        id: PROJECT_ID,
        name,
        rootPath: "/tmp/demo",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
  );
  await writeFile(join(root, "sessions.json"), "[]");
}

describe("sessionCreateCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalNewId = process.env["MEGA_TEST_SESSION_ID"];
  const originalNow = process.env["MEGA_TEST_NOW"];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-session-create-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    process.env["MEGA_TEST_SESSION_ID"] = SESSION_ID;
    process.env["MEGA_TEST_NOW"] = NOW;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    if (originalNewId === undefined) delete process.env["MEGA_TEST_SESSION_ID"];
    else process.env["MEGA_TEST_SESSION_ID"] = originalNewId;
    if (originalNow === undefined) delete process.env["MEGA_TEST_NOW"];
    else process.env["MEGA_TEST_NOW"] = originalNow;
    await rm(root, { recursive: true, force: true });
  });

  async function runCreate(args: {
    projectName: string;
    agent?: string;
    risk?: string;
    title?: string;
  }): Promise<void> {
    const cliArgs: Record<string, string> = {
      projectName: args.projectName,
      store: root,
      agent: args.agent ?? "claude-code",
    };
    if (args.risk !== undefined) cliArgs["risk"] = args.risk;
    if (args.title !== undefined) cliArgs["title"] = args.title;
    await sessionCreateCommand.run?.({
      args: cliArgs,
      cmd: sessionCreateCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("creates a session and prints the new id on stdout", async () => {
    await seedProject(root, "demo");

    await runCreate({ projectName: "demo" });

    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toBe(SESSION_ID);

    const persisted = JSON.parse(
      await readFile(join(root, "sessions.json"), "utf8"),
    ) as Array<{
      id: string;
      projectId: string;
      agentId: string;
      riskLevel: string;
      title: string | null;
      startedAt: string;
      endedAt: string | null;
    }>;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: NOW,
      endedAt: null,
    });
  });

  it("defaults riskLevel to 'medium' when --risk is omitted", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo" });
    const persisted = JSON.parse(
      await readFile(join(root, "sessions.json"), "utf8"),
    ) as Array<{ riskLevel: string }>;
    expect(persisted[0]?.riskLevel).toBe("medium");
  });

  it("rejects an unknown agent with the documented error", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", agent: "totally-fake" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      'error: invalid agent "totally-fake", expected: claude-code | codex | generic-cli',
    ]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown risk with the documented error", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", risk: "ULTRA" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      'error: invalid risk "ULTRA", expected: low | medium | high | critical',
    ]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty title (after trim) with the documented error", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", title: "   " });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual(["error: title must not be empty"]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown project with the documented error and does not write sessions.json", async () => {
    // No seed — store still empty.
    await runCreate({ projectName: "missing" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === 'error: project "missing" not found')).toBe(
      true,
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("normalizes NFD project name input to NFC for resolution", async () => {
    // NFC name on disk: "café" with U+00E9.
    await seedProject(root, "café");
    // CLI input in NFD form: "café".
    await runCreate({ projectName: "café" });
    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves a non-null title in the stored session", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", title: "first session" });
    const persisted = JSON.parse(
      await readFile(join(root, "sessions.json"), "utf8"),
    ) as Array<{ title: string | null }>;
    expect(persisted[0]?.title).toBe("first session");
  });
});
```

- [ ] **Step 2: Run the tests, expect failure (file does not exist)**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: import error — `apps/cli/src/commands/session.ts` does not exist.

- [ ] **Step 3: Create `apps/cli/src/commands/session.ts` with the parent command + create handler**

```ts
import { randomUUID } from "node:crypto";
import {
  agentIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  NAME_CONTROL_CHARS_MESSAGE,
  projectNotFoundMessage,
} from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";

const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  // C0/C1 control chars and DEL break the line-oriented output protocol.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
  .transform((value) => value.normalize("NFC"));

const titleSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.normalize("NFC"));

export type RunSessionCreateInput = {
  projectName: string;
  agent: string;
  risk: string;
  title: string | undefined;
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

export async function runSessionCreate(input: RunSessionCreateInput): Promise<0 | 1> {
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

  let agentId: ReturnType<typeof agentIdSchema.parse>;
  try {
    agentId = agentIdSchema.parse(input.agent);
  } catch {
    const cli = invalidAgentMessage(input.agent);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let riskLevel: ReturnType<typeof riskLevelSchema.parse>;
  try {
    riskLevel = riskLevelSchema.parse(input.risk);
  } catch {
    const cli = invalidRiskMessage(input.risk);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let title: string | null = null;
  if (input.title !== undefined) {
    try {
      title = titleSchema.parse(input.title);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "title" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const sessionId = sessionIdSchema.parse((input.newId ?? randomUUID)());
    const startedAt = (input.now ?? (() => new Date().toISOString()))();
    const created = registry.createSession({
      id: sessionId,
      projectId: project.id,
      agentId,
      riskLevel,
      title,
      startedAt,
      endedAt: null,
    });
    input.stdout(created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a new session." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    agent: {
      type: "string",
      required: true,
      description: "Agent id (claude-code | codex | generic-cli).",
    },
    risk: {
      type: "string",
      description: "Risk level (low | medium | high | critical). Default: medium.",
    },
    title: { type: "string", description: "Optional session title." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const newIdEnv =
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof process.env["MEGA_TEST_SESSION_ID"] === "string"
        ? // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          process.env["MEGA_TEST_SESSION_ID"]
        : undefined;
    const nowEnv =
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof process.env["MEGA_TEST_NOW"] === "string"
        ? // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          process.env["MEGA_TEST_NOW"]
        : undefined;
    const code = await runSessionCreate({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      agent: typeof args.agent === "string" ? args.agent : "",
      risk: typeof args.risk === "string" ? args.risk : "medium",
      title: typeof args.title === "string" ? args.title : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      ...(newIdEnv !== undefined ? { newId: () => newIdEnv } : {}),
      ...(nowEnv !== undefined ? { now: () => nowEnv } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});

export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
  },
});
```

(Note: env-var test injection mirrors the deterministic-id pattern but is local-only. Pure handlers expose `newId` / `now` injection directly via `RunSessionCreateInput`; the Citty wrapper plumbs the env vars through. Subsequent tasks add `list`, `show`, `end` to `subCommands`.)

- [ ] **Step 4: Run the create tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: 8 create-related tests pass.

- [ ] **Step 5: Run lint + typecheck on the CLI package**

```bash
pnpm --filter @megasaver/cli lint
pnpm --filter @megasaver/cli typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/session.ts apps/cli/test/session.test.ts
git commit -m "feat(cli): add session create"
```

---

## Task 7: CLI — `runSessionList` + `sessionListCommand`

**Files:**
- Modify: `apps/cli/src/commands/session.ts` (add list handler + register in parent)
- Modify: `apps/cli/test/session.test.ts` (append list describe block)

- [ ] **Step 1: Append the failing tests**

Add to `apps/cli/test/session.test.ts` after the existing `describe("sessionCreateCommand", …)` block:

```ts
describe("sessionListCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-session-list-"));
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

  async function runList(projectName: string): Promise<void> {
    const { sessionListCommand } = await import("../src/commands/session.js");
    await sessionListCommand.run?.({
      args: { projectName, store: root },
      cmd: sessionListCommand,
      rawArgs: [projectName, "--store", root],
      data: undefined,
    } as never);
  }

  async function seedTwoSessions(): Promise<void> {
    await mkdir(root, { recursive: true });
    const ts = "2026-05-08T00:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(
      join(root, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: ts,
          endedAt: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          projectId: PROJECT_ID,
          agentId: "codex",
          riskLevel: "high",
          title: "second",
          startedAt: ts,
          endedAt: null,
        },
      ]),
    );
  }

  it("prints one line per session in array order with the documented columns", async () => {
    await seedTwoSessions();
    await runList("demo");
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      `${SESSION_ID}  claude-code  medium  -`,
      "33333333-3333-4333-8333-333333333333  codex  high  second",
    ]);
  });

  it("prints empty stdout for a project with no sessions", async () => {
    await mkdir(root, { recursive: true });
    const ts = "2026-05-08T00:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "empty", rootPath: "/tmp/x", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(join(root, "sessions.json"), "[]");

    await runList("empty");
    expect(process.exitCode).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing project name with the documented error", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "projects.json"), "[]");
    await writeFile(join(root, "sessions.json"), "[]");

    await runList("ghost");
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === 'error: project "ghost" not found')).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: import error — `sessionListCommand` not exported yet.

- [ ] **Step 3: Implement `runSessionList` + the Citty command**

Append to `apps/cli/src/commands/session.ts` **before** the parent `sessionCommand`:

```ts
function formatSessionLine(session: {
  id: string;
  agentId: string;
  riskLevel: string;
  title: string | null;
}): string {
  return `${session.id}  ${session.agentId}  ${session.riskLevel}  ${session.title ?? "-"}`;
}

export type RunSessionListInput = {
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionList(input: RunSessionListInput): Promise<0 | 1> {
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
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const sessions = registry.listSessions(project.id);
    for (const session of sessions) {
      input.stdout(formatSessionLine(session));
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionListCommand = defineCommand({
  meta: { name: "list", description: "List sessions for a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name to filter by.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionList({
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

Then update the `sessionCommand` parent in the same file:

```ts
export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
  },
});
```

- [ ] **Step 4: Run the tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: 11 tests pass total (8 from Task 6 + 3 from list).

- [ ] **Step 5: Run lint + typecheck**

```bash
pnpm --filter @megasaver/cli lint
pnpm --filter @megasaver/cli typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/session.ts apps/cli/test/session.test.ts
git commit -m "feat(cli): add session list"
```

---

## Task 8: CLI — `runSessionShow` + `sessionShowCommand`

**Files:**
- Modify: `apps/cli/src/commands/session.ts` (add show handler + register in parent)
- Modify: `apps/cli/test/session.test.ts` (append show describe block)

- [ ] **Step 1: Append the failing tests**

Append to `apps/cli/test/session.test.ts`:

```ts
describe("sessionShowCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-session-show-"));
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

  async function runShow(id: string): Promise<void> {
    const { sessionShowCommand } = await import("../src/commands/session.js");
    await sessionShowCommand.run?.({
      args: { sessionId: id, store: root },
      cmd: sessionShowCommand,
      rawArgs: [id, "--store", root],
      data: undefined,
    } as never);
  }

  async function seedSession(opts: {
    title: string | null;
    endedAt: string | null;
  }): Promise<void> {
    await mkdir(root, { recursive: true });
    const ts = "2026-05-08T00:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(
      join(root, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: opts.title,
          startedAt: ts,
          endedAt: opts.endedAt,
        },
      ]),
    );
  }

  it("prints seven aligned key=value lines for a session with null title and null endedAt", async () => {
    await seedSession({ title: null, endedAt: null });
    await runShow(SESSION_ID);
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      `id          ${SESSION_ID}`,
      `project     ${PROJECT_ID}`,
      "agent       claude-code",
      "risk        medium",
      "title       -",
      "startedAt   2026-05-08T00:00:00.000Z",
      "endedAt     -",
    ]);
  });

  it("renders a non-null title and a non-null endedAt without the dash placeholder", async () => {
    await seedSession({ title: "first", endedAt: "2026-05-08T01:00:00.000Z" });
    await runShow(SESSION_ID);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("title       first");
    expect(lines).toContain("endedAt     2026-05-08T01:00:00.000Z");
  });

  it("rejects an invalid session id (not a UUID) with the documented error", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "projects.json"), "[]");
    await writeFile(join(root, "sessions.json"), "[]");
    await runShow("not-a-uuid");
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => (c[0] as string).startsWith("error: invalid session id"))).toBe(
      true,
    );
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing session with the documented error", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "projects.json"), "[]");
    await writeFile(join(root, "sessions.json"), "[]");
    await runShow("99999999-9999-4999-8999-999999999999");
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === 'error: session "99999999-9999-4999-8999-999999999999" not found',
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: import error — `sessionShowCommand` not exported yet.

- [ ] **Step 3: Implement `runSessionShow` + Citty command**

First, extend the `../errors.js` import at the top of `apps/cli/src/commands/session.ts` to include `sessionNotFoundMessage`:

```ts
import {
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  NAME_CONTROL_CHARS_MESSAGE,
  projectNotFoundMessage,
  sessionNotFoundMessage,
} from "../errors.js";
```

Then append to `apps/cli/src/commands/session.ts` **before** the parent `sessionCommand` (after the list block):

```ts
const SHOW_KEY_WIDTH = 12;

function formatShowLines(session: {
  id: string;
  projectId: string;
  agentId: string;
  riskLevel: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
}): string[] {
  const pairs: Array<[string, string]> = [
    ["id", session.id],
    ["project", session.projectId],
    ["agent", session.agentId],
    ["risk", session.riskLevel],
    ["title", session.title ?? "-"],
    ["startedAt", session.startedAt],
    ["endedAt", session.endedAt ?? "-"],
  ];
  return pairs.map(([key, value]) => `${key.padEnd(SHOW_KEY_WIDTH, " ")}${value}`);
}

export type RunSessionShowInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionShow(input: RunSessionShowInput): Promise<0 | 1> {
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

  let id: ReturnType<typeof sessionIdSchema.parse>;
  try {
    id = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const session = registry.getSession(id);
    if (!session) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    for (const line of formatShowLines(session)) {
      input.stdout(line);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionShowCommand = defineCommand({
  meta: { name: "show", description: "Show a session's full details." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionShow({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
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

Update the parent:

```ts
export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
    show: sessionShowCommand,
  },
});
```

- [ ] **Step 4: Run the tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: 15 tests pass total.

- [ ] **Step 5: Lint + typecheck**

```bash
pnpm --filter @megasaver/cli lint
pnpm --filter @megasaver/cli typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/session.ts apps/cli/test/session.test.ts
git commit -m "feat(cli): add session show"
```

---

## Task 9: CLI — `runSessionEnd` + `sessionEndCommand`

**Files:**
- Modify: `apps/cli/src/commands/session.ts` (add end handler + register in parent)
- Modify: `apps/cli/test/session.test.ts` (append end describe block)

- [ ] **Step 1: Append the failing tests**

Append to `apps/cli/test/session.test.ts`:

```ts
describe("sessionEndCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalNow = process.env["MEGA_TEST_NOW"];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-session-end-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    process.env["MEGA_TEST_NOW"] = "2026-05-08T13:00:00.000Z";
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    if (originalNow === undefined) delete process.env["MEGA_TEST_NOW"];
    else process.env["MEGA_TEST_NOW"] = originalNow;
    await rm(root, { recursive: true, force: true });
  });

  async function runEnd(id: string): Promise<void> {
    const { sessionEndCommand } = await import("../src/commands/session.js");
    await sessionEndCommand.run?.({
      args: { sessionId: id, store: root },
      cmd: sessionEndCommand,
      rawArgs: [id, "--store", root],
      data: undefined,
    } as never);
  }

  async function seedSession(endedAt: string | null): Promise<void> {
    await mkdir(root, { recursive: true });
    const ts = "2026-05-08T12:00:00.000Z";
    await writeFile(
      join(root, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(
      join(root, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: ts,
          endedAt,
        },
      ]),
    );
  }

  it("ends an open session, prints the id, and persists endedAt", async () => {
    await seedSession(null);
    await runEnd(SESSION_ID);
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([SESSION_ID]);
    const persisted = JSON.parse(
      await readFile(join(root, "sessions.json"), "utf8"),
    ) as Array<{ endedAt: string | null }>;
    expect(persisted[0]?.endedAt).toBe("2026-05-08T13:00:00.000Z");
  });

  it("rejects an already-ended session with the documented message including the original endedAt", async () => {
    await seedSession("2026-05-08T13:00:00.000Z");
    await runEnd(SESSION_ID);
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) =>
          c[0] ===
          `error: session "${SESSION_ID}" already ended at 2026-05-08T13:00:00.000Z`,
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects a missing session with the documented error", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "projects.json"), "[]");
    await writeFile(join(root, "sessions.json"), "[]");
    await runEnd("99999999-9999-4999-8999-999999999999");
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === 'error: session "99999999-9999-4999-8999-999999999999" not found',
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid session id with the documented error", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "projects.json"), "[]");
    await writeFile(join(root, "sessions.json"), "[]");
    await runEnd("nope");
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => (c[0] as string).startsWith("error: invalid session id"))).toBe(
      true,
    );
    expect(logSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: import error — `sessionEndCommand` not exported yet.

- [ ] **Step 3: Implement `runSessionEnd` + Citty command**

Append to `apps/cli/src/commands/session.ts` **before** the parent `sessionCommand`:

```ts
export type RunSessionEndInput = {
  sessionId: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Override for tests; defaults to () => new Date().toISOString(). */
  now?: () => string;
};

export async function runSessionEnd(input: RunSessionEndInput): Promise<0 | 1> {
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

  let id: ReturnType<typeof sessionIdSchema.parse>;
  try {
    id = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) {
      input.stderr(`note: initialized store at ${rootDir}`);
    }
    const existing = registry.getSession(id);
    if (!existing) {
      const cli = sessionNotFoundMessage(id);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    if (existing.endedAt !== null) {
      const cli = sessionAlreadyEndedMessage(id, existing.endedAt);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const endedAt = (input.now ?? (() => new Date().toISOString()))();
    try {
      registry.endSession(id, { endedAt });
    } catch (err) {
      if (err instanceof CoreRegistryError && err.code === "session_already_ended") {
        // Race with concurrent process: refresh and format the rich message.
        const refreshed = registry.getSession(id);
        const ts = refreshed?.endedAt ?? "unknown";
        const cli = sessionAlreadyEndedMessage(id, ts);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      throw err;
    }
    input.stdout(id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionEndCommand = defineCommand({
  meta: { name: "end", description: "Mark a session as ended." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const nowEnv =
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      typeof process.env["MEGA_TEST_NOW"] === "string"
        ? // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          process.env["MEGA_TEST_NOW"]
        : undefined;
    const code = await runSessionEnd({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      ...(nowEnv !== undefined ? { now: () => nowEnv } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

Update imports at the top of `apps/cli/src/commands/session.ts`. Add `CoreRegistryError` from `@megasaver/core`, and add `sessionAlreadyEndedMessage` and `sessionNotFoundMessage` to the existing `../errors.js` import. End-state import block:

```ts
import { randomUUID } from "node:crypto";
import { CoreRegistryError } from "@megasaver/core";
import {
  agentIdSchema,
  riskLevelSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  NAME_CONTROL_CHARS_MESSAGE,
  projectNotFoundMessage,
  sessionAlreadyEndedMessage,
  sessionNotFoundMessage,
} from "../errors.js";
import { ensureStoreReady, resolveStorePath } from "../store.js";
```

Update the parent:

```ts
export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
    show: sessionShowCommand,
    end: sessionEndCommand,
  },
});
```

- [ ] **Step 4: Run the tests, expect green**

```bash
pnpm --filter @megasaver/cli test -- session
```

Expected: 19 tests pass total (8 + 3 + 4 + 4).

- [ ] **Step 5: Lint + typecheck**

```bash
pnpm --filter @megasaver/cli lint
pnpm --filter @megasaver/cli typecheck
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/session.ts apps/cli/test/session.test.ts
git commit -m "feat(cli): add session end"
```

---

## Task 10: Wire `sessionCommand` into root + smoke + wiki + changeset + verify

**Files:**
- Modify: `apps/cli/src/main.ts`
- Modify: `wiki/entities/cli.md`
- Modify: `wiki/entities/core.md`
- Modify: `wiki/log.md`
- Create: `.changeset/cli-session-crud.md`

- [ ] **Step 1: Register the session command**

Edit `apps/cli/src/main.ts`. Replace its body with:

```ts
import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { doctorCommand } from "./commands/doctor.js";
import { projectCommand } from "./commands/project.js";
import { sessionCommand } from "./commands/session.js";

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
    session: sessionCommand,
  },
});
```

- [ ] **Step 2: Build + smoke test**

```bash
pnpm build
SMOKE_STORE=$(mktemp -d)
node apps/cli/dist/cli.js project create demo --store "$SMOKE_STORE"
node apps/cli/dist/cli.js session create demo --agent claude-code --title "smoke session" --store "$SMOKE_STORE"
node apps/cli/dist/cli.js session list demo --store "$SMOKE_STORE"
SESSION_ID=$(node apps/cli/dist/cli.js session list demo --store "$SMOKE_STORE" | awk '{print $1}')
node apps/cli/dist/cli.js session show "$SESSION_ID" --store "$SMOKE_STORE"
node apps/cli/dist/cli.js session end "$SESSION_ID" --store "$SMOKE_STORE"
node apps/cli/dist/cli.js session show "$SESSION_ID" --store "$SMOKE_STORE"
node apps/cli/dist/cli.js session end "$SESSION_ID" --store "$SMOKE_STORE" || true  # second call must fail with already-ended
rm -rf "$SMOKE_STORE"
```

Expected output (in order): project line, session id, list line, show 7 lines, end echoes id, show 7 lines with endedAt populated, second end prints `error: session "<id>" already ended at <ts>` and exits 1. Capture this output for the PR description.

- [ ] **Step 3: Run `pnpm verify` from worktree root**

```bash
pnpm verify
```

Expected: lint + typecheck + test all green across every package.

- [ ] **Step 4: Add changeset**

Create `.changeset/cli-session-crud.md`:

```markdown
---
"@megasaver/core": minor
"@megasaver/cli": minor
---

feat: add session CRUD CLI commands and core endSession method

`@megasaver/core` gains `CoreRegistry.endSession(id, { endedAt })`
on both registry implementations and a new `session_already_ended`
error code. `@megasaver/cli` gains four `mega session` subcommands
(`create`, `list`, `show`, `end`) plus the supporting CLI error
helpers.
```

- [ ] **Step 5: Update wiki — `wiki/entities/core.md`**

Edit `wiki/entities/core.md`. In the `Registry interface` section, add `endSession` to the interface block:

```ts
interface CoreRegistry {
  createProject(project: Project): Project;
  getProject(id: ProjectId): Project | null;
  listProjects(): Project[];
  createSession(session: Session): Session;
  getSession(id: SessionId): Session | null;
  listSessions(projectId: ProjectId): Session[];
  endSession(id: SessionId, opts: { endedAt: string }): Session;
  createMemoryEntry(entry: MemoryEntry): MemoryEntry;
  getMemoryEntry(id: MemoryEntryId): MemoryEntry | null;
  listMemoryEntries(projectId: ProjectId): MemoryEntry[];
}
```

In the `CoreRegistryError` codes list, add `session_already_ended` between `session_already_exists` and `session_not_found`. In the `Implementation status` paragraph, append a new sentence:

> Session CRUD: `endSession` mutation + `session_already_ended` code: PR #TBD (`<merge-sha>`).

(The actual PR number / SHA fills in after merge — leave a `TBD` placeholder in this commit, replace post-merge.)

Bump `updated:` frontmatter to `2026-05-08`.

- [ ] **Step 6: Update wiki — `wiki/entities/cli.md`**

Edit `wiki/entities/cli.md`. Add a new subsection under `Current slice`:

```markdown
### `mega session create <projectName> --agent <id> [--risk medium] [--title "..."]`

Creates a session against an existing project resolved by name.
`--agent` is required (`claude-code | codex | generic-cli`),
`--risk` defaults to `medium`, `--title` is optional and stored
as `null` when omitted. Output is the new session id on stdout.

### `mega session list <projectName>`

Lists sessions for a project as `<id>  <agent>  <risk>  <title|->`,
two spaces between fields. Empty project → empty stdout.

### `mega session show <sessionId>`

Prints seven aligned `key=value` lines (12-char key column,
two-space gutter): `id`, `project`, `agent`, `risk`, `title`,
`startedAt`, `endedAt`. `null` fields render as `-`.

### `mega session end <sessionId>`

Stamps `endedAt` on an open session. Idempotency rejected by
design: a second call surfaces `error: session "<id>" already
ended at <ts>` and exits 1.
```

Bump `updated:` frontmatter to `2026-05-08`. Append to the
`Implementation status` / `Risk` section a new line:

> Session CRUD: PR #TBD (`<merge-sha>`).

- [ ] **Step 7: Append to `wiki/log.md`**

Append at the bottom of `wiki/log.md`:

```markdown
## [2026-05-08] schema | cli session CRUD

PR #TBD (`<merge-sha>`): four new `mega session` subcommands
(`create`, `list`, `show`, `end`). Core gains
`CoreRegistry.endSession(id, { endedAt })` and
`session_already_ended` error code. Tests: 6 new core (in-memory
parity + json-directory happy/missing/already-ended/lock-recovery
+ stale-recovery), 19 new CLI (8 create, 3 list, 4 show, 4 end).
```

- [ ] **Step 8: Commit wiki + changeset**

```bash
git add wiki/entities/core.md wiki/entities/cli.md wiki/log.md \
  .changeset/cli-session-crud.md apps/cli/src/main.ts
git commit -m "feat(cli): wire session subcommands + wiki + changeset"
```

- [ ] **Step 9: Run `pnpm verify` once more from a clean state to confirm**

```bash
pnpm verify
```

Expected: all green.

- [ ] **Step 10: Push branch + open PR**

```bash
git push -u origin feat/cli-session-crud
gh pr create --title "feat(cli): session CRUD" --body "$(cat <<'EOF'
## Summary

- `@megasaver/core`: add `CoreRegistry.endSession(id, { endedAt })`
  on both in-memory and JSON-directory registries; add
  `session_already_ended` error code.
- `@megasaver/cli`: add four `mega session` subcommands
  (`create`, `list`, `show`, `end`) plus CLI error helpers.

## Test plan

- [x] `pnpm verify` green (lint + typecheck + all packages).
- [x] Smoke transcript captured (project/session/list/show/end/end-twice).
- [x] Spec at `docs/superpowers/specs/2026-05-08-cli-session-crud-design.md`.
- [x] Plan at `docs/superpowers/plans/2026-05-08-cli-session-crud-plan.md`.
- [ ] `code-reviewer` agent pass (separate context).
- [ ] `critic` agent pass (separate context, HIGH risk).

## Risk

HIGH — Core public surface gains a mutation; CLI gains four
mutating commands against persistent storage.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL for the merge step.

---

## Verification checklist

After all tasks merge:

- `pnpm verify` green on `main`.
- Six packages still build (`@megasaver/shared`, `@megasaver/core`,
  `@megasaver/cli`, `@megasaver/connectors-shared`,
  `@megasaver/connector-claude-code`,
  `@megasaver/connector-generic-cli`).
- Test counts: core ~112 (was 106 + 6 new endSession tests),
  cli ~71 (was 52 + 19 new session tests), shared/connectors
  unchanged.
- `mega session --help` lists `create`, `list`, `show`, `end`.
- Smoke transcript reproduces.
