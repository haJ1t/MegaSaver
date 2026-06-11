import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEGA_SAVER_BLOCK_START } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectorStatusCommand,
  runConnectorStatus,
  runConnectorSync,
} from "../src/commands/connector/index.js";
import { KNOWN_TARGETS, KNOWN_TARGET_IDS } from "../src/known-targets.js";
import { describeUnlessWindows } from "./_platform.js";

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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
        (c) =>
          c[0] === 'error: invalid target "nope", expected: claude-code | codex | cursor | aider',
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
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
      "cursor       .cursor/rules/megasaver.mdc  missing  session=none",
      "aider        CONVENTIONS.md  missing  session=none",
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
      platform: "linux",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports in-sync for a mixed-EOL file (prose CRLF, block LF)", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(
      "33333333-3333-4333-8333-333333333333",
      "claude-code",
      "2026-05-09T00:00:00.000Z",
    );
    // Seed prose so the synced file has a non-block region to make CRLF.
    await writeFile(join(projectRoot, "CLAUDE.md"), "# My Project\n\nNotes.\n");
    await runSync({ projectName: "demo" });

    // Build a mixed file: prose region → CRLF, managed block → LF.
    const synced = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    const markerIdx = synced.indexOf(MEGA_SAVER_BLOCK_START);
    expect(markerIdx).toBeGreaterThan(0);
    const proseCrlf = synced.slice(0, markerIdx).replace(/\n/g, "\r\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), proseCrlf + synced.slice(markerIdx));

    logSpy.mockClear();
    errSpy.mockClear();
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toContain(
      "claude-code  CLAUDE.md  in-sync  session=33333333-3333-4333-8333-333333333333",
    );
  });

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
      platform: "linux",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
      "<!-- MEGA SAVER:BEGIN -->",
      "first",
      "<!-- MEGA SAVER:END -->",
      "<!-- MEGA SAVER:BEGIN -->",
      "second",
      "<!-- MEGA SAVER:END -->",
      "",
    ].join("\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), malformed);
    await runStatus({ projectName: "demo", target: "claude-code" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual(["claude-code  CLAUDE.md  error  session=none"]);
    const errors = errSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(errors).toContain("begin sentinel");
    expect(errors).toContain("CLAUDE.md");
  });

  describeUnlessWindows("unreadable-file error path (POSIX chmod mode bits)", () => {
    it("reports error when CLAUDE.md is unreadable, then continues to codex", async () => {
      await seedProject("demo", projectRoot);
      await writeFile(join(projectRoot, "CLAUDE.md"), "anything\n");
      await chmod(join(projectRoot, "CLAUDE.md"), 0o000);
      await runStatus({ projectName: "demo" });
      expect(process.exitCode).toBe(1);
      const lines = logSpy.mock.calls.map((c) => c[0] as string);
      expect(lines[0]).toBe("claude-code  CLAUDE.md  error  session=none");
      expect(lines[1]).toBe("codex        AGENTS.md  missing  session=none");
    });
  });

  it("emits both lines in declaration order when claude-code in-sync and codex drift", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(
      "33333333-3333-4333-8333-333333333333",
      "claude-code",
      "2026-05-09T00:00:00.000Z",
    );
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await writeFile(join(projectRoot, "AGENTS.md"), "");
    await runSync({ projectName: "demo" });
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
    expect(lines[0]).toBe(
      "claude-code  CLAUDE.md  in-sync  session=33333333-3333-4333-8333-333333333333",
    );
    expect(lines[1]).toBe("codex        AGENTS.md  drift  session=none");
  });

  it("emits the open-session id on the error line, not just none", async () => {
    const SESS_OPEN = "77777777-7777-4777-8777-777777777777";
    await seedProject("demo", projectRoot);
    await seedSession(SESS_OPEN, "claude-code", "2026-05-09T00:00:00.000Z");
    const malformed = [
      "<!-- MEGA SAVER:BEGIN -->",
      "first",
      "<!-- MEGA SAVER:END -->",
      "<!-- MEGA SAVER:BEGIN -->",
      "second",
      "<!-- MEGA SAVER:END -->",
      "",
    ].join("\n");
    await writeFile(join(projectRoot, "CLAUDE.md"), malformed);
    await runStatus({ projectName: "demo", target: "claude-code" });
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([`claude-code  CLAUDE.md  error  session=${SESS_OPEN}`]);
    const errors = errSpy.mock.calls.map((c) => c[0] as string).join("\n");
    expect(errors).toContain("begin sentinel");
    expect(errors).toContain("CLAUDE.md");
  });
});

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
      JSON.stringify([{ id: PROJECT_ID_CURSOR_S, name, rootPath, createdAt: ts, updatedAt: ts }]),
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
      platform: "linux",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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
      "aider        CONVENTIONS.md  missing  session=none",
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

