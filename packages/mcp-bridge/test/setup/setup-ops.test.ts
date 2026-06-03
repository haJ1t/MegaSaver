import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMcpSetupOps } from "../../src/setup/setup-ops.js";

describe("buildMcpSetupOps — facade (F2/F4/F6)", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "mcp-ops-home-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // The connectorSynced resolver is injected (the CLI/GUI supply a
  // real one over parseBlock); the test fakes it deterministically.
  function ops(connectorSynced: (agentId: string) => Promise<boolean>) {
    return buildMcpSetupOps({
      home,
      command: "mega-mcp",
      connectorSyncedResolver: connectorSynced,
      // repair's connector-sync side effect is also injected so the
      // facade stays free of CLI/registry coupling (AA1 §2c DI).
      connectorSync: async () => undefined,
    });
  }

  it("status() returns one row per known agent with all five fields", async () => {
    const result = await ops(async () => false).status();
    expect(result.agents).toHaveLength(4);
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude).toMatchObject({
      target: "claude-code",
      agentId: "claude-code",
      mcpInstalled: false,
      connectorSynced: false,
      restartRequired: false,
      restartHint: expect.stringContaining("Claude Code"),
    });
  });

  it("install() flips mcpInstalled + restartRequired true in the returned snapshot", async () => {
    const result = await ops(async () => false).install("claude-code", "demo");
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude).toMatchObject({ mcpInstalled: true, restartRequired: true });
    // the config file was actually written by the underlying primitive
    const raw = JSON.parse(await readFile(join(home, ".config", "claude", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(raw.mcpServers.megasaver).toBeDefined();
  });

  it("repair() runs the injected connectorSync and reports connectorSynced true after", async () => {
    let synced = false;
    const o = buildMcpSetupOps({
      home,
      command: "mega-mcp",
      connectorSyncedResolver: async () => synced,
      connectorSync: async () => {
        synced = true; // simulate the connector block landing
      },
    });
    const result = await o.repair("claude-code", "demo");
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude).toMatchObject({ mcpInstalled: true, connectorSynced: true });
  });

  it("uninstall() flips mcpInstalled back to false", async () => {
    const o = ops(async () => true);
    await o.install("claude-code", "demo");
    const result = await o.uninstall("claude-code");
    const claude = result.agents.find((a) => a.agentId === "claude-code");
    expect(claude?.mcpInstalled).toBe(false);
  });
});
