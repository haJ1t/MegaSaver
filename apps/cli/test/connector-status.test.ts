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
      riskLevel: "medium",
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
    await seedSession(
      "33333333-3333-4333-8333-333333333333",
      "claude-code",
      "2026-05-09T00:00:00.000Z",
    );
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ projectName: "demo" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain(
      "claude-code  CLAUDE.md  in-sync  session=33333333-3333-4333-8333-333333333333",
    );
  });

  it("reports drift after the open session is ended", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(
      "33333333-3333-4333-8333-333333333333",
      "claude-code",
      "2026-05-09T00:00:00.000Z",
    );
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runSync({ projectName: "demo" });
    logSpy.mockClear();
    errSpy.mockClear();

    await endSession("33333333-3333-4333-8333-333333333333", "2026-05-09T01:00:00.000Z");
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain("claude-code  CLAUDE.md  drift  session=none");
  });

  it("reports drift when the block was edited manually", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(
      "33333333-3333-4333-8333-333333333333",
      "claude-code",
      "2026-05-09T00:00:00.000Z",
    );
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
      "claude-code  CLAUDE.md  drift  session=33333333-3333-4333-8333-333333333333",
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
