import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

// F5: the live-first bridge boots with no Core registry. This smoke test
// confirms the surviving surface (health + the live claude-sessions /
// workspaces / projects listings) serves in-process.
describe("Bridge in-process smoke test", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const handler = createBridgeHandler({});
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/health → 200 with { ok: true }", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /api/claude-sessions → 200", async () => {
    const res = await fetch(`${baseUrl}/api/claude-sessions`);
    expect(res.status).toBe(200);
  });

  it("GET /api/workspaces → 200", async () => {
    const res = await fetch(`${baseUrl}/api/workspaces`);
    expect(res.status).toBe(200);
  });

  it("GET /api/projects → 200 empty list when no registry is injected", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown[]).toEqual([]);
  });
});