describe("S11 — targets filter invariant: each known target id resolves to exactly one entry", () => {
  // When --target X is a valid known target id, KNOWN_TARGETS.filter(t => t.id === X)
  // must yield exactly one entry (no duplicates, no misses).
  // This pins the invariant the status loop relies on: after the pre-loop guard
  // accepts the target, the filtered array always has length === 1.
  it("each KNOWN_TARGET_IDS value resolves to exactly one entry in KNOWN_TARGETS", () => {
    for (const targetId of KNOWN_TARGET_IDS) {
      const filtered = KNOWN_TARGETS.filter((t) => t.id === targetId);
      expect(filtered).toHaveLength(1);
    }
  });

  it("KNOWN_TARGET_IDS has no duplicates", () => {
    const unique = new Set(KNOWN_TARGET_IDS);
    expect(unique.size).toBe(KNOWN_TARGET_IDS.length);
  });
});

describe("U2 — cursor-specific no-block status test", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  const PROJECT_ID_U2 = "ffff0000-0000-4000-8000-000000000002";
  const SESS_U2 = "ffff0001-0001-4001-8001-000000000002";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-u2-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-u2-root-"));
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
        { id: PROJECT_ID_U2, name: "demo", rootPath: projectRoot, createdAt: ts, updatedAt: ts },
      ]),
    );
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESS_U2,
          projectId: PROJECT_ID_U2,
          agentId: "cursor",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-09T10:00:00.000Z",
          endedAt: null,
        },
      ]),
    );
  }

  it("reports cursor no-block when .cursor/rules/megasaver.mdc exists without sentinels", async () => {
    await seedProject();
    // Seed the cursor file with user content but NO Mega Saver sentinels.
    const cursorDir = join(projectRoot, ".cursor", "rules");
    await mkdir(cursorDir, { recursive: true });
    await writeFile(
      join(cursorDir, "megasaver.mdc"),
      "---\nalwaysApply: true\n---\n\n# My rules\n\nSome existing cursor rules.\n",
    );

    await connectorStatusCommand.run?.({
      args: { projectName: "demo", store, target: "cursor" },
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);

    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    // Must contain the cursor no-block line with the open session id.
    expect(lines).toContain(
      `cursor       .cursor/rules/megasaver.mdc  no-block  session=${SESS_U2}`,
    );
  });
});

