// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assignTask,
  controlAgent,
  createAgent,
  createRole,
  deleteAgent,
  deleteRole,
  fetchAgents,
  fetchAudit,
  fetchOfficeStatus,
  fetchRoles,
  fetchTasks,
  runAgent,
} from "../../../src/lib/office-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

// ── fetch stub ────────────────────────────────────────────────────────────────

function stubFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("office-client", () => {
  describe("fetchRoles", () => {
    it("GETs /api/office/roles and returns parsed roles", async () => {
      const roles = [{ id: "r1", name: "coder" }];
      stubFetch(200, roles);
      const result = await fetchRoles();
      expect(result).toEqual(roles);
      expect(global.fetch).toHaveBeenCalledWith("/api/office/roles", { headers: {} });
    });
  });

  describe("createRole", () => {
    it("POSTs to /api/office/roles with body", async () => {
      const role = { id: "r1", name: "new-role" };
      stubFetch(200, role);
      const input = { name: "new-role", kind: "claude-code" };
      const result = await createRole(input);
      expect(result).toEqual(role);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/roles",
        expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
      );
    });
  });

  describe("deleteRole", () => {
    it("DELETEs /api/office/roles/:id and resolves on 204", async () => {
      stubFetch(204, null);
      await expect(deleteRole("r1")).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/roles/r1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws bridge error on non-ok response", async () => {
      stubFetch(404, { error: "not found", code: "not_found" });
      await expect(deleteRole("r999")).rejects.toMatchObject({ error: "not found" });
    });
  });

  describe("fetchAgents", () => {
    it("GETs /api/office/:wk/agents with encoded workspace key", async () => {
      const agents = [{ id: "a1" }];
      stubFetch(200, agents);
      await fetchAgents("my/workspace");
      expect(global.fetch).toHaveBeenCalledWith("/api/office/my%2Fworkspace/agents", {
        headers: {},
      });
    });
  });

  describe("createAgent", () => {
    it("POSTs to /api/office/:wk/agents with body", async () => {
      const agent = { id: "a1", name: "coder-1" };
      stubFetch(200, agent);
      const input = { name: "coder-1", roleId: "r1" };
      const result = await createAgent("wk1", input);
      expect(result).toEqual(agent);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/wk1/agents",
        expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
      );
    });
  });

  describe("deleteAgent", () => {
    it("DELETEs /api/office/:wk/agents/:id", async () => {
      stubFetch(204, null);
      await expect(deleteAgent("wk1", "a1")).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/wk1/agents/a1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("fetchTasks", () => {
    it("GETs /api/office/:wk/agents/:agentId/tasks", async () => {
      stubFetch(200, []);
      await fetchTasks("wk1", "a1");
      expect(global.fetch).toHaveBeenCalledWith("/api/office/wk1/agents/a1/tasks", { headers: {} });
    });
  });

  describe("assignTask", () => {
    it("POSTs instruction to /api/office/:wk/agents/:agentId/tasks", async () => {
      const task = { id: "t1", instruction: "do it" };
      stubFetch(200, task);
      const result = await assignTask("wk1", "a1", "do it");
      expect(result).toEqual(task);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/wk1/agents/a1/tasks",
        expect.objectContaining({ body: JSON.stringify({ instruction: "do it" }) }),
      );
    });
  });

  describe("runAgent", () => {
    it("POSTs to /api/office/:wk/agents/:agentId/run", async () => {
      const agent = { id: "a1", status: "working" };
      stubFetch(200, agent);
      const result = await runAgent("wk1", "a1");
      expect(result).toEqual(agent);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/wk1/agents/a1/run",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("controlAgent", () => {
    it("POSTs action to /api/office/:wk/agents/:agentId/control", async () => {
      const agent = { id: "a1", status: "paused" };
      stubFetch(200, agent);
      const result = await controlAgent("wk1", "a1", "pause");
      expect(result).toEqual(agent);
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/office/wk1/agents/a1/control",
        expect.objectContaining({ body: JSON.stringify({ action: "pause" }) }),
      );
    });
  });

  describe("fetchAudit", () => {
    it("GETs /api/office/:wk/audit", async () => {
      stubFetch(200, []);
      await fetchAudit("wk1");
      expect(global.fetch).toHaveBeenCalledWith("/api/office/wk1/audit", { headers: {} });
    });
  });

  describe("fetchOfficeStatus", () => {
    it("GETs /api/office/:wk/status and returns parsed status", async () => {
      const status = { agents: [] };
      stubFetch(200, status);
      const result = await fetchOfficeStatus("wk1");
      expect(result).toEqual(status);
      expect(global.fetch).toHaveBeenCalledWith("/api/office/wk1/status", { headers: {} });
    });
  });

  describe("error envelope", () => {
    it("throws bridge error on non-ok GET", async () => {
      stubFetch(400, { error: "bad request", code: "validation_error" });
      await expect(fetchRoles()).rejects.toMatchObject({
        error: "bad request",
        code: "validation_error",
      });
    });

    it("throws with internal_error code when body is not JSON", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      });
      await expect(fetchRoles()).rejects.toMatchObject({ code: "internal_error" });
    });
  });
});
