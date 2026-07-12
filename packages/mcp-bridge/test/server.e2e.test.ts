import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ToolDefinitionInput,
  appendAuditEvent,
  createInMemoryCoreRegistry,
} from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { NamingMode } from "../src/tool-naming.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
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

  it("record -> find_similar -> convert -> get_applicable round-trips", async () => {
    const { client, server } = await connectP5();
    await client.callTool({
      name: "record_failed_attempt",
      arguments: {
        projectId: PROJECT_ID,
        task: "fix login auth bug",
        failedStep: "run auth tests",
        relatedFiles: ["src/auth.ts"],
      },
    });
    const sim = (await client.callTool({
      name: "find_similar_failures",
      arguments: { projectId: PROJECT_ID, task: "login auth" },
    })) as { content: { text: string }[] };
    const simPayload = JSON.parse(sim.content[0]?.text ?? "{}") as { failures: { id: string }[] };
    expect(simPayload.failures).toHaveLength(1);

    await client.callTool({
      name: "convert_failure_to_rule",
      arguments: {
        failureId: "e0000000-0000-4000-8000-000000000001",
        title: "Guard auth",
        rule: "check expiry with <=",
        severity: "warning",
      },
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
        "approve_memory",
        "audit_token_usage",
        "build_task_plan",
        "convert_failure_to_rule",
        "explain_context_selection",
        "find_similar_failures",
        "get_applicable_rules",
        "get_context_budget_report",
        "get_edit_impact",
        "get_project_context",
        "get_project_rules",
        "get_relevant_code_blocks",
        "get_relevant_context",
        "get_relevant_memories",
        "get_task_context",
        "get_task_status",
        "get_warm_start_brief",
        "mega_impact",
        "mega_index_memory",
        "mega_memory_from_session",
        "mega_memory_sweep",
        "mega_recall",
        "proxy_expand_chunk",
        "proxy_read_file",
        "proxy_run_command",
        "proxy_search_code",
        "record_failed_attempt",
        "record_task_step",
        "retry_failed_step",
        "route_tools_for_task",
        "save_memory",
        "save_project_rule",
        "search_memory",
      ].sort(),
    );
    // Exactly one name per tool: no tool is exposed under both its mega_*
    // and proxy_* names simultaneously.
    expect(new Set(names).size).toBe(names.length);
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
        "approve_memory",
        "audit_token_usage",
        "build_task_plan",
        "convert_failure_to_rule",
        "explain_context_selection",
        "find_similar_failures",
        "get_applicable_rules",
        "get_context_budget_report",
        "get_edit_impact",
        "get_project_context",
        "get_project_rules",
        "get_relevant_code_blocks",
        "get_relevant_context",
        "get_relevant_memories",
        "get_task_context",
        "get_task_status",
        "get_warm_start_brief",
        "mega_fetch_chunk",
        "mega_impact",
        "mega_index_memory",
        "mega_memory_from_session",
        "mega_memory_sweep",
        "mega_read_file",
        "mega_recall",
        "mega_run_command",
        "proxy_search_code",
        "record_failed_attempt",
        "record_task_step",
        "retry_failed_step",
        "route_tools_for_task",
        "save_memory",
        "save_project_rule",
        "search_memory",
      ].sort(),
    );
    // Exactly one name per tool: no duplicates across the legacy set.
    expect(new Set(names).size).toBe(names.length);
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

