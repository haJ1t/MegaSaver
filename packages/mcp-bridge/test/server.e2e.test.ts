import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { NamingMode } from "../src/tool-naming.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

async function connect(projectRoot: string, store: string, toolNaming: NamingMode = "proxy") {
  const { server } = buildServer({
    registry: seededRegistry(projectRoot),
    storeRoot: store,
    now: () => TS,
    newId: () => "cs-e2e",
    toolNaming,
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

describe("bridge stdio round-trip (AA1 §14 BB8 acceptance)", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("proxy_run_command (allowed) returns a filtered response", async () => {
    const { client, server } = await connect(projectRoot, store);
    const res = (await client.callTool({
      name: "proxy_run_command",
      arguments: { command: "ls", args: ["-a"], intent: "list files", sessionId: SESSION_ID },
    })) as { content: { type: string; text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { chunkSetId?: string };
    expect(payload.chunkSetId).toBeDefined();
    await server.close();
  });

  it("policy-denied command surfaces command_denied", async () => {
    const { client, server } = await connect(projectRoot, store);
    await expect(
      client.callTool({
        name: "proxy_run_command",
        arguments: { command: "rm", args: ["-rf", "/"], intent: "x", sessionId: SESSION_ID },
      }),
    ).rejects.toThrow(/command_denied/);
    await server.close();
  });

  it("unknown tool returns tool_not_found", async () => {
    const { client, server } = await connect(projectRoot, store);
    await expect(
      client.callTool({ name: "mega_delete_everything", arguments: {} }),
    ).rejects.toThrow(/tool_not_found/);
    await server.close();
  });
});

describe("tool naming mode (Proxy Mode v1.2 §5)", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-naming-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-naming-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("proxy mode lists proxy_* names and no renamed mega_* names", async () => {
    const { client, server } = await connect(projectRoot, store, "proxy");
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["mega_recall", "proxy_expand_chunk", "proxy_read_file", "proxy_run_command"].sort(),
    );
    expect(names).not.toContain("mega_read_file");
    expect(names).not.toContain("mega_run_command");
    expect(names).not.toContain("mega_fetch_chunk");
    await server.close();
  });

  it("legacy mode lists mega_* names and no proxy_* names", async () => {
    const { client, server } = await connect(projectRoot, store, "legacy");
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["mega_fetch_chunk", "mega_read_file", "mega_recall", "mega_run_command"].sort(),
    );
    expect(names.some((n) => n.startsWith("proxy_"))).toBe(false);
    await server.close();
  });

  it("proxy mode rejects a renamed legacy name with tool_not_found", async () => {
    const { client, server } = await connect(projectRoot, store, "proxy");
    await expect(
      client.callTool({
        name: "mega_run_command",
        arguments: { command: "ls", args: [], intent: "x", sessionId: SESSION_ID },
      }),
    ).rejects.toThrow(/tool_not_found/);
    await server.close();
  });

  it("legacy mode dispatches the mega_* name", async () => {
    const { client, server } = await connect(projectRoot, store, "legacy");
    const res = (await client.callTool({
      name: "mega_run_command",
      arguments: { command: "ls", args: ["-a"], intent: "list files", sessionId: SESSION_ID },
    })) as { content: { type: string; text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { chunkSetId?: string };
    expect(payload.chunkSetId).toBeDefined();
    await server.close();
  });
});
