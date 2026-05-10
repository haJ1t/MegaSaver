import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_A,
  PROJECT_B,
  SESSION_A_ENDED,
  SESSION_A_OPEN,
  type TestServer,
  startTestBridge,
} from "./test-helpers.js";

describe("createBridgeHandler — 409 conflicts", () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestBridge({
      projects: [PROJECT_A, PROJECT_B],
      sessions: [SESSION_A_OPEN, SESSION_A_ENDED],
    });
  });

  afterEach(async () => {
    if (server) await server.close();
  });

  it("POST /api/sessions/:id/end on an already-ended session → 409 + session_already_ended", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_ENDED.id}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_already_ended");
  });

  it("end-then-end the same session twice → second call returns 409 session_already_ended", async () => {
    const first = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { code: string };
    expect(body.code).toBe("session_already_ended");
  });

  it("PATCH on an already-ended session → 409 session_already_ended", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_ENDED.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "too late" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_already_ended");
  });

  it("POST /api/memory scope=session linking an ENDED session → 409 session_already_ended", async () => {
    const res = await fetch(`${server.baseUrl}/api/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_A.id,
        content: "note",
        scope: "session",
        sessionId: SESSION_A_ENDED.id,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_already_ended");
  });

  it("POST /api/memory scope=session linking a session in a DIFFERENT project → 409 session_project_mismatch", async () => {
    const res = await fetch(`${server.baseUrl}/api/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_B.id,
        content: "note",
        scope: "session",
        sessionId: SESSION_A_OPEN.id,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_project_mismatch");
  });
});