describe("phase 6 task tools over the bridge", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-e2e-p6-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p6-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  // Deterministic id sequence: plan, stepA, stepB, then any later mint.
  function connectP6() {
    let i = 0;
    const ids = [
      "d0000000-0000-4000-8000-000000000001",
      "d0000000-0000-4000-8000-00000000000a",
      "d0000000-0000-4000-8000-00000000000b",
    ];
    const { server } = buildServer({
      registry: seededRegistry(projectRoot),
      storeRoot: store,
      now: () => TS,
      newId: () => ids[i++] ?? `e${i}`,
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    return Promise.all([server.connect(serverT), client.connect(clientT)]).then(() => ({
      client,
      server,
    }));
  }

  it("build -> record(failed) -> retry -> record(completed) -> status round-trips", async () => {
    const { client, server } = await connectP6();
    const PLAN = "d0000000-0000-4000-8000-000000000001";
    const A = "d0000000-0000-4000-8000-00000000000a";
    const B = "d0000000-0000-4000-8000-00000000000b";

    await client.callTool({
      name: "build_task_plan",
      arguments: {
        projectId: PROJECT_ID,
        task: "fix login",
        steps: [
          { type: "edit", title: "edit auth", key: "a" },
          { type: "debug", title: "debug auth", key: "b", dependsOnKeys: ["a"] },
        ],
      },
    });
    await client.callTool({
      name: "record_task_step",
      arguments: { planId: PLAN, stepId: A, status: "failed", error: "401" },
    });
    await client.callTool({ name: "retry_failed_step", arguments: { planId: PLAN, stepId: A } });
    await client.callTool({
      name: "record_task_step",
      arguments: { planId: PLAN, stepId: A, status: "completed", output: "fixed" },
    });
    const statusRes = (await client.callTool({
      name: "get_task_status",
      arguments: { planId: PLAN },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(statusRes.content[0]?.text ?? "{}") as {
      plan: { status: string; steps: { id: string; status: string }[] };
      ready: string[];
    };
    // a completed, b pending with deps met -> plan "planned", b is ready
    expect(payload.plan.steps.find((s) => s.id === A)?.status).toBe("completed");
    expect(payload.ready).toEqual([B]);
    await server.close();
  });
});

describe("phase 7 tool router over the bridge", () => {
  const TS7 = "2026-06-12T00:00:00.000Z";
  const AUDIT_SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
  let storeRoot: string;

  beforeEach(async () => {
    storeRoot = await mkdtemp(join(tmpdir(), "mcp-e2e-p7-store-"));
  });
  afterEach(async () => {
    await rm(storeRoot, { recursive: true, force: true });
  });

  async function connectWithTools() {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS7,
      updatedAt: TS7,
    });
    const clock = (id: string) => ({ now: () => TS7, newId: () => id });
    registry.createToolDefinition(
      PROJECT_ID,
      {
        name: "grep",
        description: "search files",
        category: "search",
        risk: "safe",
        keywords: ["search"],
      } as ToolDefinitionInput,
      clock("e0000000-0000-4000-8000-000000000001"),
    );
    registry.createToolDefinition(
      PROJECT_ID,
      {
        name: "ship",
        description: "deploy to production",
        category: "deploy",
        risk: "dangerous",
        keywords: ["deploy"],
      } as ToolDefinitionInput,
      clock("e0000000-0000-4000-8000-000000000002"),
    );
    const { server } = buildServer({
      registry,
      storeRoot,
      now: () => TS7,
      newId: () => "x",
    });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    return { client, server };
  }

  it("lists 33 tools", async () => {
    const { client, server } = await connectWithTools();
    const { tools } = (await client.listTools()) as { tools: { name: string }[] };
    expect(tools).toHaveLength(33);
    expect(tools.map((t) => t.name)).toContain("approve_memory");
    expect(tools.map((t) => t.name)).toContain("audit_token_usage");
    expect(tools.map((t) => t.name)).toContain("proxy_search_code");
    expect(tools.map((t) => t.name)).toContain("mega_index_memory");
    expect(tools.map((t) => t.name)).toContain("mega_memory_sweep");
    expect(tools.map((t) => t.name)).toContain("mega_memory_from_session");
    await server.close();
  });

  it("audit_token_usage summarizes recorded savings", async () => {
    const { client, server } = await connectWithTools();
    appendAuditEvent({
      store: { root: storeRoot },
      event: {
        id: "a1",
        sessionId: AUDIT_SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: "2026-06-12T12:00:00.000Z",
        kind: "context_pack_built",
        filesConsidered: 5,
        filesIncluded: 2,
        filesExcluded: 3,
        blocksConsidered: 8,
        blocksIncluded: 3,
        blocksExcluded: 5,
        tokensBefore: 7000,
        tokensAfter: 2300,
      },
    });
    const res = (await client.callTool({
      name: "audit_token_usage",
      arguments: { projectId: PROJECT_ID, sessionId: AUDIT_SESSION_ID, window: "session" },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      tokensBefore: number;
      tokensAfter: number;
      percentageSaved: number;
    };
    expect(payload.tokensBefore).toBe(7000);
    expect(payload.tokensAfter).toBe(2300);
    expect(payload.percentageSaved).toBe(67);
    await server.close();
  });

  it("route_tools_for_task blocks a dangerous deploy tool", async () => {
    const { client, server } = await connectWithTools();
    const res = (await client.callTool({
      name: "route_tools_for_task",
      arguments: { projectId: PROJECT_ID, task: "search files" },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as {
      allowedTools: { name: string }[];
      blockedTools: { name: string }[];
    };
    expect(payload.allowedTools.map((t) => t.name)).toEqual(["grep"]);
    expect(payload.blockedTools.map((t) => t.name)).toEqual(["ship"]);
    await server.close();
  });
});
