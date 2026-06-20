import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OverlayMemoryEntry, writeOverlayMemory } from "@megasaver/core";
import { type EvidenceRecordInput, appendEvidence } from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey, memoryEntryIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const DIR = "ws-dir";
const ID = "wssessgraph";

let cwd: string;
let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "live-ws-graph-"));
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-graph-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-graph-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
  rmSync(cwd, { recursive: true, force: true });
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

    const workspaceKey = encodeWorkspaceKey(cwd);
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

  it("GET /memory/graph: a project-scoped memory gets a project-memory edge (not orphaned)", async () => {
    server = await start();

    const post = await fetch(memoryBase(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", content: "project memory node", type: "decision" }),
    });
    expect(post.status).toBe(201);
    const mem = await post.json();

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    const projectMemoryEdge = graph.edges.find(
      (e: { kind: string; to: string }) => e.kind === "project-memory" && e.to === mem.id,
    );
    expect(projectMemoryEdge).toBeDefined();

    const parentNode = graph.nodes.find((n: { id: string }) => n.id === projectMemoryEdge.from);
    expect(parentNode).toBeDefined();
  });

  it("POST to /memory/graph → 405 method_not_allowed", async () => {
    server = await start();
    const res = await fetch(graphUrl(), { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("GET /memory/graph ingests wiki pages + code-link from memory relatedFiles", async () => {
    const wikiRoot = join(cwd, "wiki");
    mkdirSync(join(wikiRoot, "entities"), { recursive: true });
    mkdirSync(join(wikiRoot, "concepts"), { recursive: true });
    writeFileSync(
      join(wikiRoot, "entities", "a.md"),
      "---\ntitle: Entity A\ntags: []\nstatus: active\n---\nLinks to [[concepts/b]].\n",
    );
    writeFileSync(join(wikiRoot, "concepts", "b.md"), "# Concept B\nNo links.\n");

    server = await start();

    const workspaceKey = encodeWorkspaceKey(cwd);
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
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "wiki:entities/a.md",
    );
    expect(wikiNodeA).toBeDefined();

    // wiki node for concepts/b.md
    const wikiNodeB = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "wiki:concepts/b.md",
    );
    expect(wikiNodeB).toBeDefined();

    // wiki-link edge from entities/a.md → concepts/b.md
    const wikiLinkEdge = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "wiki-link" && e.from === "wiki:entities/a.md" && e.to === "wiki:concepts/b.md",
    );
    expect(wikiLinkEdge).toBeDefined();

    // file node for src/foo.ts (from memory relatedFiles)
    const fileNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "file" && n.id === "file:src/foo.ts",
    );
    expect(fileNode).toBeDefined();

    // code-link edge from memory → src/foo.ts
    const codeLinkEdge = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "code-link" && e.from === memId && e.to === "file:src/foo.ts",
    );
    expect(codeLinkEdge).toBeDefined();
  });

  it("GET /memory/graph: ./-prefixed memory relatedFile + plain wiki citation share ONE file node", async () => {
    const wikiRoot = join(cwd, "wiki");
    mkdirSync(join(wikiRoot, "entities"), { recursive: true });
    writeFileSync(
      join(wikiRoot, "entities", "ref.md"),
      "---\ntitle: Ref\ntags: []\nstatus: active\n---\nSome claim (source: src/shared/x.ts).\n",
    );

    server = await start();

    const workspaceKey = encodeWorkspaceKey(cwd);
    const memId = memoryEntryIdSchema.parse(randomUUID().toLowerCase());
    const memory: OverlayMemoryEntry = {
      id: memId,
      workspaceKey,
      liveSessionId: ID,
      scope: "session",
      type: "decision",
      title: "uses shared",
      content: "uses src/shared/x.ts",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "approved",
      stale: false,
      relatedFiles: ["./src/shared/x.ts"],
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    };
    writeOverlayMemory(server.storePath, workspaceKey, [memory]);

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    const fileNodes = graph.nodes.filter(
      (n: { kind: string; id: string }) => n.kind === "file" && n.id === "file:src/shared/x.ts",
    );
    expect(fileNodes).toHaveLength(1);

    const codeLink = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "code-link" && e.from === memId && e.to === "file:src/shared/x.ts",
    );
    expect(codeLink).toBeDefined();
    const wikiCite = graph.edges.find(
      (e: { kind: string; to: string }) =>
        e.kind === "wiki-cite" && e.to === "file:src/shared/x.ts",
    );
    expect(wikiCite).toBeDefined();
  });

  it("GET /memory/graph: :line-suffixed memory relatedFile + plain wiki citation share ONE file node", async () => {
    const wikiRoot = join(cwd, "wiki");
    mkdirSync(join(wikiRoot, "entities"), { recursive: true });
    writeFileSync(
      join(wikiRoot, "entities", "ref.md"),
      "---\ntitle: Ref\ntags: []\nstatus: active\n---\nSome claim (source: src/shared/x.ts:12).\n",
    );

    server = await start();

    const workspaceKey = encodeWorkspaceKey(cwd);
    const memId = memoryEntryIdSchema.parse(randomUUID().toLowerCase());
    const memory: OverlayMemoryEntry = {
      id: memId,
      workspaceKey,
      liveSessionId: ID,
      scope: "session",
      type: "decision",
      title: "uses shared",
      content: "uses src/shared/x.ts",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "approved",
      stale: false,
      relatedFiles: ["src/shared/x.ts:12"],
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    };
    writeOverlayMemory(server.storePath, workspaceKey, [memory]);

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    const fileNodes = graph.nodes.filter(
      (n: { kind: string; id: string }) => n.kind === "file" && n.id === "file:src/shared/x.ts",
    );
    expect(fileNodes).toHaveLength(1);

    const codeLink = graph.edges.find(
      (e: { kind: string; from: string; to: string }) =>
        e.kind === "code-link" && e.from === memId && e.to === "file:src/shared/x.ts",
    );
    expect(codeLink).toBeDefined();
    const wikiCite = graph.edges.find(
      (e: { kind: string; to: string }) =>
        e.kind === "wiki-cite" && e.to === "file:src/shared/x.ts",
    );
    expect(wikiCite).toBeDefined();
  });

  it("GET /memory/graph path-safety: a symlink in wiki/ pointing outside is NOT followed", async () => {
    // The secret lives OUTSIDE the wiki tree, with content that must never leak.
    const leakedCite = "secret/leaked-path.ts";
    const outsidePath = join(cwd, "outside-secret.md");
    writeFileSync(outsidePath, `# Outside\n(source: ${leakedCite})\n`);

    // A valid in-tree page so wiki ingestion definitely runs.
    const wikiRoot = join(cwd, "wiki");
    mkdirSync(join(wikiRoot, "entities"), { recursive: true });
    writeFileSync(join(wikiRoot, "entities", "safe.md"), "# Safe\nno links\n");

    // A symlink INSIDE the walked tree whose target escapes wiki/. The in-walk
    // Dirent.isSymbolicLink() skip is the sole confinement mechanism — without
    // it, escape.md would be read and the secret would leak.
    const escapeLink = join(wikiRoot, "entities", "escape.md");
    symlinkSync(outsidePath, escapeLink);

    server = await start();

    const res = await fetch(graphUrl());
    expect(res.status).toBe(200);
    const graph = await res.json();

    // safe.md inside wiki/ IS present (proves the walk actually ran).
    const safeNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "wiki:entities/safe.md",
    );
    expect(safeNode).toBeDefined();

    // No wiki node for the symlink that escapes the tree.
    const escapeNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "wiki" && n.id === "wiki:entities/escape.md",
    );
    expect(escapeNode).toBeUndefined();

    // Following the symlink would parse escape.md's (source:) citation into a
    // file node and a wiki-cite edge; both must be absent because the page was
    // never read.
    const leakedFileNode = graph.nodes.find(
      (n: { kind: string; id: string }) => n.kind === "file" && n.id === `file:${leakedCite}`,
    );
    expect(leakedFileNode).toBeUndefined();
    const leakedCiteEdge = graph.edges.find(
      (e: { kind: string; to: string }) => e.kind === "wiki-cite" && e.to === `file:${leakedCite}`,
    );
    expect(leakedCiteEdge).toBeUndefined();
  });

  // chmod 000 does not block reads when running as root, which makes the EACCES
  // path unreachable; skip there so the suite stays deterministic in CI containers.
  const itUnlessRoot = process.getuid?.() === 0 ? it.skip : it;

  itUnlessRoot(
    "GET /memory/graph surfaces an unreadable wiki folder (EACCES) as 500, not an empty graph",
    async () => {
      const wikiRoot = join(cwd, "wiki");
      const entitiesDir = join(wikiRoot, "entities");
      mkdirSync(entitiesDir, { recursive: true });
      writeFileSync(join(entitiesDir, "a.md"), "# Entity A\nno links\n");
      chmodSync(entitiesDir, 0o000);
      server = await start();
      try {
        const res = await fetch(graphUrl());
        expect(res.status).toBe(500);
      } finally {
        chmodSync(entitiesDir, 0o755);
      }
    },
  );
});
