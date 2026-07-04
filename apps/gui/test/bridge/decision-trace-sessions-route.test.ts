import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";
import { seedWorkspaceCwd } from "./test-helpers.js";

const DIR = "ws-dir";
const ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
// Two registry sessionIds (mega session create randomUUIDs), independent of the
// cockpit transcript UUID (ID).
const SESS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEM_A = "33333333-3333-4333-8333-333333333333";
const TS_OLD = "2026-07-04T00:00:00.000Z";
const TS_NEW = "2026-07-04T01:00:00.000Z";

let cwd: string;
let storePath: string;
let projectsDir: string;
let metaDir: string;
let server: Server;
let baseUrl: string;

function traceLine(opts: {
  sessionId: string;
  chunkSetId: string;
  createdAt: string;
  memoryIds?: string[];
}): string {
  return JSON.stringify({
    sessionId: opts.sessionId,
    projectId: PROJECT_ID,
    toolName: "Read",
    createdAt: opts.createdAt,
    chunkSetId: opts.chunkSetId,
    ranking: {
      classification: { category: "typescript", confidence: 0.7 },
      decision: "compressed",
      compressor: "typescript",
      engineRanking: true,
      rawTokens: 100,
      returnedTokens: 40,
      candidates: [],
      selected: [
        {
          startLine: 1,
          endLine: 10,
          score: 0.9,
          engine: { baseRelevance: 0.7, memoryBoost: 0.2, failureHistoryBoost: 0, finalScore: 0.9 },
        },
      ],
      omitted: [],
      ...(opts.memoryIds ? { rankedByMemoryIds: opts.memoryIds } : {}),
    },
  });
}

function seedTraceDir(sessionId: string, lines: string[]): void {
  const traceDir = join(storePath, "stats", PROJECT_ID, `${sessionId}-traces`);
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "replay-traces.jsonl"), `${lines.join("\n")}\n`);
}

async function startWithRegistry(withProject: boolean): Promise<void> {
  const registry = createInMemoryCoreRegistry();
  if (withProject) {
    registry.createProject({
      id: PROJECT_ID as ProjectId,
      name: "demo",
      rootPath: cwd,
      createdAt: TS_OLD,
      updatedAt: TS_OLD,
    });
  }
  const handler = createBridgeHandler({
    storePath,
    registry,
    claudeProjectsDir: projectsDir,
    claudeSessionsMetaDir: metaDir,
  });
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const sessionsUrl = () => `${baseUrl}/api/claude-sessions/${DIR}/${ID}/decision-trace/sessions`;
const graphUrl = (session?: string) =>
  `${baseUrl}/api/claude-sessions/${DIR}/${ID}/decision-trace/graph${
    session ? `?session=${encodeURIComponent(session)}` : ""
  }`;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "dtvs-cwd-"));
  storePath = mkdtempSync(join(tmpdir(), "dtvs-store-"));
  projectsDir = mkdtempSync(join(tmpdir(), "dtvs-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "dtvs-meta-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd, id: ID });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cwd, { recursive: true, force: true });
  rmSync(storePath, { recursive: true, force: true });
  rmSync(projectsDir, { recursive: true, force: true });
  rmSync(metaDir, { recursive: true, force: true });
});

describe("decision-trace sessions route", () => {
  it("lists both registry sessionIds with counts and latest createdAt, newest-first", async () => {
    // SESS_A: one trace at TS_OLD. SESS_B: two traces, latest at TS_NEW.
    seedTraceDir(SESS_A, [traceLine({ sessionId: SESS_A, chunkSetId: "csA", createdAt: TS_OLD })]);
    seedTraceDir(SESS_B, [
      traceLine({ sessionId: SESS_B, chunkSetId: "csB1", createdAt: TS_OLD }),
      traceLine({ sessionId: SESS_B, chunkSetId: "csB2", createdAt: TS_NEW }),
    ]);
    await startWithRegistry(true);

    const res = await fetch(sessionsUrl());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.length).toBe(2);
    // Newest-first: SESS_B (latest TS_NEW) precedes SESS_A (TS_OLD).
    expect(body.sessions[0].sessionId).toBe(SESS_B);
    expect(body.sessions[0].outputs).toBe(2);
    expect(body.sessions[0].latestCreatedAt).toBe(TS_NEW);
    expect(body.sessions[1].sessionId).toBe(SESS_A);
    expect(body.sessions[1].outputs).toBe(1);
    expect(body.sessions[1].latestCreatedAt).toBe(TS_OLD);
  });

  it("returns 200 { sessions: [] } when no registry project maps this cwd", async () => {
    seedTraceDir(SESS_A, [traceLine({ sessionId: SESS_A, chunkSetId: "csA", createdAt: TS_OLD })]);
    await startWithRegistry(false); // registry present but no project for this cwd

    const res = await fetch(sessionsUrl());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("returns 200 { sessions: [] } when the project has no *-traces dirs", async () => {
    // Project maps cwd, but no trace dirs seeded.
    await startWithRegistry(true);

    const res = await fetch(sessionsUrl());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("POST to the sessions route → 405 method_not_allowed", async () => {
    await startWithRegistry(true);
    const res = await fetch(sessionsUrl(), { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("decision-trace graph route keyed by picked sessionId", () => {
  it("renders the graph for the picked registry sessionId (?session=)", async () => {
    // Trace keyed by SESS_A (registry id), carrying rankedByMemoryIds → memory node.
    seedTraceDir(SESS_A, [
      traceLine({
        sessionId: SESS_A,
        chunkSetId: "csA",
        createdAt: TS_OLD,
        memoryIds: [MEM_A],
      }),
    ]);
    await startWithRegistry(true);

    const res = await fetch(graphUrl(SESS_A));
    expect(res.status).toBe(200);
    const graph = await res.json();

    expect(graph.stats.outputs).toBe(1);
    expect(graph.nodes.some((n: { kind: string }) => n.kind === "output")).toBe(true);
    expect(graph.nodes.some((n: { kind: string }) => n.kind === "chunk")).toBe(true);
    expect(
      graph.nodes.some((n: { kind: string; id: string }) => n.kind === "memory" && n.id === MEM_A),
    ).toBe(true);
  });

  it("returns a 200 empty graph when ?session is absent (no auto-map)", async () => {
    seedTraceDir(SESS_A, [traceLine({ sessionId: SESS_A, chunkSetId: "csA", createdAt: TS_OLD })]);
    await startWithRegistry(true);

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();
    // Without a picked session id there is no sound key → honest empty.
    expect(graph.nodes).toEqual([]);
    expect(graph.stats.outputs).toBe(0);
  });
});
