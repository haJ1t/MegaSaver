import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
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
      id: PROJECT_ID,
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
    expect(raw.mcpServers.megasaver).toBeDefined();
  });
});
