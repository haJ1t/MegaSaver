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
});
