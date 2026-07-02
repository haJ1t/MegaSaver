import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-07-02T00:00:00.000Z";

describe("GET /api/projects", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID as ProjectId,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    const handler = createBridgeHandler({ registry });
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns the persisted project list", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string; rootPath: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo" });
  });

  it("returns an empty list when no registry is provided", async () => {
    const handler = createBridgeHandler({});
    const s = createServer(handler);
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${url}/api/projects`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it("returns 405 for non-GET methods", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
