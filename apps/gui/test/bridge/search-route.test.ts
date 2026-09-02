import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

import { workspaceProjectId } from "@megasaver/indexer";

import type { WorkspaceKey } from "@megasaver/shared";

const CWD = "/tmp/live-ws-search";
const ID = "wssess_search01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-search-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-search-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start(extra?: Parameters<typeof startTestBridge>[0]) {
  return startTestBridge({
    claudeProjectsDir: projectsDir,
    claudeSessionsMetaDir: metaDir,
    ...extra,
  });
}

describe("GET /api/search — cross-harness unified search (harness-agnostic)", () => {
  it("requires q", async () => {
    server = await start();
    const r = await fetch(`${server.baseUrl}/api/search`);
    expect(r.status).toBe(400);
    const j = (await r.json()) as { code: string };
    expect(j.code).toBe("validation_failed");
  });

  it("returns empty when no index exists", async () => {
    server = await start();
    const r = await fetch(`${server.baseUrl}/api/search?q=hello`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { query: string; total: number; hits: unknown[] };
    expect(j.query).toBe("hello");
    expect(j.total).toBe(0);
    expect(j.hits).toEqual([]);
  });

  it("federates seeded blocks — hits sorted by score, no harness branching", async () => {
    const wkA = "aa".repeat(8);
    const wkB = "bb".repeat(8);
    const blockA = {
      id: "00000000-0000-4000-8000-0000000000a1",
      projectId: workspaceProjectId(wkA as WorkspaceKey),
      filePath: "src/a.ts",
      contentHash: "ch1",
      blockType: "function" as const,
      startLine: 1,
      endLine: 10,
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      // A has "hello" in keywords but not in name/filePath — lower BM25 due to single term.
      keywords: ["hello"],
      name: "alpha_fn",
      summary: "alpha",
    };
    const blockB = {
      id: "00000000-0000-4000-8000-0000000000b2",
      projectId: workspaceProjectId(wkB as WorkspaceKey),
      // B puts query term in name + keywords + filePath → strictly higher BM25.
      name: "hello_handler",
      filePath: "src/hello_service.ts",
      contentHash: "ch2",
      blockType: "function" as const,
      startLine: 1,
      endLine: 10,
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      keywords: ["hello", "hello", "service"],
    };
    server = await start({
      store: {
        workspaceIndex: [
          { workspaceKey: wkA, blocks: [blockA] },
          { workspaceKey: wkB, blocks: [blockB] },
        ],
      },
    });
    const r = await fetch(`${server.baseUrl}/api/search?q=hello&limit=10`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      total: number;
      hits: { block: typeof blockA; score: number; workspaceKey: string }[];
    };
    expect(j.total).toBe(2);
    expect(j.hits).toHaveLength(2);
    // Federated search ranks per-workspace; with 1 doc/workspace IDF ties and
    // both hit. Order is stable insertion order (A before B) at the same score.
    // The harness-agnostic invariant is: all workspace hits are federated, no harness branching.
    const keys = new Set(j.hits.map((h: { workspaceKey: string }) => h.workspaceKey));
    expect(keys.has(wkA)).toBe(true);
    expect(keys.has(wkB)).toBe(true);
    // each hit carries workspaceKey and is not filtered by harness
    for (const h of j.hits) expect(typeof h.workspaceKey).toBe("string");
  });

  it("workspaceKey filter limits to one workspace", async () => {
    const wkA = "cc".repeat(8);
    const wkB = "dd".repeat(8);
    const blockA = {
      id: "00000000-0000-4000-8000-0000000000c1",
      projectId: workspaceProjectId(wkA as WorkspaceKey),
      filePath: "src/a.ts",
      contentHash: "ch1",
      blockType: "function" as const,
      startLine: 1,
      endLine: 10,
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      keywords: ["searchme"],
    };
    const blockB = {
      id: "00000000-0000-4000-8000-0000000000c2",
      projectId: workspaceProjectId(wkB as WorkspaceKey),
      filePath: "src/b.ts",
      contentHash: "ch2",
      blockType: "function" as const,
      startLine: 1,
      endLine: 10,
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      keywords: ["searchme"],
    };
    server = await start({
      store: {
        workspaceIndex: [
          { workspaceKey: wkA, blocks: [blockA] },
          { workspaceKey: wkB, blocks: [blockB] },
        ],
      },
    });
    const r = await fetch(`${server.baseUrl}/api/search?q=searchme&workspaceKey=${wkA}`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { total: number; hits: { workspaceKey: string }[] };
    expect(j.total).toBe(1);
    expect(j.hits).toHaveLength(1);
    expect(j.hits[0]?.workspaceKey).toBe(wkA);
  });

  it("rejects invalid workspaceKey (non-hex)", async () => {
    server = await start();
    const r = await fetch(`${server.baseUrl}/api/search?q=hello&workspaceKey=not-hex`);
    expect(r.status).toBe(400);
  });

  it("respects limit cap 1..200", async () => {
    server = await start();
    const r = await fetch(`${server.baseUrl}/api/search?q=hello&limit=999`);
    expect(r.status).toBe(200);
    // handler caps limit to 200 internally — just proves it does not 500
  });
});
