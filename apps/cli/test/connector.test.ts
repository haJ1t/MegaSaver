import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorError } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorStatusCommand, connectorSyncCommand } from "../src/commands/connector.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("connectorSyncCommand — pre-target gates", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-root-"));
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

  async function runSync(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = {
      projectName: args.projectName,
      store,
    };
    if (args.target !== undefined) cliArgs.target = args.target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("rejects an unknown project with the documented error and emits no per-target lines", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "missing" });
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.some((c) => c[0] === 'error: project "missing" not found')).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid --target flag with the documented error", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo", target: "nope" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some(
        (c) => c[0] === 'error: invalid target "nope", expected: claude-code | codex | cursor | aider',
      ),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("normalizes NFD project name input to NFC for resolution", async () => {
    // IMPORTANT: use explicit \u escapes. Editors silently normalize literal
    // accented chars on save, defeating the test. NFC = "caf" + U+00E9.
    await seedProject("café", projectRoot);
    // NFD CLI input = "cafe" + U+0301 (combining acute).
    await runSync({ projectName: "café" });
    // No targets exist in projectRoot yet, so all are skipped — exit 0.
    expect(process.exitCode).toBe(0);
    // The skipped lines come in T3; for this scaffold the loop is empty so
    // we only need to confirm the resolution succeeded (no error to stderr).
    expect(errSpy.mock.calls.every((c) => !(c[0] as string).startsWith("error:"))).toBe(true);
  });

  it("rejects a non-existent project rootPath via assertProjectRoot", async () => {
    const missing = join(tmpdir(), `megasaver-not-here-${Math.random().toString(36).slice(2)}`);
    await seedProject("demo", missing);
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    expect(
      errSpy.mock.calls.some((c) => (c[0] as string).startsWith("error: project root invalid:")),
    ).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const STARTED_AT = "2026-05-09T12:00:00.000Z";

describe("connectorSyncCommand — skipped + created", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-skip-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-skip-root-"));
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

  async function seedProjectWithSession(name: string): Promise<void> {
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID,
          name,
          rootPath: projectRoot,
          createdAt: STARTED_AT,
          updatedAt: STARTED_AT,
        },
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
          title: "smoke",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ]),
    );
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

  it("prints two skipped lines for an empty projectRoot with no --target", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  skipped",
      "codex        AGENTS.md  skipped",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
  });

  it("creates AGENTS.md when --target codex is given on an empty projectRoot", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo", target: "codex" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  skipped",
      "codex        AGENTS.md  created",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
    const written = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(written).toMatch(/<!-- MEGA SAVER:BEGIN -->/);
    expect(written).toMatch(/<!-- MEGA SAVER:END -->/);
    expect(written).toContain("Agent: codex");
  });

  it("creates CLAUDE.md when --target claude-code is given on an empty projectRoot", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo", target: "claude-code" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  created",
      "codex        AGENTS.md  skipped",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
    const written = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(written).toContain("Agent: claude-code");
  });
});

const MEGA_BLOCK_PLACEHOLDER = (projectName: string, projectId: string, agent: string): string =>
  [
    "# Project notes",
    "",
    "<!-- MEGA SAVER:BEGIN -->",
    "# Mega Saver Context",
    "",
    `Agent: ${agent}`,
    `Project: ${projectName} (${projectId})`,
    "Session: stale",
    "Risk: low",
    "",
    "## Memory",
    "",
    "- none",
    "<!-- MEGA SAVER:END -->",
    "",
  ].join("\n");