describe("connectorStatusCommand — aider target", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-aider-status-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-aider-status-root-"));
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

  const PROJECT_ID_AIDER_S = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const SESS_AIDER_S = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  async function seedProject(name: string, rootPath: string): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-09T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([{ id: PROJECT_ID_AIDER_S, name, rootPath, createdAt: ts, updatedAt: ts }]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(id: string, agentId: string, startedAt: string): Promise<void> {
    const arr = JSON.parse(await readFile(join(store, "sessions.json"), "utf8"));
    arr.push({
      id,
      projectId: PROJECT_ID_AIDER_S,
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
      platform: "linux",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runStatus(args: { projectName: string; target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: args.projectName, store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
    await connectorStatusCommand.run?.({
      args: cliArgs,
      cmd: connectorStatusCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports all four targets missing on an empty project root", async () => {
    await seedProject("demo", projectRoot);
    await runStatus({ projectName: "demo" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      "claude-code  CLAUDE.md  missing  session=none",
      "codex        AGENTS.md  missing  session=none",
      "cursor       .cursor/rules/megasaver.mdc  missing  session=none",
      "aider        CONVENTIONS.md  missing  session=none",
    ]);
  });

  it("reports aider in-sync after sync --target aider seeds the file", async () => {
    await seedProject("demo", projectRoot);
    await seedSession(SESS_AIDER_S, "aider", "2026-05-09T00:00:00.000Z");
    await runSync({ projectName: "demo", target: "aider" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ projectName: "demo", target: "aider" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([`aider        CONVENTIONS.md  in-sync  session=${SESS_AIDER_S}`]);
  });
});

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
      platform: "linux",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runStatus(args: { target?: string }): Promise<void> {
    const cliArgs: Record<string, string> = { projectName: "demo", store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (args.target !== undefined) cliArgs["target"] = args.target;
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

    await runSync({ target: "claude-code" });
    logSpy.mockClear();
    errSpy.mockClear();

    await runStatus({ target: "claude-code" });
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.includes("in-sync"))).toBe(true);
  });
});

const PROJECT_ID_JSON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESS_JSON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("connectorStatusCommand — --json output", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-json-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-cstatus-json-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedProject(): Promise<void> {
    await mkdir(store, { recursive: true });
    const ts = "2026-05-10T00:00:00.000Z";
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        {
          id: PROJECT_ID_JSON,
          name: "json-demo",
          rootPath: projectRoot,
          createdAt: ts,
          updatedAt: ts,
        },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
  }

  async function seedSession(): Promise<void> {
    await writeFile(
      join(store, "sessions.json"),
      JSON.stringify([
        {
          id: SESS_JSON,
          projectId: PROJECT_ID_JSON,
          agentId: "claude-code",
          riskLevel: "medium",
          title: null,
          startedAt: "2026-05-10T00:00:00.000Z",
          endedAt: null,
        },
      ]),
    );
  }

  async function runStatus(args: { target?: string; json: boolean }): Promise<{
    out: string[];
    err: string[];
    code: number;
  }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runConnectorStatus({
      projectName: "json-demo",
      targetFlag: args.target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      json: args.json,
      stdout: (line) => out.push(line),
      stderr: (line) => err.push(line),
    });
    return { out, err, code };
  }

  it("all targets missing → JSON array with 4 missing records, session null", async () => {
    await seedProject();
    const { out, code } = await runStatus({ json: true });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const records = JSON.parse(out[0] as string);
    expect(records).toEqual([
      { id: "claude-code", relativePath: "CLAUDE.md", status: "missing", session: null },
      { id: "codex", relativePath: "AGENTS.md", status: "missing", session: null },
      {
        id: "cursor",
        relativePath: ".cursor/rules/megasaver.mdc",
        status: "missing",
        session: null,
      },
      { id: "aider", relativePath: "CONVENTIONS.md", status: "missing", session: null },
    ]);
  });

  it("--target claude-code with synced file → 1-element array, status in-sync, session id", async () => {
    await seedProject();
    await seedSession();
    await writeFile(join(projectRoot, "CLAUDE.md"), "");
    await runConnectorSync({
      projectName: "json-demo",
      targetFlag: "claude-code",
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: "linux",
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
    const { out, code } = await runStatus({ target: "claude-code", json: true });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const records = JSON.parse(out[0] as string);
    expect(records).toEqual([
      { id: "claude-code", relativePath: "CLAUDE.md", status: "in-sync", session: SESS_JSON },
    ]);
  });

  it("default (no --json) → stdout receives text lines, not JSON", async () => {
    await seedProject();
    const { out, code } = await runStatus({ json: false });
    expect(code).toBe(0);
    expect(out.length).toBeGreaterThan(0);
    for (const line of out) {
      expect(() => JSON.parse(line)).toThrow();
    }
  });
});
