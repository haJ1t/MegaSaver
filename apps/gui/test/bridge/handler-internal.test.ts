import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type CoreRegistry, CoreRegistryError, createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";
import { PROJECT_A } from "./test-helpers.js";

// A thin wrapper registry that injects a thrown error on write paths only.
function makeFailingRegistry(): CoreRegistry {
  const inner = createInMemoryCoreRegistry();
  inner.createProject(PROJECT_A);
  return {
    ...inner,
    createSession: () => {
      // Mirror the CorePersistenceError shape — bridge maps these to store_write_failed.
      const err = new Error("EPERM: simulated disk failure");
      (err as NodeJS.ErrnoException).code = "EPERM";
      throw err;
    },
    createMemoryEntry: () => {
      throw new CoreRegistryError("memory_entry_already_exists", "simulated boom");
    },
  };
}

describe("createBridgeHandler — 500 store/internal failures", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const handler = createBridgeHandler({ registry: makeFailingRegistry() });
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns 500 with code=store_write_failed when the registry throws on create", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_A.id, agentId: "claude-code" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("store_write_failed");
  });

  it("preserves the BridgeErrorBody envelope shape on internal failure", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_A.id, agentId: "codex" }),
    });
    const body = (await res.json()) as { error: string; code: string; details?: unknown };
    expect(typeof body.error).toBe("string");
    expect(typeof body.code).toBe("string");
  });
});