describe("connectorSyncCommand — wrote + noop", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-wrote-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-wrote-root-"));
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

  async function seedProjectAndSessions(opts: {
    name: string;
    sessions: Array<{
      id: string;
      agentId: "claude-code" | "codex";
      title: string | null;
      startedAt: string;
      endedAt: string | null;
    }>;
  }): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: opts.name, rootPath: projectRoot, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify(
        opts.sessions.map((s) => ({
          id: s.id,
          projectId: PROJECT_ID,
          agentId: s.agentId,
          riskLevel: "medium",
          title: s.title,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
        })),
      ),
    );
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

  it("writes both targets when each file already exists with a stale block", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "current",
          startedAt: STARTED_AT,
          endedAt: null,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          agentId: "codex",
          title: "current-codex",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ],
    });
    await writeFile(
      join(projectRoot, "CLAUDE.md"),
      MEGA_BLOCK_PLACEHOLDER("demo", "old-id", "claude-code"),
    );
    await writeFile(
      join(projectRoot, "AGENTS.md"),
      MEGA_BLOCK_PLACEHOLDER("demo", "old-id", "codex"),
    );

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  wrote",
      "codex        AGENTS.md  wrote",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const agentsMd = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(claudeMd).toContain(`Project: demo (${PROJECT_ID})`);
    expect(claudeMd).toContain("Session: current");
    expect(agentsMd).toContain(`Project: demo (${PROJECT_ID})`);
    expect(agentsMd).toContain("Session: current-codex");
    // Old id is gone.
    expect(claudeMd).not.toContain("old-id");
    expect(agentsMd).not.toContain("old-id");
  });

  it("emits noop on idempotent rerun (block content unchanged)", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "current",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ],
    });
    // First sync seeds the files.
    await runSync({ projectName: "demo", target: "claude-code" });
    // Reset spies to isolate the rerun output.
    logSpy.mockClear();
    errSpy.mockClear();

    await runSync({ projectName: "demo", target: "claude-code" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  noop",
      "codex        AGENTS.md  skipped",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
  });

  it("emits mixed statuses when only one target's content changed", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "v1",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ],
    });
    // Seed both files.
    await runSync({ projectName: "demo", target: "claude-code" });
    await runSync({ projectName: "demo", target: "codex" });
    logSpy.mockClear();

    // Bump the claude-code session title via store edit.
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: "claude-code",
          riskLevel: "medium",
          title: "v2",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ]),
    );

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  wrote",
      "codex        AGENTS.md  noop",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
  });

  it("picks latest open session per agent (multiple sessions of same agent)", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          agentId: "claude-code",
          title: "old-open",
          startedAt: "2026-05-09T10:00:00.000Z",
          endedAt: null,
        },
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          agentId: "claude-code",
          title: "newest-open",
          startedAt: "2026-05-09T12:00:00.000Z",
          endedAt: null,
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          agentId: "claude-code",
          title: "ended",
          startedAt: "2026-05-09T13:00:00.000Z",
          endedAt: "2026-05-09T13:30:00.000Z",
        },
      ],
    });
    await runSync({ projectName: "demo", target: "claude-code" });

    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Session: newest-open");
    expect(claudeMd).not.toContain("old-open");
    expect(claudeMd).not.toContain("ended");
  });

  it("renders Session: none when no matching open session exists", async () => {
    await seedProjectAndSessions({
      name: "demo",
      sessions: [
        {
          id: SESSION_ID,
          agentId: "claude-code",
          title: "ended",
          startedAt: STARTED_AT,
          endedAt: "2026-05-09T13:00:00.000Z",
        },
      ],
    });
    await runSync({ projectName: "demo", target: "claude-code" });
    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Session: none");
  });
});

describe("connectorSyncCommand — best-effort partial failure", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-fail-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-connector-fail-root-"));
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

  async function seedSimple(): Promise<void> {
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
          title: "smoke",
          startedAt: STARTED_AT,
          endedAt: null,
        },
      ]),
    );
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

  it("continues past a per-target block_conflict, reports both targets, exits 1", async () => {
    await seedSimple();
    // Seed CLAUDE.md cleanly so it can be written.
    await writeFile(join(projectRoot, "CLAUDE.md"), "# Notes\n");
    // Seed AGENTS.md with two BEGIN sentinels — parseBlock throws block_conflict.
    await writeFile(
      join(projectRoot, "AGENTS.md"),
      [
        "<!-- MEGA SAVER:BEGIN -->",
        "first block",
        "<!-- MEGA SAVER:END -->",
        "",
        "<!-- MEGA SAVER:BEGIN -->",
        "second block",
        "<!-- MEGA SAVER:END -->",
        "",
      ].join("\n"),
    );

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(1);
    const stdoutLines = logSpy.mock.calls.map((c) => c[0]);
    expect(stdoutLines).toEqual([
      "claude-code  CLAUDE.md  wrote",
      "codex        AGENTS.md  error",
      "cursor       .cursor/rules/megasaver.mdc  skipped",
      "aider        CONVENTIONS.md  skipped",
    ]);
    expect(
      errSpy.mock.calls.some(
        (c) =>
          (c[0] as string).startsWith("error: connector block conflict in AGENTS.md:") &&
          (c[0] as string).includes("begin sentinel"),
      ),
    ).toBe(true);
  });

  it("surfaces a ConnectorError(file_write_failed) as per-target error, exit 1", async () => {
    await seedSimple();
    // Seed CLAUDE.md as a SYMLINK — connectors-shared writeTargetFile refuses to replace it.
    const { symlink } = await import("node:fs/promises");
    const tempTarget = join(
      tmpdir(),
      `megasaver-symlink-target-${Math.random().toString(36).slice(2)}`,
    );
    await writeFile(tempTarget, "not the real target\n");
    await symlink(tempTarget, join(projectRoot, "CLAUDE.md"));

    await runSync({ projectName: "demo" });

    expect(process.exitCode).toBe(1);
    expect(logSpy.mock.calls.map((c) => c[0])[0]).toBe("claude-code  CLAUDE.md  error");
    expect(
      errSpy.mock.calls.some((c) =>
        (c[0] as string).startsWith("error: connector failed to write CLAUDE.md:"),
      ),
    ).toBe(true);
    await rm(tempTarget, { force: true });
  });
});

