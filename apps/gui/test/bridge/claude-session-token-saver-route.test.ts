import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ts-ws";
const WK = encodeWorkspaceKey(CWD);
const DIR = "ws-dir";
const ID = "wssess01";
const CHUNK_SET_ID = "cs-1";

const summary = {
  liveSessionId: ID,
  eventsTotal: 1,
  rawBytesTotal: 1000,
  returnedBytesTotal: 200,
  bytesSavedTotal: 800,
  savingRatio: 0.8,
  secretsRedactedTotal: 0,
  chunksStoredTotal: 1,
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const event = {
  id: "evt-1",
  workspaceKey: WK,
  liveSessionId: ID,
  createdAt: "2026-06-14T00:00:00.000Z",
  sourceKind: "file",
  label: "/tmp/x.txt",
  rawBytes: 1000,
  returnedBytes: 200,
  bytesSaved: 800,
  savingRatio: 0.8,
  chunkSetId: CHUNK_SET_ID,
  summary: "s",
  mode: "balanced",
};

const chunkSet = {
  chunkSetId: CHUNK_SET_ID,
  workspaceKey: WK,
  liveSessionId: ID,
  createdAt: "2026-06-14T00:00:00.000Z",
  source: { kind: "file", path: "/tmp/x.txt" },
  rawBytes: 1000,
  redacted: false,
  chunks: [{ id: "c1", startLine: 1, endLine: 2, bytes: 11, text: "stored blob" }],
};

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-ts-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-ts-meta-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function startSeeded() {
  return startTestBridge({
    claudeProjectsDir: projectsDir,
    claudeSessionsMetaDir: metaDir,
    store: {
      overlaySummaries: [{ workspaceKey: WK, liveSessionId: ID, summary }],
      overlayEvents: [{ workspaceKey: WK, liveSessionId: ID, lines: [event] }],
      overlayChunkSets: [
        { workspaceKey: WK, liveSessionId: ID, chunkSetId: CHUNK_SET_ID, chunkSet },
      ],
    },
  });
}

const base = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/token-saver`;

describe("live token-saver routes (read-only)", () => {
  it("GET /status returns enabled + settings shape", async () => {
    server = await startSeeded();
    const res = await fetch(`${base()}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("enabled");
    expect(body).toHaveProperty("settings");
  });

  it("GET /stats returns the overlay summary", async () => {
    server = await startSeeded();
    const res = await fetch(`${base()}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eventsTotal).toBe(1);
    expect(body.liveSessionId).toBe(ID);
  });

  it("GET /events returns the events desc", async () => {
    server = await startSeeded();
    const res = await fetch(`${base()}/events`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("evt-1");
  });

  it("GET /events/:id/raw serves the stored chunk-set blob text", async () => {
    server = await startSeeded();
    const res = await fetch(`${base()}/events/evt-1/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain("stored blob");
  });

  it("GET /events/:unknown/raw → 404 event_not_found", async () => {
    server = await startSeeded();
    const res = await fetch(`${base()}/events/nope/raw`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("event_not_found");
  });

  it("traversal dir → 400 validation_failed", async () => {
    server = await startSeeded();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/token-saver/stats`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown session → 404 claude_session_not_found", async () => {
    server = await startSeeded();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/${DIR}/unknownid/token-saver/stats`,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });
});
