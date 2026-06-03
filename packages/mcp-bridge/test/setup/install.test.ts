import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAgent } from "../../src/setup/detect-agent.js";
import { installMcp, uninstallMcp } from "../../src/setup/install.js";

describe("installMcp / uninstallMcp — idempotent (AA1 §5c)", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mcp-setup-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("detectAgent resolves the claude-code config path", () => {
    const d = detectAgent({ agentId: "claude-code", home });
    expect(d.configPath).toContain("claude");
    expect(d.serverKey).toBe("megasaver");
  });

  it("install writes the server entry then is a no-op on re-run", async () => {
    const first = await installMcp({ agentId: "claude-code", home, command: "mega-mcp" });
    expect(first.changed).toBe(true);
    const raw1 = JSON.parse(await readFile(first.configPath, "utf8")) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(raw1.mcpServers.megasaver.command).toBe("mega-mcp");

    const second = await installMcp({ agentId: "claude-code", home, command: "mega-mcp" });
    expect(second.changed).toBe(false);
    const raw2 = await readFile(second.configPath, "utf8");
    expect(JSON.parse(raw2)).toEqual(raw1);
  });

  it("uninstall removes the server entry and is a no-op when absent", async () => {
    await installMcp({ agentId: "claude-code", home, command: "mega-mcp" });
    const removed = await uninstallMcp({ agentId: "claude-code", home });
    expect(removed.changed).toBe(true);
    const raw = JSON.parse(await readFile(removed.configPath, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(raw.mcpServers.megasaver).toBeUndefined();

    const again = await uninstallMcp({ agentId: "claude-code", home });
    expect(again.changed).toBe(false);
  });
});
