import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMORY_PROJECT_ENTRY,
  PROJECT_A,
  PROJECT_B,
  SESSION_A_ENDED,
  SESSION_A_OPEN,
  type TestServer,
  startTestBridge,
} from "./test-helpers.js";

describe("createBridgeHandler — happy paths", () => {
  let server: TestServer;

  afterEach(async () => {
    if (server) await server.close();
  });

  describe("GET /api/health", () => {
    beforeEach(async () => {
      server = await startTestBridge();
    });

    it("returns 200 with { ok: true } and a store path", async () => {
      const res = await fetch(`${server.baseUrl}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  describe("GET /api/projects", () => {
    it("returns an empty array when no projects exist", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/projects`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("returns projects sorted by createdAt ascending", async () => {
      server = await startTestBridge({ projects: [PROJECT_B, PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/projects`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; createdAt: string }[];
      expect(body.map((p) => p.id)).toEqual([PROJECT_A.id, PROJECT_B.id]);
    });
  });

  describe("GET /api/sessions", () => {
    beforeEach(async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        sessions: [SESSION_A_OPEN, SESSION_A_ENDED],
      });
    });

    it("returns all sessions when no projectId filter is given", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string }[];
      expect(body.map((s) => s.id).sort()).toEqual([SESSION_A_OPEN.id, SESSION_A_ENDED.id].sort());
    });

    it("filters by projectId and sorts startedAt descending", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions?projectId=${PROJECT_A.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; startedAt: string }[];
      // Newest first: SESSION_A_OPEN (11:00) before SESSION_A_ENDED (10:00).
      expect(body[0]?.id).toBe(SESSION_A_OPEN.id);
      expect(body[1]?.id).toBe(SESSION_A_ENDED.id);
    });
  });

  describe("GET /api/memory", () => {
    beforeEach(async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        memoryEntries: [MEMORY_PROJECT_ENTRY],
      });
    });

    it("filters by projectId and returns the matching memory entries", async () => {
      const res = await fetch(`${server.baseUrl}/api/memory?projectId=${PROJECT_A.id}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string }[];
      expect(body.map((e) => e.id)).toEqual([MEMORY_PROJECT_ENTRY.id]);
    });
  });

  describe("POST /api/sessions", () => {
    beforeEach(async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
    });

    it("creates a session and returns 201 with the created body", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_A.id,
          agentId: "claude-code",
          title: "freshly created",
          riskLevel: "medium",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        id: string;
        projectId: string;
        title: string | null;
        endedAt: string | null;
      };
      expect(body.projectId).toBe(PROJECT_A.id);
      expect(body.title).toBe("freshly created");
      expect(body.endedAt).toBeNull();
    });

    it("defaults riskLevel to 'medium' when omitted", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: PROJECT_A.id, agentId: "claude-code" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { riskLevel: string };
      expect(body.riskLevel).toBe("medium");
    });
  });

  describe("POST /api/sessions/:id/end", () => {
    beforeEach(async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        sessions: [SESSION_A_OPEN],
      });
    });

    it("returns 200 with the ended session", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; endedAt: string | null };
      expect(body.id).toBe(SESSION_A_OPEN.id);
      expect(body.endedAt).not.toBeNull();
    });
  });

  describe("PATCH /api/sessions/:id", () => {
    beforeEach(async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        sessions: [SESSION_A_OPEN],
      });
    });

    it("updates the title and returns 200 with the patched session", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "renamed" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { title: string | null };
      expect(body.title).toBe("renamed");
    });

    it("clears the title when patch carries title=null", async () => {
      const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_A_OPEN.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: null }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { title: string | null };
      expect(body.title).toBeNull();
    });
  });

  describe("POST /api/memory", () => {
    beforeEach(async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        sessions: [SESSION_A_OPEN],
      });
    });

    it("creates a project-scoped memory entry and returns 201", async () => {
      const res = await fetch(`${server.baseUrl}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_A.id,
          content: "project note",
          scope: "project",
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        scope: string;
        sessionId: string | null;
        content: string;
      };
      expect(body.scope).toBe("project");
      expect(body.sessionId).toBeNull();
      expect(body.content).toBe("project note");
    });

    it("creates a session-scoped memory entry linked to the session and returns 201", async () => {
      const res = await fetch(`${server.baseUrl}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_A.id,
          content: "session note",
          scope: "session",
          sessionId: SESSION_A_OPEN.id,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        scope: string;
        sessionId: string | null;
      };
      expect(body.scope).toBe("session");
      expect(body.sessionId).toBe(SESSION_A_OPEN.id);
    });
  });
});
