import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sessionCreateCommand,
  sessionEndCommand,
  sessionListCommand,
  sessionShowCommand,
  sessionUpdateCommand,
} from "../src/commands/session/index.js";

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
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const originalNewId = process.env["MEGA_TEST_SESSION_ID"];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const originalNow = process.env["MEGA_TEST_NOW"];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-session-create-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_TEST_SESSION_ID"] = SESSION_ID;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_TEST_NOW"] = NOW;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    if (originalNewId === undefined) delete process.env["MEGA_TEST_SESSION_ID"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    else process.env["MEGA_TEST_SESSION_ID"] = originalNewId;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    if (originalNow === undefined) delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.risk !== undefined) cliArgs["risk"] = args.risk;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
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

    const persisted = JSON.parse(await readFile(join(root, "sessions.json"), "utf8")) as Array<{
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
    const persisted = JSON.parse(await readFile(join(root, "sessions.json"), "utf8")) as Array<{
      riskLevel: string;
    }>;
    expect(persisted[0]?.riskLevel).toBe("medium");
  });

  it("rejects an unknown agent with the documented error", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", agent: "totally-fake" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      'error: invalid agent "totally-fake", expected: aider | claude-code | codex | cursor | generic-cli',
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
    expect(errSpy.mock.calls.some((c) => c[0] === 'error: project "missing" not found')).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("normalizes NFD project name input to NFC for resolution", async () => {
    // NFC name on disk: "café" (U+00E9 — precomposed e-acute).
    await seedProject(root, "café");
    // CLI input in NFD form: "café" (U+0065 + U+0301 — decomposed e + combining acute).
    await runCreate({ projectName: "café" });
    expect(process.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("preserves a non-null title in the stored session", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", title: "first session" });
    const persisted = JSON.parse(await readFile(join(root, "sessions.json"), "utf8")) as Array<{
      title: string | null;
    }>;
    expect(persisted[0]?.title).toBe("first session");
  });

  it("rejects a title containing a control character with the documented error", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", title: "first\nsession" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.map((c) => c[0])).toEqual([
      "error: title must not contain control characters",
    ]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects a title containing U+2028 LINE SEPARATOR (W6)", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", title: "first session" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => (c[0] as string).includes("control characters")),
    ).toBe(true);
  });

  it("rejects a title containing U+2029 PARAGRAPH SEPARATOR (W6)", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", title: "first session" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => (c[0] as string).includes("control characters")),
    ).toBe(true);
  });

  it("creates a session with --agent cursor", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", agent: "cursor", risk: "medium" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls).toHaveLength(1);
    const sessions = JSON.parse(await readFile(join(root, "sessions.json"), "utf8")) as Array<{
      agentId: string;
    }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.agentId).toBe("cursor");
  });

  it("creates a session with --agent aider", async () => {
    await seedProject(root, "demo");
    await runCreate({ projectName: "demo", agent: "aider", risk: "medium" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls).toHaveLength(1);
    const sessions = JSON.parse(await readFile(join(root, "sessions.json"), "utf8")) as Array<{
      agentId: string;
    }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.agentId).toBe("aider");
  });

  it("--agent description on create derives from agentIdSchema.options", async () => {
    const { agentIdSchema } = await import("@megasaver/shared");
    const expected = `Agent id (${agentIdSchema.options.join(" | ")}).`;
    expect(sessionCreateCommand.args?.agent?.description).toBe(expected);
  });

  it("--risk description on create derives from riskLevelSchema.options", async () => {
    const { riskLevelSchema } = await import("@megasaver/shared");
    const expected = `Risk level (${riskLevelSchema.options.join(" | ")}). Default: medium.`;
    expect(sessionCreateCommand.args?.risk?.description).toBe(expected);
  });
});

describe("sessionUpdateCommand — drift guards", () => {
  it("--agent description on update derives from agentIdSchema.options", async () => {
    const { agentIdSchema } = await import("@megasaver/shared");
    const expected = `New agent id (${agentIdSchema.options.join(" | ")}).`;
    expect(sessionUpdateCommand.args?.agent?.description).toBe(expected);
  });

  it("--risk description on update derives from riskLevelSchema.options", async () => {
    const { riskLevelSchema } = await import("@megasaver/shared");
    const expected = `New risk level (${riskLevelSchema.options.join(" | ")}).`;
    expect(sessionUpdateCommand.args?.risk?.description).toBe(expected);
  });
});

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
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      `id          ${SESSION_ID}`,
      `project     ${PROJECT_ID}`,
      "agent       claude-code",
      "risk        medium",
      "title       first",
      "startedAt   2026-05-08T00:00:00.000Z",
      "endedAt     2026-05-08T01:00:00.000Z",
    ]);
  });

  it("rejects an invalid session id (not a UUID) with the documented error", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "projects.json"), "[]");
    await writeFile(join(root, "sessions.json"), "[]");
    await runShow("not-a-uuid");
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => (c[0] as string).startsWith("error: invalid session id")),
    ).toBe(true);
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

