import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

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

async function connect(projectRoot: string, store: string) {
  const { server } = buildServer({
    registry: seededRegistry(projectRoot),
    storeRoot: store,
    now: () => TS,
    newId: () => "cs-e2e",
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

describe("phase 4 tools over the bridge", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-p4-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p4-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function connectP4() {
    const { server } = buildServer({
      registry: seededRegistry(projectRoot),
      storeRoot: store,
      now: () => TS,
      newId: () => "e0000000-0000-4000-8000-000000000001",
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, server };
  }

  it("lists 18 tools (updated from 15 when Phase 5 FORGE tools were wired)", async () => {
    const { client, server } = await connect(projectRoot, store);
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(18);
    expect(tools.map((t) => t.name)).toContain("get_project_context");
    await server.close();
  });

  it("save_project_rule then get_project_rules round-trips", async () => {
    const { client, server } = await connectP4();
    await client.callTool({
      name: "save_project_rule",
      arguments: {
        projectId: PROJECT_ID,
        title: "Migrate first",
        rule: "Create a migration before regenerating.",
        severity: "warning",
        appliesTo: ["prisma/schema.prisma"],
      },
    });
    const res = (await client.callTool({
      name: "get_project_rules",
      arguments: { projectId: PROJECT_ID },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { rules: { title: string }[] };
    expect(payload.rules.map((r) => r.title)).toEqual(["Migrate first"]);
    await server.close();
  });

  it("record_failed_attempt surfaces in get_project_context openFailures", async () => {
    const { client, server } = await connectP4();
    await client.callTool({
      name: "record_failed_attempt",
      arguments: { projectId: PROJECT_ID, task: "schema change", failedStep: "regen client" },
    });
    const res = (await client.callTool({
      name: "get_project_context",
      arguments: { projectId: PROJECT_ID },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      openFailures: unknown[];
      indexSummary: { totalBlocks: number };
    };
    expect(payload.openFailures).toHaveLength(1);
    expect(payload.indexSummary.totalBlocks).toBe(0);
    await server.close();
  });
});

describe("phase 5 FORGE tools over the bridge", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-p5-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p5-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function connectP5() {
    const { server } = buildServer({
      registry: seededRegistry(projectRoot),
      storeRoot: store,
      now: () => TS,
      newId: () => "e0000000-0000-4000-8000-000000000001",
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, server };
  }

  it("lists 18 tools", async () => {
    const { client, server } = await connect(projectRoot, store);
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(18);
    expect(tools.map((t) => t.name)).toContain("convert_failure_to_rule");
    await server.close();
  });

  it("record -> find_similar -> convert -> get_applicable round-trips", async () => {
    const { client, server } = await connectP5();
    await client.callTool({
      name: "record_failed_attempt",
      arguments: { projectId: PROJECT_ID, task: "fix login auth bug", failedStep: "run auth tests", relatedFiles: ["src/auth.ts"] },
    });
    const sim = (await client.callTool({
      name: "find_similar_failures",
      arguments: { projectId: PROJECT_ID, task: "login auth" },
    })) as { content: { text: string }[] };
    const simPayload = JSON.parse(sim.content[0]?.text ?? "{}") as { failures: { id: string }[] };
    expect(simPayload.failures).toHaveLength(1);

    await client.callTool({
      name: "convert_failure_to_rule",
      arguments: { failureId: "e0000000-0000-4000-8000-000000000001", title: "Guard auth", rule: "check expiry with <=", severity: "warning" },
    });
    const applic = (await client.callTool({
      name: "get_applicable_rules",
      arguments: { projectId: PROJECT_ID, files: ["src/auth.ts"] },
    })) as { content: { text: string }[] };
    const applicPayload = JSON.parse(applic.content[0]?.text ?? "{}") as { rules: unknown[] };
    expect(applicPayload.rules).toHaveLength(1);
    await server.close();
  });
});

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

  it("mega_run_command (allowed) returns a filtered response", async () => {
    const { client, server } = await connect(projectRoot, store);
    const res = (await client.callTool({
      name: "mega_run_command",
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
        name: "mega_run_command",
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