describe("pickLatestOpenSession — numeric ranking", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-pickrank-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-pickrank-root-"));
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

  const PROJECT_ID_RANK = "44444444-4444-4444-8444-444444444444";
  const SESS_A = "55555555-5555-4555-8555-555555555555";
  const SESS_B = "66666666-6666-4666-8666-666666666666";

  it("ranks open sessions by UTC instant, not lexicographic order", async () => {
    // Two open claude-code sessions whose lexicographic compare
    // disagrees with the numeric (instant) compare.
    //   sess-A startedAt = 2026-05-09T10:00:00+02:00 (UTC 08:00 — earlier)
    //   sess-B startedAt = 2026-05-09T09:00:00Z      (UTC 09:00 — later)
    // Lexicographic ">" picks A ("10..." > "09...").
    // Numeric Date.parse picks B (later instant).
    // Expected: status emits B's id.
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID_RANK,
          name: "rank",
          rootPath: projectRoot,
          createdAt: ts,
          updatedAt: ts,
        },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESS_A,
          projectId: PROJECT_ID_RANK,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T10:00:00+02:00",
          endedAt: null,
        },
        {
          id: SESS_B,
          projectId: PROJECT_ID_RANK,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T09:00:00Z",
          endedAt: null,
        },
      ]),
    );

    await connectorStatusCommand.run?.({
      args: { projectName: "rank", store, target: "claude-code" },
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([`claude-code  CLAUDE.md  missing  session=${SESS_B}`]);
  });
});

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
      JSON.stringify([{ id: PROJECT_ID_CURSOR, name, rootPath, createdAt: ts, updatedAt: ts }]),
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
    await seedSession("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "cursor", "2026-05-09T01:00:00.000Z");
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
    await expect(
      readFile(join(projectRoot, ".cursor/rules/megasaver.mdc"), "utf8"),
    ).rejects.toThrow();
  });

  it("creates CONVENTIONS.md with no frontmatter when --target aider on empty project", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo", target: "aider" });
    expect(process.exitCode).toBe(0);
    const written = await readFile(join(projectRoot, "CONVENTIONS.md"), "utf8");
    // Plain markdown — no YAML frontmatter prefix.
    expect(written.startsWith("---\n")).toBe(false);
    expect(written).toContain("<!-- MEGA SAVER:BEGIN -->");
    expect(written).toContain("Agent: aider");
    expect(written).toContain("<!-- MEGA SAVER:END -->");
    expect(logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+created$/.test(c[0] as string))).toBe(true);
  });

  it("appends the block to a pre-existing CONVENTIONS.md and preserves user content", async () => {
    await seedProject("demo", projectRoot);
    const userContent = "# Team Conventions\n\n- Use 2-space indent.\n- Run pnpm verify before push.\n";
    await writeFile(join(projectRoot, "CONVENTIONS.md"), userContent);

    await runSync({ projectName: "demo", target: "aider" });

    expect(process.exitCode).toBe(0);
    const written = await readFile(join(projectRoot, "CONVENTIONS.md"), "utf8");
    // User content stays intact at the top.
    expect(written.startsWith("# Team Conventions\n")).toBe(true);
    expect(written).toContain("- Use 2-space indent.");
    expect(written).toContain("- Run pnpm verify before push.");
    // Block is appended below.
    expect(written).toMatch(/Run pnpm verify before push\.\n+<!-- MEGA SAVER:BEGIN -->/);
    expect(written.endsWith("<!-- MEGA SAVER:END -->\n")).toBe(true);
    // Status word is "wrote" because file existed (not "created").
    expect(logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+wrote$/.test(c[0] as string))).toBe(true);
  });

  it("default sync (no --target) silently skips a missing CONVENTIONS.md", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+skipped$/.test(c[0] as string))).toBe(true);
  });
});

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
  const SESSION_CC = "22222222-2222-4222-8222-222222222222";
  const SESSION_CC_OLD = "33333333-3333-4333-8333-333333333333";
  const SESSION_CODEX = "44444444-4444-4444-8444-444444444444";
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
    await runSync({});

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const agents = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    expect(claude).toContain(MEM_CC_CURRENT);
    expect(claude).not.toContain(MEM_CODEX);
    expect(agents).toContain(MEM_CODEX);
    expect(agents).not.toContain(MEM_CC_CURRENT);
  });
});
