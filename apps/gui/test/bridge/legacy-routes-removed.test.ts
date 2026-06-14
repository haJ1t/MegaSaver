import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const SOME_ID = "11111111-1111-4111-8111-111111111111";

// F5: the legacy project-scoped surface is gone from the GUI bridge. Every
// removed path must now fall through to the generic 404 (route_not_found);
// the live surface (claude-sessions, workspaces, health, mcp) stays.
describe("F5 — legacy project routes removed", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestBridge();
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  const removedPaths: { method: string; path: string }[] = [
    { method: "GET", path: "/api/projects" },
    { method: "POST", path: "/api/projects" },
    { method: "GET", path: `/api/projects/${SOME_ID}/audit` },
    { method: "GET", path: `/api/projects/${SOME_ID}/rules` },
    { method: "GET", path: `/api/projects/${SOME_ID}/context?task=x` },
    { method: "GET", path: `/api/projects/${SOME_ID}/tasks` },
    { method: "GET", path: `/api/projects/${SOME_ID}/tools` },
    { method: "GET", path: `/api/projects/${SOME_ID}/index` },
    { method: "GET", path: `/api/projects/${SOME_ID}/index/search?q=x` },
    { method: "GET", path: "/api/sessions" },
    { method: "POST", path: "/api/sessions" },
    { method: "PATCH", path: `/api/sessions/${SOME_ID}` },
    { method: "POST", path: `/api/sessions/${SOME_ID}/end` },
    { method: "POST", path: `/api/sessions/${SOME_ID}/token-saver/enable` },
    { method: "GET", path: `/api/sessions/${SOME_ID}/token-saver/status` },
    { method: "GET", path: `/api/sessions/${SOME_ID}/retention` },
    { method: "GET", path: "/api/memory" },
    { method: "POST", path: "/api/memory" },
    { method: "PATCH", path: `/api/memory/${SOME_ID}` },
    { method: "DELETE", path: `/api/memory/${SOME_ID}` },
  ];

  for (const { method, path } of removedPaths) {
    it(`${method} ${path} → 404 route_not_found`, async () => {
      const res = await fetch(`${server.baseUrl}${path}`, { method });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { code: string }).code).toBe("route_not_found");
    });
  }

  it("live GET /api/health still works", async () => {
    const res = await fetch(`${server.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("live GET /api/claude-sessions still works", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions`);
    expect(res.status).toBe(200);
  });

  it("live GET /api/workspaces still works", async () => {
    const res = await fetch(`${server.baseUrl}/api/workspaces`);
    expect(res.status).toBe(200);
  });
});
