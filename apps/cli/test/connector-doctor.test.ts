import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectorDoctorCommand,
  runConnectorDoctor,
  runConnectorSync,
} from "../src/commands/connector/index.js";
import { describeUnlessWindows } from "./_platform.js";

describe("connectorDoctorCommand", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const PID = "77777777-7777-4777-8777-777777777777";
  const TS = "2026-06-12T00:00:00.000Z";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-doc-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-doc-root-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = 0;
    await mkdir(store, { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    await mkdir(join(store, "memory"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedMemory(content: string): Promise<void> {
    await writeFile(
      join(store, "memory", `${PID}.jsonl`),
      `${JSON.stringify({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        projectId: PID,
        sessionId: null,
        scope: "project",
        content,
        createdAt: TS,
      })}\n`,
    );
  }

  async function seed(target: string): Promise<void> {
    await runConnectorSync({
      projectName: "demo",
      targetFlag: target,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
      json: false,
    });
  }

  async function runDoctor(target?: string): Promise<void> {
    const args: Record<string, unknown> = { projectName: "demo", store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (target !== undefined) args["target"] = target;
    await connectorDoctorCommand.run?.({
      args,
      cmd: connectorDoctorCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("reports ok for a freshly-synced, current file (exit 0)", async () => {
    await seed("gemini");
    await runDoctor("gemini");
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("ok"))).toBe(true);
  });

  it("reports stale and exits 1 when project memory advances after sync", async () => {
    await seed("gemini");
    await seedMemory("a new decision the file does not yet contain");
    await runDoctor("gemini");
    expect(process.exitCode).toBe(1);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("stale"))).toBe(true);
  });

  it("reports missing for an absent file (exit 0)", async () => {
    await runDoctor("gemini");
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("missing"))).toBe(true);
  });

  it("reports no-block for a user file without sentinels (exit 0)", async () => {
    await writeFile(join(projectRoot, "GEMINI.md"), "my own notes, no block\n");
    await runDoctor("gemini");
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.includes("no-block"))).toBe(true);
  });

  it("emits a JSON array with the documented record shape for a mixed set", async () => {
    await seed("gemini");
    const code = await runConnectorDoctor({
      projectName: "demo",
      targetFlag: undefined,
      storeFlag: store,
      cwd: projectRoot,
      home: "/tmp",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      json: true,
      stdout: (line) => console.log(line),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    const parsed = JSON.parse(lines.at(-1) as string) as Array<{
      id: string;
      relativePath: string;
      status: string;
      writable: boolean;
      session: string | null;
    }>;
    expect(parsed.length).toBe(7);
    for (const rec of parsed) {
      expect(rec).toHaveProperty("id");
      expect(rec).toHaveProperty("relativePath");
      expect(rec).toHaveProperty("status");
      expect(typeof rec.writable).toBe("boolean");
      expect(rec.session).toBeNull();
    }
    const gemini = parsed.find((r) => r.id === "gemini");
    expect(gemini).toMatchObject({
      id: "gemini",
      relativePath: "GEMINI.md",
      status: "ok",
      writable: true,
      session: null,
    });
    const missing = parsed.find((r) => r.id === "claude-code");
    expect(missing).toMatchObject({ status: "missing", writable: true });
  });

  describeUnlessWindows("writability (POSIX chmod)", () => {
    it("reports not-writable and exits 1 without modifying the file", async () => {
      await seed("gemini");
      const path = join(projectRoot, "GEMINI.md");
      const before = await readFile(path, "utf8");
      await chmod(path, 0o444);
      try {
        await runDoctor("gemini");
        expect(process.exitCode).toBe(1);
        const lines = logSpy.mock.calls.map((c) => c[0] as string);
        expect(lines.some((l) => l.startsWith("gemini") && l.includes("not-writable"))).toBe(true);
        expect(await readFile(path, "utf8")).toBe(before);
      } finally {
        await chmod(path, 0o644);
      }
    });

    it("reports not-writable for an absent file under a read-only parent (exit 1)", async () => {
      // continue writes to .continue/rules/megasaver.md; make the project root
      // read-only so the to-be-created ancestor directory is non-writable.
      await chmod(projectRoot, 0o555);
      try {
        await runDoctor("continue");
        expect(process.exitCode).toBe(1);
        const lines = logSpy.mock.calls.map((c) => c[0] as string);
        expect(lines.some((l) => l.startsWith("continue") && l.includes("not-writable"))).toBe(
          true,
        );
      } finally {
        await chmod(projectRoot, 0o755);
      }
    });
  });
});
