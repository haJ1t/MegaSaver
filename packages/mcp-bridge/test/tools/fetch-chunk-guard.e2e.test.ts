import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

async function seedChunkSet(store: string, chunkSetId: string): Promise<void> {
  const dir = join(store, "content", PROJECT_ID, SESSION_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${chunkSetId}.json`),
    JSON.stringify({
      chunkSetId,
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: TS,
      source: { kind: "file", path: "log.txt" },
      rawBytes: 10,
      redacted: true,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
    }),
  );
}

function buildConnectedServer(store: string, allowedChunkSetIds?: ReadonlySet<string>) {
  const registry = createInMemoryCoreRegistry();
  const serverDeps = {
    registry,
    storeRoot: store,
    now: () => TS,
    // Use legacy naming so tests call tools by their internal id (mega_fetch_chunk).
    // Proxy mode maps mega_fetch_chunk → proxy_expand_chunk; either works here.
    toolNaming: "legacy" as const,
    ...(allowedChunkSetIds !== undefined ? { allowedChunkSetIds } : {}),
  };
  const { server } = buildServer(serverDeps);
  return server;
}

describe("mega_fetch_chunk dispatch: allowedChunkSetIds guard", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-guard-e2e-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("allows chunkSet present in allowed set", async () => {
    await seedChunkSet(store, "cs-allowed");
    const server = buildConnectedServer(store, new Set(["cs-allowed"]));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const res = (await client.callTool({
      name: "mega_fetch_chunk",
      arguments: { chunkSetId: "cs-allowed", chunkId: "0" },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { chunkSetId: string };
    expect(payload.chunkSetId).toBe("cs-allowed");
    await server.close();
  });

  it("blocks chunkSet not in current allowed set", async () => {
    await seedChunkSet(store, "cs-blocked");
    const server = buildConnectedServer(store, new Set(["cs-other"]));
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    await expect(
      client.callTool({ name: "mega_fetch_chunk", arguments: { chunkSetId: "cs-blocked", chunkId: "0" } }),
    ).rejects.toThrow(/expansion_blocked/);
    await server.close();
  });

  it("allows chunk when allowedChunkSetIds is absent (unconstrained/legacy)", async () => {
    await seedChunkSet(store, "cs-legacy");
    const server = buildConnectedServer(store); // no allowedChunkSetIds
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const res = (await client.callTool({
      name: "mega_fetch_chunk",
      arguments: { chunkSetId: "cs-legacy", chunkId: "0" },
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0]?.text ?? "{}") as { chunkSetId: string };
    expect(payload.chunkSetId).toBe("cs-legacy");
    await server.close();
  });
});
