import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

type Harness = { baseUrl: string; close: () => Promise<void> };

async function startHandler(token?: string): Promise<Harness> {
  const handler = createBridgeHandler(token === undefined ? {} : { token });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("bridge token wall on /api", () => {
  let h: Harness;
  afterEach(async () => {
    if (h) await h.close();
  });

  it("allows /api with a correct Bearer token (reaches the route)", async () => {
    h = await startHandler("SECRET");
    const res = await fetch(`${h.baseUrl}/api/health`, {
      headers: { authorization: "Bearer SECRET" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects /api with no Authorization → 401 unauthorized", async () => {
    h = await startHandler("SECRET");
    const res = await fetch(`${h.baseUrl}/api/health`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unauthorized");
  });

  it("rejects /api with a wrong Bearer token → 401", async () => {
    h = await startHandler("SECRET");
    const res = await fetch(`${h.baseUrl}/api/health`, {
      headers: { authorization: "Bearer WRONG" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts ?token= for SSE routes that cannot set headers (not 401)", async () => {
    h = await startHandler("SECRET");
    const res = await fetch(`${h.baseUrl}/api/claude-sessions/dir/sess/stream?token=SECRET`);
    // Passes the wall → reaches the route (whatever status the route yields),
    // just never the 401 the wall would emit.
    expect(res.status).not.toBe(401);
    await res.body?.cancel();
  });

  it("rejects ?token= with the wrong value on an SSE route → 401", async () => {
    h = await startHandler("SECRET");
    const res = await fetch(`${h.baseUrl}/api/claude-sessions/dir/sess/stream?token=WRONG`);
    expect(res.status).toBe(401);
  });

  it("does NOT 401 when no token is configured (backward-compatible)", async () => {
    h = await startHandler(undefined);
    const res = await fetch(`${h.baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });
});
