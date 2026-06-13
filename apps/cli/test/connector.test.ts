import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorError, MEGA_SAVER_BLOCK_START } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorStatusCommand, connectorSyncCommand } from "../src/commands/connector/index.js";
import { KNOWN_TARGET_IDS } from "../src/known-targets.js";
import { describeUnlessWindows } from "./_platform.js";

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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
        (c) =>
          c[0] ===
          'error: invalid target "nope", expected: claude-code | codex | cursor | aider | gemini | windsurf | continue',
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
      `claude-code  CLAUDE.md  skipped  session=${SESSION_ID}`,
      "codex        AGENTS.md  skipped  session=none",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
    ]);
  });

  it("creates AGENTS.md when --target codex is given on an empty projectRoot", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo", target: "codex" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      `claude-code  CLAUDE.md  skipped  session=${SESSION_ID}`,
      "codex        AGENTS.md  created  session=none",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
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
      `claude-code  CLAUDE.md  created  session=${SESSION_ID}`,
      "codex        AGENTS.md  skipped  session=none",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
      `claude-code  CLAUDE.md  wrote  session=${SESSION_ID}`,
      "codex        AGENTS.md  wrote  session=33333333-3333-4333-8333-333333333333",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
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
      `claude-code  CLAUDE.md  noop  session=${SESSION_ID}`,
      "codex        AGENTS.md  skipped  session=none",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
    ]);
  });

  it("emits noop on a mixed-EOL rerun (prose CRLF, block LF)", async () => {
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
    await writeFile(join(projectRoot, "CLAUDE.md"), "# My Project\n\nNotes.\n");
    await runSync({ projectName: "demo", target: "claude-code" });

    // Mixed file: prose region → CRLF, managed block stays LF.
    const synced = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const markerIdx = synced.indexOf(MEGA_SAVER_BLOCK_START);
    expect(markerIdx).toBeGreaterThan(0);
    const proseCrlf = synced.slice(0, markerIdx).replace(/\n/g, "\r\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), proseCrlf + synced.slice(markerIdx));

    logSpy.mockClear();
    errSpy.mockClear();
    await runSync({ projectName: "demo", target: "claude-code" });

    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toContain(
      `claude-code  CLAUDE.md  noop  session=${SESSION_ID}`,
    );
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
      `claude-code  CLAUDE.md  wrote  session=${SESSION_ID}`,
      "codex        AGENTS.md  noop  session=none",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
      `claude-code  CLAUDE.md  wrote  session=${SESSION_ID}`,
      "codex        AGENTS.md  error  session=none",
      "cursor       .cursor/rules/megasaver.mdc  skipped  session=none",
      "aider        CONVENTIONS.md  skipped  session=none",
      "gemini       GEMINI.md  skipped  session=none",
      "windsurf     .windsurfrules  skipped  session=none",
      "continue     .continue/rules/megasaver.md  skipped  session=none",
    ]);
    expect(
      errSpy.mock.calls.some(
        (c) =>
          (c[0] as string).startsWith("error: connector block conflict in AGENTS.md:") &&
          (c[0] as string).includes("begin sentinel"),
      ),
    ).toBe(true);
  });

  describeUnlessWindows("POSIX permission + symlink semantics", () => {
    // U6/U7: chmod 0o500 on .cursor (read+execute, NO write). readTargetFile
    // traverses .cursor → finds rules/megasaver.mdc absent → returns null. Then
    // mkdir(.cursor/rules, recursive) fails with EACCES (no +w on parent). The
    // U7 try/catch wraps this as ConnectorError("file_write_failed").
    it("wraps mkdir EACCES as file_write_failed when target dir parent has no write permission", async () => {
      if (process.getuid && process.getuid() === 0) {
        // chmod cannot block root; CI typically runs non-root.
        return;
      }
      await seedSimple();
      const cursorDir = join(projectRoot, ".cursor");
      const { chmod } = await import("node:fs/promises");
      await mkdir(cursorDir);
      await chmod(cursorDir, 0o500);

      try {
        await runSync({ projectName: "demo", target: "cursor" });

        expect(process.exitCode).toBe(1);
        const stdoutLines = logSpy.mock.calls.map((c) => c[0] as string);
        expect(stdoutLines.some((l) => l.includes("cursor") && l.includes("error"))).toBe(true);
        expect(
          errSpy.mock.calls.some(
            (c) =>
              (c[0] as string).startsWith("error: connector failed to write") &&
              (c[0] as string).includes("megasaver.mdc"),
          ),
        ).toBe(true);
      } finally {
        await chmod(cursorDir, 0o755);
      }
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
      expect(logSpy.mock.calls.map((c) => c[0])[0]).toBe(
        `claude-code  CLAUDE.md  error  session=${SESSION_ID}`,
      );
      expect(
        errSpy.mock.calls.some((c) =>
          (c[0] as string).startsWith("error: connector failed to write CLAUDE.md:"),
        ),
      ).toBe(true);
      await rm(tempTarget, { force: true });
    });
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
    expect(lines).toContain(
      `cursor       .cursor/rules/megasaver.mdc  created  session=${SESS_CURSOR}`,
    );
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
    expect(lines).toContain(
      "cursor       .cursor/rules/megasaver.mdc  wrote  session=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("default sync (no --target) silently skips a missing cursor file", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo" });

    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("cursor       .cursor/rules/megasaver.mdc  skipped  session=none");
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
    expect(
      logSpy.mock.calls.some((c) =>
        /^aider\s+CONVENTIONS\.md\s+created\s+session=none$/.test(c[0] as string),
      ),
    ).toBe(true);
  });

  it("appends the block to a pre-existing CONVENTIONS.md and preserves user content", async () => {
    await seedProject("demo", projectRoot);
    const userContent =
      "# Team Conventions\n\n- Use 2-space indent.\n- Run pnpm verify before push.\n";
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
    expect(
      logSpy.mock.calls.some((c) =>
        /^aider\s+CONVENTIONS\.md\s+wrote\s+session=none$/.test(c[0] as string),
      ),
    ).toBe(true);
  });

  it("default sync (no --target) silently skips a missing CONVENTIONS.md", async () => {
    await seedProject("demo", projectRoot);
    await runSync({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    expect(
      logSpy.mock.calls.some((c) =>
        /^aider\s+CONVENTIONS\.md\s+skipped\s+session=none$/.test(c[0] as string),
      ),
    ).toBe(true);
    await expect(readFile(join(projectRoot, "CONVENTIONS.md"), "utf8")).rejects.toThrow();
  });

  it("emits noop on idempotent aider rerun (block content unchanged)", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(SESS_CURSOR, "aider", "2026-05-09T00:00:00.000Z");
    // First sync seeds CONVENTIONS.md.
    await runSync({ projectName: "demo", target: "aider" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runSync({ projectName: "demo", target: "aider" });

    expect(process.exitCode).toBe(0);
    expect(
      logSpy.mock.calls.some((c) =>
        /^aider\s+CONVENTIONS\.md\s+noop\s+session=/.test(c[0] as string),
      ),
    ).toBe(true);
  });

  it("replaces stale aider block in-place (CONVENTIONS.md already exists)", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(SESS_CURSOR, "aider", "2026-05-09T00:00:00.000Z");
    await writeFile(
      join(projectRoot, "CONVENTIONS.md"),
      MEGA_BLOCK_PLACEHOLDER("demo", "old-aider-id", "aider"),
    );

    await runSync({ projectName: "demo", target: "aider" });

    expect(process.exitCode).toBe(0);
    const written = await readFile(join(projectRoot, "CONVENTIONS.md"), "utf8");
    expect(written).toContain(`Project: demo (${PROJECT_ID_CURSOR})`);
    expect(written).not.toContain("old-aider-id");
    expect(
      logSpy.mock.calls.some((c) =>
        /^aider\s+CONVENTIONS\.md\s+wrote\s+session=/.test(c[0] as string),
      ),
    ).toBe(true);
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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

  it("gates suggested memory out of connector sync — only approved appears in CLAUDE.md", async () => {
    await seedProject();
    const MEM_APPROVED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const MEM_SUGGESTED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await seedMemory([
      {
        id: MEM_APPROVED,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        type: "decision",
        title: "approved memory",
        content: "approved content here",
        keywords: [],
        confidence: "medium",
        source: "manual",
        approval: "approved",
        stale: false,
        createdAt: TS,
        updatedAt: TS,
      },
      {
        id: MEM_SUGGESTED,
        projectId: PROJECT_ID,
        sessionId: null,
        scope: "project",
        type: "decision",
        title: "suggested memory",
        content: "suggested content here",
        keywords: [],
        confidence: "medium",
        source: "agent",
        approval: "suggested",
        stale: false,
        createdAt: TS,
        updatedAt: TS,
      },
    ]);
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ target: "claude-code" });

    const claude = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claude).toContain("approved content here");
    expect(claude).not.toContain("suggested content here");
  });
});

