import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { McpSetupOps, McpStatusResult } from "@megasaver/mcp-bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

const STATUS: McpStatusResult = {
  agents: [
    {
      agentId: "claude-code",
      mcpInstalled: false,
      connectorSynced: false,
      restartRequired: false,
      restartHint: "Restart Claude Code to load the Mega Saver MCP server.",
    },
  ],
};
const INSTALLED: McpStatusResult = {
  agents: [
    {
      ...(STATUS.agents[0] as McpStatusResult["agents"][number]),
      mcpInstalled: true,
      connectorSynced: true,
      restartRequired: true,
    },
  ],
};

function makeOps(): McpSetupOps {
  return {
    status: vi.fn(async () => STATUS),
    install: vi.fn(async () => INSTALLED),
    repair: vi.fn(async () => INSTALLED),
    uninstall: vi.fn(async () => STATUS),
  };
}

type TestServer = { baseUrl: string; ops: McpSetupOps; close(): Promise<void> };

async function startBridge(ops: McpSetupOps): Promise<TestServer> {
  const registry = createInMemoryCoreRegistry();
  const handler = createBridgeHandler({ registry, mcpOps: ops });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    ops,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("mcp-setup bridge routes", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startBridge(makeOps());
  });
  afterEach(async () => {
    if (server) await server.close();
  });

  it("GET /api/mcp/status returns the agents snapshot", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpStatusResult;
    expect(body.agents[0]?.agentId).toBe("claude-code");
    expect(server.ops.status).toHaveBeenCalledOnce();
  });

  it("POST /api/mcp/install passes target + project and returns the post-op snapshot", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "claude-code", project: "demo" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpStatusResult;
    expect(body.agents[0]?.mcpInstalled).toBe(true);
    expect(server.ops.install).toHaveBeenCalledWith("claude-code", "demo");
  });

  it("POST /api/mcp/repair passes target + project", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "cursor", project: "demo" }),
    });
    expect(res.status).toBe(200);
    expect(server.ops.repair).toHaveBeenCalledWith("cursor", "demo");
  });

  it("POST /api/mcp/uninstall passes target only", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/uninstall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "aider" }),
    });
    expect(res.status).toBe(200);
    expect(server.ops.uninstall).toHaveBeenCalledWith("aider");
  });

  it("rejects an unknown target with 400 validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "nonexistent", project: "demo" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("maps a setup-op throw to 500 mcp_setup_failed", async () => {
    const ops = makeOps();
    ops.install = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    await server.close();
    server = await startBridge(ops);
    const res = await fetch(`${server.baseUrl}/api/mcp/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "claude-code", project: "demo" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("mcp_setup_failed");
  });

  it("returns 405 for GET on a POST-only route", async () => {
    const res = await fetch(`${server.baseUrl}/api/mcp/install`);
    expect(res.status).toBe(405);
  });
});
