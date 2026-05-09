import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryCreateCommand } from "../src/commands/memory/create.js";
import { memoryListCommand } from "../src/commands/memory/list.js";
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
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    // Memory entries are stored as JSONL per-project: memory/<projectId>.jsonl
    const projectEntry = JSON.stringify({
      id: MEMORY_ID_PROJECT,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "user prefers TS",
      createdAt: TS,
    });
    const sessionEntry = JSON.stringify({
      id: MEMORY_ID_SESSION,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      scope: "session",
      content: "checked CSRF token expiry",
      createdAt: TS,
    });
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${projectEntry}\n${sessionEntry}\n`,
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
    expect(
      errSpy.mock.calls.some((c) => /memory entry "99999999.*" not found/.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects invalid memory entry id (not a uuid)", async () => {
    await seed();
    await runShow({ memoryEntryId: "not-a-uuid" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });
});

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
    await mkdir(join(store, "memory"), { recursive: true });
  }

  async function seedEntries(entries: object[]): Promise<void> {
    // JSONL: one JSON object per line, trailing newline.
    const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), body);
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
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
    delete process.env.MEGA_TEST_MEMORY_ENTRY_ID;
    // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
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
    await mkdir(join(store, "memory"), { recursive: true });
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

  async function readMemoryJsonl(): Promise<Array<Record<string, unknown>>> {
    const path = join(store, "memory", `${PROJECT_ID}.jsonl`);
    const raw = await readFile(path, "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
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
    const arr = await readMemoryJsonl();
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
    const arr = await readMemoryJsonl();
    expect(arr[0]?.scope).toBe("session");
    expect(arr[0]?.sessionId).toBe(SESSION_ID);
  });

  it("stamps id from MEGA_TEST_MEMORY_ENTRY_ID under NODE_ENV=test", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "x" });
    const arr = await readMemoryJsonl();
    expect(arr[0]?.id).toBe(MEMORY_ID_PROJECT);
  });

  it("stamps createdAt from MEGA_TEST_NOW under NODE_ENV=test", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "demo", scope: "project", content: "x" });
    const arr = await readMemoryJsonl();
    expect(arr[0]?.createdAt).toBe(TS);
  });

  it("rejects missing project with project_not_found", async () => {
    await seedProjectOnly();
    await runCreate({ projectName: "nope", scope: "project", content: "x" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => /project "nope" not found/.test(c[0] as string))).toBe(
      true,
    );
  });

  it("rejects unknown session id (with --scope session)", async () => {
    await seedProjectOnly(); // session is NOT seeded
    await runCreate({
      projectName: "demo",
      scope: "session",
      content: "x",
      session: "99999999-9999-4999-8999-999999999999",
    });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /session "99999999.*" not found/.test(c[0] as string)),
    ).toBe(true);
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
      errSpy.mock.calls.some((c) =>
        /^error: invalid scope "bogus", expected: project \| session/.test(c[0] as string),
      ),
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

  it("rejects --session belonging to a different project", async () => {
    // Seed two projects, one session belonging to project B.
    await mkdir(store, { recursive: true });
    const PROJECT_B = "55555555-5555-4555-8555-555555555555";
    const SESSION_B = "66666666-6666-4666-8666-666666666666";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo-a", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
        { id: PROJECT_B, name: "demo-b", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_B,
          projectId: PROJECT_B,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
    await mkdir(join(store, "memory"), { recursive: true });

    await runCreate({
      projectName: "demo-a",
      scope: "session",
      content: "x",
      session: SESSION_B,
    });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === "error: --session does not belong to the specified project",
      ),
    ).toBe(true);
  });
});

describe("memoryCreateCommand — drift guards", () => {
  it("--scope description on memory create lists every memoryScopeSchema member", async () => {
    const { memoryScopeSchema } = await import("@megasaver/core");
    const desc = memoryCreateCommand.args?.scope?.description ?? "";
    for (const m of memoryScopeSchema.options) expect(desc).toContain(m);
  });
});