describe("sessionEndCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const originalNow = process.env["MEGA_TEST_NOW"];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "megasaver-cli-session-end-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_TEST_NOW"] = "2026-05-08T13:00:00.000Z";
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = 0;
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    // biome-ignore lint/performance/noDelete: restoring env to absent state requires delete
    if (originalNow === undefined) delete process.env["MEGA_TEST_NOW"];
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    else process.env["MEGA_TEST_NOW"] = originalNow;
    await rm(root, { recursive: true, force: true });
  });

  async function runEnd(id: string): Promise<void> {
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
    const persisted = JSON.parse(await readFile(join(root, "sessions.json"), "utf8")) as Array<{
      endedAt: string | null;
    }>;
    expect(persisted[0]?.endedAt).toBe("2026-05-08T13:00:00.000Z");
  });

  it("rejects an already-ended session with the documented message including the original endedAt", async () => {
    await seedSession("2026-05-08T13:00:00.000Z");
    await runEnd(SESSION_ID);
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === `error: session "${SESSION_ID}" already ended at 2026-05-08T13:00:00.000Z`,
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
    expect(
      errSpy.mock.calls.some((c) => (c[0] as string).startsWith("error: invalid session id")),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("sessionUpdateCommand", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-update-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-update-root-"));
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
  const SESSION_ID = "22222222-2222-4222-8222-222222222222";

  async function seedOpenSession(): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
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
          startedAt: ts,
          endedAt: null,
        },
      ]),
    );
  }

  async function runUpdate(args: Record<string, string>): Promise<void> {
    await sessionUpdateCommand.run?.({
      args: { ...args, store },
      cmd: sessionUpdateCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  async function readSessions(): Promise<Array<Record<string, unknown>>> {
    return JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
  }

  it("sets title with --title 'foo'", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, title: "foo" });
    expect(process.exitCode).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
    const arr = await readSessions();
    expect(arr[0]?.title).toBe("foo");
  });

  it("clears title with --title ''", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, title: "" });
    expect(process.exitCode).toBe(0);
    const arr = await readSessions();
    expect(arr[0]?.title).toBeNull();
  });

  it("sets riskLevel with --risk high", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, risk: "high" });
    const arr = await readSessions();
    expect(arr[0]?.riskLevel).toBe("high");
  });

  it("sets agentId with --agent cursor", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, agent: "cursor" });
    const arr = await readSessions();
    expect(arr[0]?.agentId).toBe("cursor");
  });

  it("rejects empty update (no flags) with 'nothing to update'", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === "error: nothing to update")).toBe(true);
    const arr = await readSessions();
    expect(arr[0]?.title).toBeNull();
  });

  it("applies multi-field patch atomically", async () => {
    await seedOpenSession();
    await runUpdate({
      sessionId: SESSION_ID,
      title: "x",
      risk: "high",
      agent: "cursor",
    });
    const arr = await readSessions();
    expect(arr[0]?.title).toBe("x");
    expect(arr[0]?.riskLevel).toBe("high");
    expect(arr[0]?.agentId).toBe("cursor");
  });

  it("rejects invalid session id with non-zero exit", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: "not-a-uuid", title: "foo" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it("rejects unknown session id with session_not_found", async () => {
    await seedOpenSession();
    await runUpdate({
      sessionId: "99999999-9999-4999-8999-999999999999",
      title: "x",
    });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /^error: session ".*" not found/.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects ended session with session_already_ended", async () => {
    await seedOpenSession();
    const ended = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    ended[0].endedAt = "2026-05-09T01:00:00.000Z";
    await writeFile(join(store, "sessions.json"), JSON.stringify(ended));

    await runUpdate({ sessionId: SESSION_ID, title: "x" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /^error: session ".*" already ended/.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects --risk with unknown level", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, risk: "bogus" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => /^error: invalid risk "bogus", expected:/.test(c[0] as string)),
    ).toBe(true);
  });

  it("rejects --agent with unknown id", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, agent: "ghost-agent" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) =>
        /^error: invalid agent "ghost-agent", expected:/.test(c[0] as string),
      ),
    ).toBe(true);
  });

  it("rejects --title with embedded newline", async () => {
    await seedOpenSession();
    await runUpdate({ sessionId: SESSION_ID, title: "first\nsecond" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.length).toBeGreaterThan(0);
    // session unchanged
    const arr = await readSessions();
    expect(arr[0]?.title).toBeNull();
  });
});
