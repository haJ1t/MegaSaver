import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_A, type TestServer, startTestBridge } from "./test-helpers.js";

const UNKNOWN_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const UNKNOWN_SESSION_ID = "88888888-8888-4888-8888-888888888888";

describe("createBridgeHandler — 404 not-found paths", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestBridge({ projects: [PROJECT_A] });
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it("GET /api/sessions?projectId=<unknown> → 404 + code=project_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions?projectId=${UNKNOWN_PROJECT_ID}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("project_not_found");
  });

  it("GET /api/memory?projectId=<unknown> → 404 + code=project_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/memory?projectId=${UNKNOWN_PROJECT_ID}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("project_not_found");
  });

  it("POST /api/sessions with unknown projectId → 404 + code=project_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: UNKNOWN_PROJECT_ID, agentId: "claude-code" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("project_not_found");
  });

  it("POST /api/sessions/:id/end with unknown id → 404 + code=session_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/${UNKNOWN_SESSION_ID}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_not_found");
  });

  it("PATCH /api/sessions/:id with unknown id → 404 + code=session_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/${UNKNOWN_SESSION_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_not_found");
  });

  it("POST /api/memory with unknown projectId → 404 + code=project_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: UNKNOWN_PROJECT_ID,
        content: "x",
        scope: "project",
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("project_not_found");
  });

  it("GET on an unknown route → 404 + code=route_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/no-such-thing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("route_not_found");
  });
});
