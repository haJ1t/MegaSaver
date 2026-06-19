import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OverlayMemoryEntry, writeOverlayMemory } from "@megasaver/core";
import { type EvidenceRecordInput, appendEvidence } from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey, memoryEntryIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-graph";
const DIR = "ws-dir";
const ID = "wssessgraph";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-graph-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-graph-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

const memoryBase = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/memory`;
const graphUrl = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/memory/graph`;

describe("memory graph route", () => {
  it("GET /memory/graph with two memories → 200 with nodes containing their ids (kind memory)", async () => {
    server = await start();

    const post1 = await fetch(memoryBase(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "session", content: "first memory node", type: "decision" }),
    });
    expect(post1.status).toBe(201);
    const mem1 = await post1.json();

    const post2 = await fetch(memoryBase(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "project",
        content: "second memory node",
        type: "architecture",
      }),
    });
    expect(post2.status).toBe(201);
    const mem2 = await post2.json();

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);

    const graph = await res.json();
    expect(graph).toHaveProperty("nodes");
    expect(graph).toHaveProperty("edges");
    expect(graph).toHaveProperty("stats");

    const memoryNodes = graph.nodes.filter((n: { kind: string }) => n.kind === "memory");
    const memoryIds = memoryNodes.map((n: { id: string }) => n.id);
    expect(memoryIds).toContain(mem1.id);
    expect(memoryIds).toContain(mem2.id);

    expect(graph.stats.nodeCount).toBe(graph.nodes.length);
  });

  it("GET /memory/graph with no memories → 200 with no memory-kind nodes", async () => {
    server = await start();

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);

    const graph = await res.json();
    expect(graph).toHaveProperty("nodes");
    expect(graph).toHaveProperty("stats");
    const memoryNodes = graph.nodes.filter((n: { kind: string }) => n.kind === "memory");
    expect(memoryNodes).toHaveLength(0);
    expect(graph.stats.nodeCount).toBe(graph.nodes.length);
  });

  it("traversal dir → 400 validation_failed", async () => {
    server = await start();
    const res = await fetch(
      `${server.baseUrl}/api/claude-sessions/..%2F..%2Fetc/${ID}/memory/graph`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("validation_failed");
  });

  it("unknown (dir,id) → 404 claude_session_not_found", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/unknownid/memory/graph`);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("claude_session_not_found");
  });

  it("GET /memory/graph emits a cites edge from a memory to its evidence", async () => {
    server = await start();

    const workspaceKey = encodeWorkspaceKey(CWD);
    const memId = memoryEntryIdSchema.parse(randomUUID().toLowerCase());
    const evId = randomUUID().toLowerCase();

    // The GUI POST body cannot set `evidence`; core/CLI/agent create paths do.
    // Seed an overlay memory carrying evidence: [evId] directly into the store.
    const memory: OverlayMemoryEntry = {
      id: memId,
      workspaceKey,
      liveSessionId: ID,
      scope: "session",
      type: "decision",
      title: "cited memory",
      content: "a memory that cites evidence",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "approved",
      evidence: [evId],
      stale: false,
      createdAt: "2026-06-16T12:00:00.000Z",
      updatedAt: "2026-06-16T12:00:00.000Z",
    };
    writeOverlayMemory(server.storePath, workspaceKey, [memory]);

    // Seed the evidence record so the evidence NODE exists; buildGraph only
    // emits `cites` when both endpoints are nodes.
    const record: EvidenceRecordInput = {
      evidenceId: evId,
      workspaceKey,
      sessionRef: { kind: "live", id: ID },
      sourceKind: "command",
      sourceRef: { command: "git", args: ["log"] },
      classification: "generic_shell",
      redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
      redactedRawContent: "redacted raw text",
      redactedReturnedContent: "redacted returned text",
      redactedRawChunkSetId: "cs-1",
      returnedChunkRefs: [{ chunkSetId: "cs-1", chunkId: "0" }],
      createdAt: "2026-06-16T12:00:00.000Z",
      expiresAt: null,
      retentionClass: "session",
      policyVersion: "1",
      pipelineVersion: "1",
    };
    await appendEvidence({ storeRoot: server.storePath, redactSourceRef: (r) => r, record });

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    const evidenceNode = graph.nodes.find(
      (n: { id: string; kind: string }) => n.id === evId && n.kind === "evidence",
    );
    expect(evidenceNode).toBeDefined();

    const citesEdge = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "cites" && e.from === memId && e.to === evId,
    );
    expect(citesEdge).toBeDefined();
  });

  it("POST to /memory/graph → 405 method_not_allowed", async () => {
    server = await start();
    const res = await fetch(graphUrl(), { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("GET /memory/graph ingestsiki pages + code-link from memory relatedFiles", async () => {
    // Write wiki fixture under CWD/wiki/
    const wikiRoot = join(CWD, "wiki");
    mkdirSync(join(wikiRoot, "entities"), { recursive: true });
    mkdirSync(join(wikiRoot, "concepts"), { recursive: true });
    writeFileSync(
      join(wikiRoot, "entities", "a.md"),
      "---\ntitle: Entity A\ntags: []\nstatus: active\n---\nLinks to [[concepts/b]].\n",
    );
    writeFileSync(join(wikiRoot, "concepts", "b.md"), "# Concept B\nNo links.\n");

    server = await start();

    const workspaceKey = encodeWorkspaceKey(CWD);
    const memId = memoryEntryIdSchema.parse(randomUUID().toLowerCase());
    const memory: OverlayMemoryEntry = {
      id: memId,
      workspaceKey,
      liveSessionId: ID,
      scope: "session",
      type: "decision",
      title: "wiki test memory",
      content: "memory with relatedFiles",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "approved",
      stale: false,
      relatedFiles: ["src/foo.ts"],
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    };
    writeOverlayMemory(server.storePath, workspaceKey, [memory]);

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    // wiki node for entities/a.md
    const wikiNodeA = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "entities/a.md",
    );
    expect(wikiNodeA).toBeDefined();

    // wiki node for concepts/b.md
    const wikiNodeB = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "concepts/b.md",
    );
    expect(wikiNodeB).toBeDefined();

    // wiki-link edge from entities/a.md → concepts/b.md
    const wikiLinkEdge = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "wiki-link" && e.from === "entities/a.md" && e.to === "concepts/b.md",
    );
    expect(wikiLinkEdge).toBeDefined();

    // file node for src/foo.ts (from memory relatedFiles)
    const fileNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "file" && n.id === "src/foo.ts",
    );
    expect(fileNode).toBeDefined();

    // code-link edge from memory → src/foo.ts
    const codeLinkEdge = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "code-link" && e.from === memId && e.to === "src/foo.ts",
    );
    expect(codeLinkEdge).toBeDefined();
  });

  it("GET /memory/graph path-safety: sibling secret.md outside wiki/ is NOT ingested", async () => {
    // Ensure secret.md exists NEXT TO wiki/ (not inside it)
    mkdirSync(CWD, { recursive: true });
    writeFileSync(join(CWD, "secret.md"), "# Secret\nshould not appear\n");
    // Also seed a valid wiki page so wiki ingestion actually runs
    const wikiRoot = join(CWD, "wiki");
    mkdirSync(join(wikiRoot, "entities"), { recursive: true });
    writeFileSync(join(wikiRoot, "entities", "safe.md"), "# Safe\nno links\n");

    server = await start();

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    // safe.md inside wiki/ IS present
    const safeNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "entities/safe.md",
    );
    expect(safeNode).toBeDefined();

    // secret.md OUTSIDE wiki/ must not appear
    const secretNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id.includes("secret"),
    );
    expect(secretNode).toBeUndefined();
  });
});
