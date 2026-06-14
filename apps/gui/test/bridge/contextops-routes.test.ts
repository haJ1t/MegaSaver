import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, ProjectRule } from "@megasaver/core";
import { projectRuleIdSchema } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  MEMORY_PROJECT_ENTRY,
  PROJECT_A,
  type TestServer,
  startTestBridge,
} from "./test-helpers.js";

const CLOCK = { now: () => "2026-05-10T12:00:00.000Z", newId: () => randomUUID() };

function rule(
  over: { id: string; title: string } & Partial<Omit<ProjectRule, "id" | "title">>,
): ProjectRule {
  return {
    id: projectRuleIdSchema.parse(over.id),
    projectId: PROJECT_A.id,
    title: over.title,
    rule: over.rule ?? "do the thing",
    appliesTo: over.appliesTo ?? ["**/*.ts"],
    evidence: over.evidence ?? [],
    severity: over.severity ?? "warning",
    confidence: over.confidence ?? "medium",
    createdFrom: over.createdFrom ?? "manual",
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
  } as ProjectRule;
}

describe("ContextOps bridge routes", () => {
  let server: TestServer;
  const tmpRoots: string[] = [];

  afterEach(async () => {
    if (server) await server.close();
    for (const r of tmpRoots) rmSync(r, { recursive: true, force: true });
    tmpRoots.length = 0;
  });

  // ── POST /api/projects ──────────────────────────────────────────────────
  describe("POST /api/projects", () => {
    it("creates a project for an existing readable directory", async () => {
      server = await startTestBridge();
      const root = mkdtempSync(join(tmpdir(), "mega-rootpath-"));
      tmpRoots.push(root);
      const res = await fetch(`${server.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "fresh", rootPath: root }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as Project;
      expect(body.name).toBe("fresh");
      expect(server.registry.listProjects().map((p) => p.name)).toContain("fresh");
    });

    it("rejects a non-existent root path with rootpath_invalid", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x", rootPath: "/no/such/dir/xyzzy-12345" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("rootpath_invalid");
    });

    it("rejects a duplicate name with 409", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const root = mkdtempSync(join(tmpdir(), "mega-rootpath-"));
      tmpRoots.push(root);
      const res = await fetch(`${server.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: PROJECT_A.name, rootPath: root }),
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("validation_failed");
    });

    it("rejects a missing name with validation_failed", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rootPath: "/tmp" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("validation_failed");
    });
  });

  // ── Memory mutation ─────────────────────────────────────────────────────
  describe("memory PATCH / DELETE / typed create / search", () => {
    it("PATCH sets approval", async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        memoryEntries: [MEMORY_PROJECT_ENTRY],
      });
      const res = await fetch(`${server.baseUrl}/api/memory/${MEMORY_PROJECT_ENTRY.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approval: "rejected" }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).approval).toBe("rejected");
    });

    it("PATCH unknown id → 404 memory_entry_not_found", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/memory/${randomUUID()}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approval: "approved" }),
      });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("memory_entry_not_found");
    });

    it("DELETE removes the entry", async () => {
      server = await startTestBridge({
        projects: [PROJECT_A],
        memoryEntries: [MEMORY_PROJECT_ENTRY],
      });
      const res = await fetch(`${server.baseUrl}/api/memory/${MEMORY_PROJECT_ENTRY.id}`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(server.registry.listMemoryEntries(PROJECT_A.id)).toHaveLength(0);
    });

    it("DELETE unknown id → 404", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/memory/${randomUUID()}`, { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("POST honours typed fields", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: PROJECT_A.id,
          scope: "project",
          content: "typed entry",
          type: "bug",
          confidence: "high",
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.type).toBe("bug");
      expect(body.confidence).toBe("high");
    });

    it("GET filters by query and paginates with limit/offset", async () => {
      const second = {
        ...MEMORY_PROJECT_ENTRY,
        id: randomUUID() as (typeof MEMORY_PROJECT_ENTRY)["id"],
        content: "needle here",
        title: "needle here",
        createdAt: "2026-05-10T12:00:00.000Z",
        updatedAt: "2026-05-10T12:00:00.000Z",
      };
      server = await startTestBridge({
        projects: [PROJECT_A],
        memoryEntries: [MEMORY_PROJECT_ENTRY, second],
      });
      const q = await fetch(
        `${server.baseUrl}/api/memory?projectId=${PROJECT_A.id}&query=needle`,
      ).then((r) => r.json());
      expect(q).toHaveLength(1);
      const page = await fetch(
        `${server.baseUrl}/api/memory?projectId=${PROJECT_A.id}&limit=1&offset=0`,
      ).then((r) => r.json());
      expect(page).toHaveLength(1);
    });
  });

  // ── Audit ───────────────────────────────────────────────────────────────
  describe("GET /api/projects/:id/audit", () => {
    it("returns a zero summary when no events exist", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/audit?window=all`);
      expect(res.status).toBe(200);
      expect((await res.json()).eventsTotal).toBe(0);
    });

    it("rejects an invalid window", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/audit?window=bogus`);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("validation_failed");
    });

    it("404s for an unknown project", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/projects/${randomUUID()}/audit`);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("project_not_found");
    });
  });

  // ── Rules ─────────────────────────────────────────────────────────────────
  describe("GET /api/projects/:id/rules", () => {
    it("returns rules ranked for a task", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      server.registry.createProjectRule(
        rule({
          id: "d0000000-0000-4000-8000-000000000001",
          title: "no any",
          rule: "avoid any type",
        }),
      );
      const res = await fetch(
        `${server.baseUrl}/api/projects/${PROJECT_A.id}/rules?task=${encodeURIComponent("avoid any type")}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rule: { title: string }; reason: string }[];
      expect(body[0]?.rule.title).toBe("no any");
    });
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────
  describe("GET /api/projects/:id/tasks", () => {
    it("returns plans with ready step ids", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      server.registry.createTaskPlan(
        PROJECT_A.id,
        {
          task: "ship it",
          sessionId: null,
          steps: [{ type: "edit", title: "do x", key: "s1", dependsOnKeys: [] }],
        },
        CLOCK,
      );
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/tasks`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { plan: { task: string }; ready: string[] }[];
      expect(body[0]?.plan.task).toBe("ship it");
      expect(body[0]?.ready.length).toBe(1);
    });
  });

  // ── Tools ─────────────────────────────────────────────────────────────────
  describe("GET /api/projects/:id/tools", () => {
    it("returns the route split + registered tools", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      server.registry.createToolDefinition(
        PROJECT_A.id,
        {
          name: "git status",
          description: "show status",
          category: "git",
          risk: "safe",
          keywords: [],
        },
        CLOCK,
      );
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/tools`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { route: { reason: string }; tools: unknown[] };
      expect(body.tools).toHaveLength(1);
      expect(typeof body.route.reason).toBe("string");
    });
  });

  // ── Index / Context (file-backed: no-index + error paths) ─────────────────
  describe("index + context with no index", () => {
    it("index status reports indexed:false", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/index`);
      expect(res.status).toBe(200);
      expect((await res.json()).indexed).toBe(false);
    });

    it("context preview reports indexed:false (needs a task)", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(
        `${server.baseUrl}/api/projects/${PROJECT_A.id}/context?task=anything`,
      );
      expect(res.status).toBe(200);
      expect((await res.json()).indexed).toBe(false);
    });

    it("context preview without a task → 400", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/context`);
      expect(res.status).toBe(400);
    });
  });

  // ── Dispatch edges ────────────────────────────────────────────────────────
  describe("project-scoped dispatch", () => {
    it("405s a POST to a read-only segment", async () => {
      server = await startTestBridge({ projects: [PROJECT_A] });
      const res = await fetch(`${server.baseUrl}/api/projects/${PROJECT_A.id}/audit`, {
        method: "POST",
      });
      expect(res.status).toBe(405);
    });

    it("404s an unknown project on /rules", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/projects/${randomUUID()}/rules`);
      expect(res.status).toBe(404);
    });
  });
});
