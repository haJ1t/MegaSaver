import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROJECT_A, SESSION_A_OPEN, type TestServer, startTestBridge } from "./test-helpers.js";

describe("createBridgeHandler — Zod validation failures", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestBridge({
      projects: [PROJECT_A],
      sessions: [SESSION_A_OPEN],
    });
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it("POST /api/sessions with missing agentId → 400 + code=validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_A.id }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string; details?: unknown };
    expect(body.code).toBe("validation_failed");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("POST /api/sessions with invalid agent enum → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_A.id, agentId: "bogus-agent" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("POST /api/sessions with malformed projectId (not a uuid) → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "not-a-uuid", agentId: "claude-code" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("PATCH /api/sessions/:id with empty patch → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("PATCH /api/sessions/:id with invalid risk enum → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ riskLevel: "bogus" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("POST /api/memory with scope=session and no sessionId → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_A.id,
        content: "x",
        scope: "session",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("GET /api/sessions?projectId=not-a-uuid → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions?projectId=not-a-uuid`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("POST /api/sessions with empty title string → 400 + validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_A.id,
        agentId: "claude-code",
        title: "",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });
});
