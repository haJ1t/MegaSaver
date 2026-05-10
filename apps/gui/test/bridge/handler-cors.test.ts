import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_A, type TestServer, startTestBridge } from "./test-helpers.js";

describe("createBridgeHandler — CORS posture (spec §4c)", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestBridge({ projects: [PROJECT_A] });
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it("accepts a request with no Origin header (server-to-server / curl)", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    expect(res.status).toBe(200);
  });

  it("accepts a request from http://localhost:5173 and echoes that origin", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("accepts a request from http://127.0.0.1:5173", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
  });

  it("rejects a request from a non-loopback origin → 403 origin_forbidden", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: "http://evil.example.com" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("origin_forbidden");
  });

  it("never emits Access-Control-Allow-Origin: * (no wildcard)", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("handles OPTIONS preflight for POST and responds with the matched origin", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