describe("connectorSyncCommand — X4 filter-then-cap-by-recency (25 entries → 20 most recent)", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PROJECT_ID_X4 = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-x4-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-x4-root-"));
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

  it("caps at 20 most-recent entries when project has 25, rendered in descending createdAt order", async () => {
    await mkdir(store, { recursive: true });
    await mkdir(join(store, "memory"), { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID_X4,
          name: "bigdemo",
          rootPath: projectRoot,
          createdAt: ts,
          updatedAt: ts,
        },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");

    // Create 25 project-scoped entries with incrementing createdAt timestamps.
    // Entry i has createdAt = 2026-05-09T00:00:0{i}Z (i from 1 to 25).
    const entries = Array.from({ length: 25 }, (_, idx) => {
      const i = idx + 1;
      const pad = String(i).padStart(2, "0");
      return {
        id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
        projectId: PROJECT_ID_X4,
        sessionId: null,
        scope: "project",
        content: `entry-${i}`,
        createdAt: `2026-05-09T00:00:${pad}.000Z`,
      };
    });
    const body = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
    await writeFile(join(store, "memory", `${PROJECT_ID_X4}.jsonl`), body);

    // Seed CLAUDE.md so sync runs (skips if missing without --target claude-code, but
    // we force it explicitly via the file presence + no target filter).
    await writeFile(join(projectRoot, "CLAUDE.md"), "");

    await connectorSyncCommand.run?.({
      args: { projectName: "bigdemo", store, target: "claude-code" },
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    const content = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");

    // Must contain the 20 most recent: entries 6-25 (word-boundary anchored).
    for (let i = 6; i <= 25; i++) {
      expect(content).toMatch(new RegExp(`\\bentry-${i}\\b`));
    }
    // Must NOT contain the 5 oldest: entries 1-5 (word-boundary avoids entry-1 ⊂ entry-10).
    for (let i = 1; i <= 5; i++) {
      expect(content).not.toMatch(new RegExp(`\\bentry-${i}\\b`));
    }

    // Verify ordering: entry-25 (most recent) appears before entry-6 (least recent of the cap).
    const entry25Pos = content.search(/\bentry-25\b/);
    const entry6Pos = content.search(/\bentry-6\b/);
    expect(entry25Pos).toBeGreaterThanOrEqual(0);
    expect(entry6Pos).toBeGreaterThanOrEqual(0);
    expect(entry25Pos).toBeLessThan(entry6Pos);
  });
});

describe("connector --target drift guards", () => {
  it("--target description on connectorSyncCommand derives from KNOWN_TARGET_IDS", () => {
    const expected = `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to seed when its file does not exist.`;
    const args = connectorSyncCommand.args as { target?: { description?: string } };
    expect(args.target?.description).toBe(expected);
  });

  it("--target description on connectorStatusCommand derives from KNOWN_TARGET_IDS", () => {
    const expected = `Optional target id (${KNOWN_TARGET_IDS.join(" | ")}) to filter the report.`;
    const args = connectorStatusCommand.args as { target?: { description?: string } };
    expect(args.target?.description).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U3 — cursor sync into existing user-content .mdc file (humanContent path)
// ─────────────────────────────────────────────────────────────────────────────

describe("U3 — cursor sync appends managed block to pre-existing user content", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PROJECT_ID_U3 = "aaaa0003-0003-4003-8003-000000000003";
  const SESS_U3 = "bbbb0003-0003-4003-8003-000000000003";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-u3-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-u3-root-"));
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
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID_U3,
          name: "demo",
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
          id: SESS_U3,
          projectId: PROJECT_ID_U3,
          agentId: "cursor",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T10:00:00.000Z",
          endedAt: null,
        },
      ]),
    );
  }

  it("appends the managed block after user content when no sentinels exist", async () => {
    await seedProject();

    // Seed .cursor/rules/megasaver.mdc with frontmatter + user prose + no sentinels.
    const cursorDir = join(projectRoot, ".cursor", "rules");
    await mkdir(cursorDir, { recursive: true });
    const userContent =
      "---\nalwaysApply: true\n---\n\n# My existing cursor rules\n\nKeep this content intact.\n";
    await writeFile(join(cursorDir, "megasaver.mdc"), userContent);

    await connectorSyncCommand.run?.({
      args: { projectName: "demo", store, target: "cursor" },
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);
    const written = await readFile(join(cursorDir, "megasaver.mdc"), "utf8");

    // User content is preserved at the top.
    expect(written.startsWith("---\nalwaysApply: true\n---")).toBe(true);
    expect(written).toContain("# My existing cursor rules");
    expect(written).toContain("Keep this content intact.");

    // Managed block is APPENDED (not replacing user content).
    expect(written).toContain("<!-- MEGA SAVER:BEGIN -->");
    expect(written).toContain("<!-- MEGA SAVER:END -->");
    expect(written.endsWith("<!-- MEGA SAVER:END -->\n")).toBe(true);

    // User content appears BEFORE the managed block.
    const userEndPos = written.indexOf("Keep this content intact.");
    const blockStartPos = written.indexOf("<!-- MEGA SAVER:BEGIN -->");
    expect(userEndPos).toBeGreaterThanOrEqual(0);
    expect(blockStartPos).toBeGreaterThanOrEqual(0);
    expect(userEndPos).toBeLessThan(blockStartPos);

    // Status word is "wrote" (file existed, not "created").
    expect(
      logSpy.mock.calls.some((c) =>
        /^cursor\s+\.cursor\/rules\/megasaver\.mdc\s+wrote\s+session=/.test(c[0] as string),
      ),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U5 — cursor multi-open-session cross-leak test
// ─────────────────────────────────────────────────────────────────────────────

describe("U5 — cursor sync: each target block contains its own session, not the other agent's", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PROJECT_ID_U5 = "cccc0005-0005-4005-8005-000000000005";
  const SESS_CC_U5 = "dddd0005-0005-4005-8005-000000000005";
  const SESS_CURSOR_U5 = "eeee0005-0005-4005-8005-000000000005";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-u5-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-u5-root-"));
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

  it("each target block contains exactly its own open session id, not the other agent's", async () => {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID_U5,
          name: "demo",
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
          id: SESS_CC_U5,
          projectId: PROJECT_ID_U5,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T10:00:00.000Z",
          endedAt: null,
        },
        {
          id: SESS_CURSOR_U5,
          projectId: PROJECT_ID_U5,
          agentId: "cursor",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T10:00:00.000Z",
          endedAt: null,
        },
      ]),
    );

    // Pre-create both target files so sync runs "wrote" not "skipped".
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    const cursorDir = join(projectRoot, ".cursor", "rules");
    await mkdir(cursorDir, { recursive: true });
    await writeFile(join(cursorDir, "megasaver.mdc"), "");

    await connectorSyncCommand.run?.({
      args: { projectName: "demo", store },
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(0);

    const claudeMd = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const cursorMdc = await readFile(join(cursorDir, "megasaver.mdc"), "utf8");

    // CLAUDE.md must contain the claude-code session id, not cursor's.
    expect(claudeMd).toContain(SESS_CC_U5);
    expect(claudeMd).not.toContain(SESS_CURSOR_U5);

    // megasaver.mdc must contain the cursor session id, not claude-code's.
    expect(cursorMdc).toContain(SESS_CURSOR_U5);
    expect(cursorMdc).not.toContain(SESS_CC_U5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("connectorSyncCommand — phase 9 targets", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PID = "77777777-7777-4777-8777-777777777777";
  const TS = "2026-06-12T00:00:00.000Z";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-p9-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-p9-root-"));
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
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function runSync(target?: string): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: "demo", store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (target !== undefined) cliArgs["target"] = target;
    await connectorSyncCommand.run?.({
      args: cliArgs,
      cmd: connectorSyncCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  const cases = [
    { id: "gemini", path: "GEMINI.md" },
    { id: "windsurf", path: ".windsurfrules" },
    { id: "continue", path: ".continue/rules/megasaver.md" },
  ] as const;

  for (const c of cases) {
    it(`seeds ${c.path} with a Mega Saver block on first --target sync`, async () => {
      await seedProject();
      await runSync(c.id);
      const content = await readFile(join(projectRoot, c.path), "utf8");
      expect(content).toContain(MEGA_SAVER_BLOCK_START);
      const lines = logSpy.mock.calls.map((cc) => cc[0] as string);
      expect(
        lines.some((l) => l.startsWith(c.id) && l.includes(c.path) && l.includes("created")),
      ).toBe(true);
    });

    it(`default sync skips a missing ${c.id} file`, async () => {
      await seedProject();
      await runSync();
      const lines = logSpy.mock.calls.map((cc) => cc[0] as string);
      expect(lines.some((l) => l.startsWith(c.id) && l.includes("skipped"))).toBe(true);
      await expect(readFile(join(projectRoot, c.path), "utf8")).rejects.toThrow();
    });
  }
});
