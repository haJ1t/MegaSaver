import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

// F5 task 2: the live-first bridge no longer owns a Core registry. The handler
// must construct (and serve) with no `registry` option at all.
describe("createBridgeHandler — no registry dependency", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const handler = createBridgeHandler({});
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves /api/health without a registry", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
