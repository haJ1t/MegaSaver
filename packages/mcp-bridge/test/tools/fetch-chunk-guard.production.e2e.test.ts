import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridge } from "../../src/bridge.js";

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

// Exercises the PRODUCTION constructor (createBridge → buildServer) with no
// hand-populated allowedChunkSetIds. A chunkSet returned by a real
// proxy_run_command must be expandable; a fabricated id never returned must be
// blocked (contextgate-honest-90 §11 — no arbitrary chunk browsing).
describe("createBridge expansion guard — production path", () => {
  let store: string;
  let projectRoot: string;
  let priorNaming: string | undefined;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-prod-guard-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-prod-guard-root-"));
    priorNaming = process.env.MEGASAVER_TOOL_NAMING;
    process.env.MEGASAVER_TOOL_NAMING = "proxy";
  });
  afterEach(async () => {
    if (priorNaming === undefined) {
      // biome-ignore lint/performance/noDelete: test restores the original env key
      delete process.env.MEGASAVER_TOOL_NAMING;
    } else {
      process.env.MEGASAVER_TOOL_NAMING = priorNaming;
    }
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("expands a chunkSet that proxy_run_command returned, blocks a fabricated id", async () => {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const bridge = createBridge({
      transport: "stdio",
      storeRoot: store,
      registry: seededRegistry(projectRoot),
      now: () => TS,
      // Pass the in-memory server transport in place of stdio; the bridge
      // connects whatever transportFactory yields.
      transportFactory: () => serverT as unknown as StdioServerTransport,
    });
    await bridge.start();

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientT);

    // A real allow-listed command through the production pipeline produces a
    // stored chunk set the agent may expand.
    const runRes = (await client.callTool({
      name: "proxy_run_command",
      arguments: { command: "ls", args: ["-a"], intent: "see output", sessionId: SESSION_ID },
    })) as { content: { text: string }[] };
    const runPayload = JSON.parse(runRes.content[0]?.text ?? "{}") as { chunkSetId?: string };
    const returnedId = runPayload.chunkSetId;
    expect(returnedId).toBeTypeOf("string");

    // The returned chunkSet IS expandable.
    const okRes = (await client.callTool({
      name: "proxy_expand_chunk",
      arguments: { chunkSetId: returnedId, chunkId: "0" },
    })) as { content: { text: string }[] };
    const okPayload = JSON.parse(okRes.content[0]?.text ?? "{}") as { chunkSetId?: string };
    expect(okPayload.chunkSetId).toBe(returnedId);

    // A fabricated chunkSetId never returned this session is BLOCKED.
    await expect(
      client.callTool({
        name: "proxy_expand_chunk",
        arguments: { chunkSetId: "cs-never-returned", chunkId: "0" },
      }),
    ).rejects.toThrow(/expansion_blocked/);

    await bridge.stop();
  });
});
