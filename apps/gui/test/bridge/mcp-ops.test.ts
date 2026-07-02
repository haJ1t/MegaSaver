import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { DEFAULT_MCP_ARGS, DEFAULT_MCP_COMMAND } from "@megasaver/mcp-bridge";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpOps } from "../../bridge/mcp-ops.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-05-13T00:00:00.000Z";

describe("createMcpOps (GUI production facade — F3)", () => {
  let home: string;
  let projectRoot: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "gui-mcp-home-"));
    projectRoot = await mkdtemp(join(tmpdir(), "gui-mcp-root-"));
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function registryWithProject() {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID as ProjectId,
      name: "demo",
      rootPath: projectRoot,
      createdAt: TS,
      updatedAt: TS,
    });
    return registry;
  }

  it("status() returns four agent rows with connectorSynced + restartHint", async () => {
    const ops = createMcpOps({ registry: registryWithProject(), home, command: "mega-mcp" });
    const result = await ops.status();
    expect(result.agents).toHaveLength(4);
    expect(result.agents.every((a) => typeof a.restartHint === "string")).toBe(true);
  });

  it("install() writes the agent config (real primitive, not a stub)", async () => {
    const ops = createMcpOps({ registry: registryWithProject(), home, command: "mega-mcp" });
    await ops.install("claude-code", "demo");
    const raw = JSON.parse(await readFile(join(home, ".config", "claude", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(raw.mcpServers["megasaver"]).toBeDefined();
  });

  it("install() writes the runnable command + args when given the defaults", async () => {
    // server.ts passes the hoisted DEFAULT_MCP_COMMAND/DEFAULT_MCP_ARGS so the
    // GUI-initiated install writes a launchable config (`mega mcp serve`), not
    // the old dangling `mega-mcp` binary.
    const ops = createMcpOps({
      registry: registryWithProject(),
      home,
      command: DEFAULT_MCP_COMMAND,
      args: [...DEFAULT_MCP_ARGS],
    });
    await ops.install("claude-code", "demo");
    const raw = JSON.parse(await readFile(join(home, ".config", "claude", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(raw.mcpServers["megasaver"]).toEqual({ command: "mega", args: ["mcp", "serve"] });
  });

  it("repair() flips connectorSynced to true even with no open session", async () => {
    const ops = createMcpOps({
      registry: registryWithProject(),
      home,
      command: DEFAULT_MCP_COMMAND,
      args: [...DEFAULT_MCP_ARGS],
    });
    const before = await ops.status();
    expect(before.agents.find((a) => a.agentId === "claude-code")?.connectorSynced).toBe(false);

    await ops.repair("claude-code", "demo");

    const after = await ops.status();
    expect(after.agents.find((a) => a.agentId === "claude-code")?.connectorSynced).toBe(true);
  });

  it("status() tolerates a malformed target file in one project and checks the rest", async () => {
    const badRoot = await mkdtemp(join(tmpdir(), "gui-mcp-bad-"));
    try {
      const registry = createInMemoryCoreRegistry();
      registry.createProject({
        id: PROJECT_ID as ProjectId,
        name: "bad",
        rootPath: badRoot,
        createdAt: TS,
        updatedAt: TS,
      });
      registry.createProject({
        id: "22222222-2222-4222-8222-222222222222" as ProjectId,
        name: "good",
        rootPath: projectRoot,
        createdAt: TS,
        updatedAt: TS,
      });
      // Mismatched sentinels cause parseBlock to throw.
      await writeFile(
        join(badRoot, "CLAUDE.md"),
        "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->\n<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->\n",
        "utf8",
      );
      const ops = createMcpOps({ registry, home, command: "mega-mcp" });
      const result = await ops.status();
      expect(result.agents.find((a) => a.agentId === "claude-code")).toBeDefined();
    } finally {
      await rm(badRoot, { recursive: true, force: true });
    }
  });
});
