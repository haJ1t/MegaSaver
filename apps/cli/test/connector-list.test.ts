import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectorListCommand } from "../src/commands/connector/index.js";

describe("connectorListCommand", () => {
  let store: string;
  let projectRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const PID = "77777777-7777-4777-8777-777777777777";
  const TS = "2026-06-12T00:00:00.000Z";

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-list-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-list-root-"));
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function runList(json = false): Promise<void> {
    const args: Record<string, unknown> = { projectName: "demo", store };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    if (json) args["json"] = true;
    await connectorListCommand.run?.({
      args,
      cmd: connectorListCommand,
      rawArgs: [],
      data: undefined,
    } as never);
  }

  it("lists all known targets as absent in a fresh project and exits 0", async () => {
    await runList();
    expect(process.exitCode).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    for (const id of [
      "claude-code",
      "codex",
      "cursor",
      "aider",
      "gemini",
      "windsurf",
      "continue",
    ]) {
      expect(lines.some((l) => l.startsWith(id) && l.endsWith("absent"))).toBe(true);
    }
  });

  it("marks a present file present", async () => {
    await writeFile(join(projectRoot, "GEMINI.md"), "hello");
    await runList();
    const lines = logSpy.mock.calls.map((c) => c[0] as string);
    expect(lines.some((l) => l.startsWith("gemini") && l.endsWith("present"))).toBe(true);
  });

  it("--json emits id/agent/relativePath/present", async () => {
    await writeFile(join(projectRoot, "GEMINI.md"), "hello");
    await runList(true);
    const out = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    const gemini = out.find((r: { id: string }) => r.id === "gemini");
    expect(gemini).toEqual({
      id: "gemini",
      agent: "gemini",
      relativePath: "GEMINI.md",
      present: true,
    });
  });
});
