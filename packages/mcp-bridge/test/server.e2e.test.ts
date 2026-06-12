import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
      [
        "mega_recall",
        "proxy_expand_chunk",
        "proxy_read_file",
        "proxy_run_command",
        "proxy_search_code",
      ].sort(),
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
      [
        "mega_fetch_chunk",
        "mega_read_file",
        "mega_recall",
        "mega_run_command",
        "proxy_search_code",
      ].sort(),
    );
    // proxy_search_code is a NEW v1.2 tool with no mega_* twin; it keeps its
    // proxy_* name in legacy mode too (the renamed mega_* tools do not appear).
    expect(names).not.toContain("proxy_read_file");
    expect(names).not.toContain("proxy_run_command");
    expect(names).not.toContain("proxy_expand_chunk");
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

  it("proxy_search_code is listed once in both modes (new tool, no mega_* twin)", async () => {
    const proxy = await connect(projectRoot, store, "proxy");
    const proxyNames = (await proxy.client.listTools()).tools.map((t) => t.name);
    expect(proxyNames.filter((n) => n === "proxy_search_code")).toHaveLength(1);
    await proxy.server.close();

    const legacy = await connect(projectRoot, store, "legacy");
    const legacyNames = (await legacy.client.listTools()).tools.map((t) => t.name);
    expect(legacyNames.filter((n) => n === "proxy_search_code")).toHaveLength(1);
    await legacy.server.close();
  });
});

describe("proxy_search_code end-to-end (spec §9.5)", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-search-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-search-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("groups matches by file and returns chunkSetId + index_enrichment", async () => {
    await writeFile(join(projectRoot, "a.ts"), "const needle = 1;\nconst other = 2;\n");
    await writeFile(join(projectRoot, "b.ts"), "import { needle } from './a';\n");
    const { client, server } = await connect(projectRoot, store, "proxy");
    const res = (await client.callTool({
      name: "proxy_search_code",
      arguments: { query: "needle", sessionId: SESSION_ID, path_scope: "." },
    })) as { content: { type: string; text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      chunkSetId?: string;
      index_enrichment?: string;
      files?: { path: string; matches: unknown[] }[];
    };
    expect(payload.chunkSetId).toBeDefined();
    expect(payload.index_enrichment).toBeDefined();
    const paths = (payload.files ?? []).map((f) => f.path).sort();
    expect(paths).toContain("./a.ts");
    expect(paths).toContain("./b.ts");
    await server.close();
  });
});
