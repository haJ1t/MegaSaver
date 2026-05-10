import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type MemoryEntry,
  type Project,
  type Session,
  createInMemoryCoreRegistry,
} from "@megasaver/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

const PROJECT: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const SESSION: Session = {
  id: "22222222-2222-4222-8222-222222222222" as Session["id"],
  projectId: PROJECT.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "smoke",
  startedAt: "2026-05-10T12:00:00.000Z",
  endedAt: null,
};

const ENTRY: MemoryEntry = {
  id: "33333333-3333-4333-8333-333333333333" as MemoryEntry["id"],
  projectId: PROJECT.id,
  sessionId: null,
  scope: "project",
  content: "smoke entry",
  createdAt: "2026-05-10T12:30:00.000Z",
};

describe("Bridge in-process smoke test", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject(PROJECT);
    registry.createSession(SESSION);
    registry.createMemoryEntry(ENTRY);
    const handler = createBridgeHandler({ registry });
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/health → 200 with { ok: true }", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /api/projects → 200 with the seeded project", async () => {
    const res = await fetch(`${baseUrl}/api/projects`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Project[];
    expect(body.map((p) => p.id)).toEqual([PROJECT.id]);
  });

  it("GET /api/sessions?projectId=<id> → 200 with the seeded session", async () => {
    const res = await fetch(`${baseUrl}/api/sessions?projectId=${PROJECT.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session[];
    expect(body.map((s) => s.id)).toEqual([SESSION.id]);
  });

  it("GET /api/memory?projectId=<id> → 200 with the seeded entry", async () => {
    const res = await fetch(`${baseUrl}/api/memory?projectId=${PROJECT.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MemoryEntry[];
    expect(body.map((e) => e.id)).toEqual([ENTRY.id]);
  });

  it("POST /api/sessions creates a new session and returns 201", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT.id,
        agentId: "codex",
        title: "fresh",
        riskLevel: "low",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; projectId: string };
    expect(body.projectId).toBe(PROJECT.id);
  });
});
