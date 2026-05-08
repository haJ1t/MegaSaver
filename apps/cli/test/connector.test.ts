import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorSyncCommand } from "../src/commands/connector.js";

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
        (c) => c[0] === 'error: invalid target "nope", expected: claude-code | codex',
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
    ]);
  });

  it("creates AGENTS.md when --target codex is given on an empty projectRoot", async () => {
    await seedProjectWithSession("demo");
    await runSync({ projectName: "demo", target: "codex" });
    expect(process.exitCode).toBe(0);
    expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
      "claude-code  CLAUDE.md  skipped",
      "codex        AGENTS.md  created",
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
    ]);
    const written = await readFile(join(projectRoot, "CLAUDE.md"), "utf8");
    expect(written).toContain("Agent: claude-code");
  });
});
