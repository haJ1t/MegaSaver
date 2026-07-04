import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";
import { seedWorkspaceCwd } from "./test-helpers.js";

const DIR = "ws-dir";
const ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEM_A = "33333333-3333-4333-8333-333333333333";
const TS = "2026-07-04T00:00:00.000Z";
const DIGEST = "a".repeat(64);

let cwd: string;
let storePath: string;
let projectsDir: string;
let metaDir: string;
let server: Server;
let baseUrl: string;

function traceLine(chunkSetId: string): string {
  return JSON.stringify({
    sessionId: ID,
    projectId: PROJECT_ID,
    toolName: "Read",
    createdAt: TS,
    chunkSetId,
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
    },
  });
}

function evidenceRecord(chunkSetId: string): Record<string, unknown> {
  return {
    evidenceId: MEM_A,
    workspaceKey: encodeWorkspaceKey(cwd),
    sessionRef: { kind: "live", id: ID },
    sourceKind: "file",
    sourceRef: { label: "src" },
    classification: "typescript",
    redactionReport: { redacted: true, highRiskFindings: 1, unresolvedHighRisk: false },
    rawDigest: DIGEST,
    returnedDigest: DIGEST,
    redactedRawChunkSetId: chunkSetId,
    returnedChunkRefs: [{ chunkSetId, chunkId: "0" }],
    createdAt: TS,
    expiresAt: null,
    retentionClass: "pinned",
    pinnedByMemoryIds: [MEM_A],
    status: "available",
    revokedAt: null,
    revocationReason: null,
    policyVersion: "1",
    pipelineVersion: "1",
    transitions: [{ at: TS, kind: "created", actor: "system" }],
  };
}

async function startWithRegistry(withProject: boolean): Promise<void> {
  const registry = createInMemoryCoreRegistry();
  if (withProject) {
    registry.createProject({
      id: PROJECT_ID as ProjectId,
      name: "demo",
      // rootPath must equal the transcript cwd so the route resolves projectId.
      rootPath: cwd,
      createdAt: TS,
      updatedAt: TS,
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

function seedTraceAndEvidence(): void {
  const traceDir = join(storePath, "stats", PROJECT_ID, `${ID}-traces`);
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "replay-traces.jsonl"), `${traceLine("cs1")}\n`);
  const evDir = join(storePath, "evidence", encodeWorkspaceKey(cwd));
  mkdirSync(evDir, { recursive: true });
  writeFileSync(join(evDir, `${MEM_A}.json`), JSON.stringify(evidenceRecord("cs1")));
}

// The picked registry sessionId equals the trace-dir name (`${ID}-traces`) in
// this fixture; the graph route now keys off the ?session picker, not liveSessionId.
const graphUrl = (session?: string) =>
  `${baseUrl}/api/claude-sessions/${DIR}/${ID}/decision-trace/graph${
    session ? `?session=${encodeURIComponent(session)}` : ""
  }`;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "dtv-cwd-"));
  storePath = mkdtempSync(join(tmpdir(), "dtv-store-"));
  projectsDir = mkdtempSync(join(tmpdir(), "dtv-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "dtv-meta-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd, id: ID });
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(cwd, { recursive: true, force: true });
  rmSync(storePath, { recursive: true, force: true });
  rmSync(projectsDir, { recursive: true, force: true });
  rmSync(metaDir, { recursive: true, force: true });
});

describe("decision-trace graph route", () => {
  it("returns a decision graph with output, chunk, memory, and redaction nodes", async () => {
    seedTraceAndEvidence();
    await startWithRegistry(true);

    const res = await fetch(graphUrl(ID));
    expect(res.status).toBe(200);
    const graph = await res.json();

    expect(graph).toHaveProperty("nodes");
    expect(graph).toHaveProperty("edges");
    expect(graph).toHaveProperty("stats");

    expect(graph.nodes.some((n: { kind: string }) => n.kind === "output")).toBe(true);
    expect(graph.nodes.some((n: { kind: string }) => n.kind === "chunk")).toBe(true);
    expect(
      graph.nodes.some((n: { kind: string; id: string }) => n.kind === "memory" && n.id === MEM_A),
    ).toBe(true);
    expect(graph.nodes.some((n: { kind: string }) => n.kind === "redaction")).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.stats.outputs).toBe(1);
  });

  it("returns a 200 empty graph for a session with no traces", async () => {
    // No trace/evidence seeded.
    await startWithRegistry(true);

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.stats).toEqual({ outputs: 0, chunks: 0, memoriesPinned: 0 });
  });

  it("returns a 200 empty graph when no registry project maps this cwd (overlay session)", async () => {
    seedTraceAndEvidence();
    await startWithRegistry(false); // registry present but no project for this cwd

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();
    // Traces exist on disk but cannot be located without the projectId → honest empty.
    expect(graph.nodes).toEqual([]);
    expect(graph.stats.outputs).toBe(0);
  });

  it("traversal dir → 400 validation_failed", async () => {
    await startWithRegistry(true);
    const res = await fetch(
      `${baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/decision-trace/graph`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown (dir,id) → 404 claude_session_not_found", async () => {
    await startWithRegistry(true);
    const res = await fetch(`${baseUrl}/api/claude-sessions/${DIR}/unknownid/decision-trace/graph`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });

  it("POST to the graph route → 405 method_not_allowed", async () => {
    await startWithRegistry(true);
    const res = await fetch(graphUrl(), { method: "POST" });
    expect(res.status).toBe(405);
  });
});
