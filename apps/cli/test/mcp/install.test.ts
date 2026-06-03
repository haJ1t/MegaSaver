import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMcpInstall } from "../../src/commands/mcp/install.js";

describe("runMcpInstall", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "cli-mcp-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("installs idempotently and prints text", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("claude-code");
    const code2 = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      json: false,
    });
    expect(code2).toBe(0);
    expect(out.join("\n")).toMatch(/already|no-op|unchanged/i);
  });

  it("writes a runnable launch entry: mega + [mcp, serve]", async () => {
    const result = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: () => undefined,
      stderr: () => undefined,
      json: true,
    });
    expect(result).toBe(0);
    const configPath = join(home, ".config", "claude", "mcp.json");
    const raw = JSON.parse(await readFile(configPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(raw.mcpServers.megasaver).toEqual({ command: "mega", args: ["mcp", "serve"] });
  });

  it("emits JSON with changed flag", async () => {
    const out: string[] = [];
    const code = await runMcpInstall({
      targetFlag: "claude-code",
      home,
      stdout: (l) => out.push(l),
      stderr: () => undefined,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out[0] ?? "") as { target: string; changed: boolean };
    expect(parsed).toMatchObject({ target: "claude-code", changed: true });
  });

  it("rejects an unknown target with exit 1", async () => {
    const err: string[] = [];
    const code = await runMcpInstall({
      targetFlag: "notanagent",
      home,
      stdout: () => undefined,
      stderr: (l) => err.push(l),
      json: false,
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("unknown_target");
  });
});
