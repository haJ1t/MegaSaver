import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ChunkSet } from "@megasaver/content-store";
import type { Project, Session } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const PROJECT: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "alpha",
  rootPath: "/tmp/a",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const SESSION: Session = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as Session["id"],
  projectId: PROJECT.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "alpha",
  startedAt: "2026-05-10T11:00:00.000Z",
  endedAt: null,
};

// A second session in the SAME project — used to prove clear is scoped to the
// target session only and never touches a sibling's chunk sets.
const OTHER_SESSION: Session = {
  ...SESSION,
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as Session["id"],
  title: "alpha-other",
};

function chunkSet(over: Partial<ChunkSet> & { chunkSetId: string }): ChunkSet {
  return {
    sessionId: SESSION.id,
    projectId: PROJECT.id,
    createdAt: "2026-05-10T12:00:00.000Z",
    source: { kind: "command", command: "ls", args: ["-la"] },
    rawBytes: 1000,
    redacted: false,
    chunks: [{ id: "ch-0", startLine: 0, endLine: 1, bytes: 6, text: "line-0" }],
    ...over,
  };
}

const CS_OLD = chunkSet({
  chunkSetId: "cs-old",
  createdAt: "2026-05-10T12:00:00.000Z",
  rawBytes: 1000,
});
const CS_NEW = chunkSet({
  chunkSetId: "cs-new",
  createdAt: "2026-05-11T12:00:00.000Z",
  rawBytes: 2500,
});

function chunkSetFile(root: string, sessionId: string, chunkSetId: string): string {
  return join(root, "content", PROJECT.id, sessionId, `${chunkSetId}.json`);
}

describe("retention bridge routes — GET summary", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("returns zeroed counts when no chunk sets exist", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION] });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      chunkSets: number;
      totalBytes: number;
      oldestAt: string | null;
    };
    expect(body).toEqual({ chunkSets: 0, totalBytes: 0, oldestAt: null });
  });

  it("aggregates count, totalBytes and the oldest createdAt", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION],
      store: {
        chunkSets: [
          { projectId: PROJECT.id, sessionId: SESSION.id, chunkSet: CS_OLD },
          { projectId: PROJECT.id, sessionId: SESSION.id, chunkSet: CS_NEW },
        ],
      },
    });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chunkSets: number; totalBytes: number; oldestAt: string };
    expect(body.chunkSets).toBe(2);
    expect(body.totalBytes).toBe(3500);
    expect(body.oldestAt).toBe("2026-05-10T12:00:00.000Z");
  });

  it("returns 404 session_not_found for a malformed :id", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION] });
    const res = await fetch(`${server.baseUrl}/api/sessions/not-a-uuid/retention`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_not_found");
  });

  it("rejects a non-GET method with 405", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION] });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention`, {
      method: "DELETE",
    });
    expect(res.status).toBe(405);
  });
});

describe("retention bridge routes — POST clear", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("deletes every chunk set for the session and returns the post-clear count (0)", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION],
      store: {
        chunkSets: [
          { projectId: PROJECT.id, sessionId: SESSION.id, chunkSet: CS_OLD },
          { projectId: PROJECT.id, sessionId: SESSION.id, chunkSet: CS_NEW },
        ],
      },
    });
    expect(existsSync(chunkSetFile(server.storePath, SESSION.id, "cs-old"))).toBe(true);

    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention/clear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chunkSets: number; totalBytes: number; oldestAt: null };
    expect(body).toEqual({ chunkSets: 0, totalBytes: 0, oldestAt: null });

    expect(existsSync(chunkSetFile(server.storePath, SESSION.id, "cs-old"))).toBe(false);
    expect(existsSync(chunkSetFile(server.storePath, SESSION.id, "cs-new"))).toBe(false);
  });

  it("is idempotent — clearing an already-empty session returns 0 and 200", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION] });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention/clear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chunkSets: number };
    expect(body.chunkSets).toBe(0);
  });

  it("only clears the target session — a sibling session's chunk sets survive", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION, OTHER_SESSION],
      store: {
        chunkSets: [
          { projectId: PROJECT.id, sessionId: SESSION.id, chunkSet: CS_OLD },
          {
            projectId: PROJECT.id,
            sessionId: OTHER_SESSION.id,
            chunkSet: chunkSet({ chunkSetId: "cs-other", sessionId: OTHER_SESSION.id }),
          },
        ],
      },
    });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention/clear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    // Target gone, sibling untouched.
    expect(existsSync(chunkSetFile(server.storePath, SESSION.id, "cs-old"))).toBe(false);
    expect(existsSync(chunkSetFile(server.storePath, OTHER_SESSION.id, "cs-other"))).toBe(true);
  });

  it("rejects a non-POST method with 405", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION] });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION.id}/retention/clear`, {
      method: "GET",
    });
    expect(res.status).toBe(405);
  });

  it("returns 404 session_not_found for an unknown session", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION] });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/99999999-9999-4999-8999-999999999999/retention/clear`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_not_found");
  });
});

