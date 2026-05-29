import type { ChunkSet } from "@megasaver/content-store";
import type { Project, Session } from "@megasaver/core";
import type { SessionTokenSaverStats, TokenSaverEvent } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const PROJECT: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "alpha",
  rootPath: "/tmp/a",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const SESSION_OPEN: Session = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as Session["id"],
  projectId: PROJECT.id,
  agentId: "claude-code",
  riskLevel: "medium",
  title: "alpha-open",
  startedAt: "2026-05-10T11:00:00.000Z",
  endedAt: null,
};

const SESSION_ENABLED: Session = {
  ...SESSION_OPEN,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as Session["id"],
  tokenSaver: {
    enabled: true,
    mode: "balanced",
    maxReturnedBytes: 12_000,
    storeRawOutput: true,
    redactSecrets: true,
    autoRepair: true,
    createdAt: "2026-05-10T11:00:00.000Z",
    updatedAt: "2026-05-10T11:00:00.000Z",
  },
};

const EVENT_WITH_CHUNK: TokenSaverEvent = {
  id: "evt-1",
  sessionId: SESSION_ENABLED.id,
  projectId: PROJECT.id,
  createdAt: "2026-05-10T12:00:00.000Z",
  sourceKind: "command",
  label: "ls -la",
  rawBytes: 1000,
  returnedBytes: 200,
  bytesSaved: 800,
  savingRatio: 0.8,
  chunkSetId: "cs-1",
  summary: "directory listing",
  mode: "balanced",
};

const EVENT_NO_CHUNK: TokenSaverEvent = {
  ...EVENT_WITH_CHUNK,
  id: "evt-2",
  createdAt: "2026-05-10T13:00:00.000Z",
  chunkSetId: undefined,
};

const CHUNK_SET: ChunkSet = {
  chunkSetId: "cs-1",
  sessionId: SESSION_ENABLED.id,
  projectId: PROJECT.id,
  createdAt: "2026-05-10T12:00:00.000Z",
  source: { kind: "command", command: "ls", args: ["-la"] },
  rawBytes: 1000,
  redacted: false,
  chunks: [
    { id: "ch-0", startLine: 0, endLine: 1, bytes: 6, text: "line-0" },
    { id: "ch-1", startLine: 1, endLine: 2, bytes: 6, text: "line-1" },
  ],
};

const SUMMARY: SessionTokenSaverStats = {
  sessionId: SESSION_ENABLED.id,
  eventsTotal: 1,
  rawBytesTotal: 1000,
  returnedBytesTotal: 200,
  bytesSavedTotal: 800,
  savingRatio: 0.8,
  secretsRedactedTotal: 0,
  chunksStoredTotal: 2,
  updatedAt: "2026-05-10T12:00:00.000Z",
};

describe("token-saver bridge routes — enable (route 1)", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION_OPEN] });
  });
  afterEach(async () => {
    if (server) await server.close();
  });

  it("enables with defaults on empty body and returns the session with tokenSaver.enabled", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_OPEN.id}/token-saver/enable`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session;
    expect(body.id).toBe(SESSION_OPEN.id);
    expect(body.tokenSaver?.enabled).toBe(true);
    expect(body.tokenSaver?.mode).toBe("balanced");
  });

  it("overlays provided fields onto defaults", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_OPEN.id}/token-saver/enable`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "aggressive", maxReturnedBytes: 4096 }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session;
    expect(body.tokenSaver?.mode).toBe("aggressive");
    expect(body.tokenSaver?.maxReturnedBytes).toBe(4096);
  });

  it("rejects unknown body fields with 400 validation_failed", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_OPEN.id}/token-saver/enable`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bogus: true }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("returns 404 session_not_found for a malformed :id", async () => {
    const res = await fetch(`${server.baseUrl}/api/sessions/not-a-uuid/token-saver/enable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("session_not_found");
  });
});

describe("token-saver bridge routes — disable (route 2)", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("flips enabled to false and zeros the summary", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        summaries: [{ projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, summary: SUMMARY }],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/disable`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session;
    expect(body.tokenSaver?.enabled).toBe(false);

    const statsRes = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/stats`,
    );
    const stats = (await statsRes.json()) as SessionTokenSaverStats;
    expect(stats.eventsTotal).toBe(0);
    expect(stats.bytesSavedTotal).toBe(0);
  });

  it("is idempotent for a session that never had tokenSaver settings", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION_OPEN] });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_OPEN.id}/token-saver/disable`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session;
    expect(body.id).toBe(SESSION_OPEN.id);
  });
});

describe("token-saver bridge routes — status (route 3)", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("returns { enabled:false, settings:null } for a pre-AA session", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION_OPEN] });
    const res = await fetch(`${server.baseUrl}/api/sessions/${SESSION_OPEN.id}/token-saver/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; settings: unknown };
    expect(body.enabled).toBe(false);
    expect(body.settings).toBeNull();
  });

  it("returns enabled:true and the settings object when configured", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION_ENABLED] });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/status`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enabled: boolean;
      settings: { mode: string } | null;
    };
    expect(body.enabled).toBe(true);
    expect(body.settings?.mode).toBe("balanced");
  });
});

describe("token-saver bridge routes — stats (route 4)", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("returns JSON null when no summary file exists", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION_ENABLED] });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/stats`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns the persisted summary verbatim", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        summaries: [{ projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, summary: SUMMARY }],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/stats`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionTokenSaverStats;
    expect(body.eventsTotal).toBe(1);
    expect(body.savingRatio).toBeCloseTo(0.8);
  });
});

describe("token-saver bridge routes — events (route 5)", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("returns [] when no events log exists", async () => {
    server = await startTestBridge({ projects: [PROJECT], sessions: [SESSION_ENABLED] });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/events`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("parses the JSONL log and returns events newest-first", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        events: [
          {
            projectId: PROJECT.id,
            sessionId: SESSION_ENABLED.id,
            lines: [EVENT_WITH_CHUNK, EVENT_NO_CHUNK],
          },
        ],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/events`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TokenSaverEvent[];
    expect(body.map((e) => e.id)).toEqual(["evt-2", "evt-1"]);
  });
});

describe("token-saver bridge routes — raw/sent blobs (routes 6, 7)", () => {
  let server: TestServer;
  afterEach(async () => {
    if (server) await server.close();
  });

  it("streams the chunkSet text as text/plain inline with strict CSP", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        events: [
          { projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, lines: [EVENT_WITH_CHUNK] },
        ],
        chunkSets: [{ projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, chunkSet: CHUNK_SET }],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/events/evt-1/raw`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(await res.text()).toContain("line-0");
  });

  it("serves /sent with the same chunkSet bytes", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        events: [
          { projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, lines: [EVENT_WITH_CHUNK] },
        ],
        chunkSets: [{ projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, chunkSet: CHUNK_SET }],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/events/evt-1/sent`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("line-1");
  });

  it("returns 404 event_not_found for an event with no stored chunkSet", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        events: [{ projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, lines: [EVENT_NO_CHUNK] }],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/events/evt-2/raw`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_not_found");
  });

  it("returns 404 event_not_found for an unknown event id", async () => {
    server = await startTestBridge({
      projects: [PROJECT],
      sessions: [SESSION_ENABLED],
      store: {
        events: [
          { projectId: PROJECT.id, sessionId: SESSION_ENABLED.id, lines: [EVENT_WITH_CHUNK] },
        ],
      },
    });
    const res = await fetch(
      `${server.baseUrl}/api/sessions/${SESSION_ENABLED.id}/token-saver/events/unknown/raw`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("event_not_found");
  });
});
