import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const KEY = encodeWorkspaceKey("/tmp/ws-a");
const BLOCK_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function block(over: { id: string; blockType: string; name: string }): unknown {
  return {
    id: over.id,
    projectId: BLOCK_PROJECT_ID,
    filePath: `src/${over.name}.ts`,
    startLine: 1,
    endLine: 1,
    blockType: over.blockType,
    name: over.name,
    contentHash: `hash-${over.name}`,
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: [over.name],
    lastModifiedAt: "2026-06-14T00:00:00.000Z",
  };
}

describe("workspace-scoped bridge routes", () => {
  let server: TestServer;

  afterEach(async () => {
    if (server) await server.close();
  });

  describe("dispatch + validation", () => {
    it("rejects a bad key shape with 400 validation_failed", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/NOTAKEY/rules`);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("validation_failed");
    });

    it("405s a POST to a read-only segment", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/rules`, { method: "POST" });
      expect(res.status).toBe(405);
    });

    it("returns 200 [] for rules on an empty store", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/rules`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe("rules ranking", () => {
    it("ranks a seeded overlay rule for a task", async () => {
      server = await startTestBridge({
        store: {
          workspaceRules: [
            {
              workspaceKey: KEY,
              lines: [
                {
                  id: "00000000-0000-4000-8000-0000000000c1",
                  projectId: BLOCK_PROJECT_ID,
                  title: "no any",
                  rule: "avoid any type",
                  appliesTo: [],
                  evidence: [],
                  severity: "warning",
                  confidence: "high",
                  createdFrom: "manual",
                  createdAt: "2026-06-14T00:00:00.000Z",
                  updatedAt: "2026-06-14T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      });
      const res = await fetch(
        `${server.baseUrl}/api/workspaces/${KEY}/rules?task=${encodeURIComponent("avoid any type")}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { rule: { title: string } }[];
      expect(body[0]?.rule.title).toBe("no any");
    });
  });

  describe("index status + search", () => {
    it("reports indexed:false with no index seeded", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/index`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.indexed).toBe(false);
    });

    it("reports byType counts with a seeded index", async () => {
      server = await startTestBridge({
        store: {
          workspaceIndex: [
            {
              workspaceKey: KEY,
              blocks: [
                block({
                  id: "00000000-0000-4000-8000-0000000000a1",
                  blockType: "function",
                  name: "foo",
                }),
                block({
                  id: "00000000-0000-4000-8000-0000000000a2",
                  blockType: "docs",
                  name: "bar",
                }),
              ],
            },
          ],
        },
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/index`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.indexed).toBe(true);
      expect(body.byType).toEqual({ function: 1, docs: 1 });
    });

    it("search returns hits for a seeded index", async () => {
      server = await startTestBridge({
        store: {
          workspaceIndex: [
            {
              workspaceKey: KEY,
              blocks: [
                block({
                  id: "00000000-0000-4000-8000-0000000000a1",
                  blockType: "function",
                  name: "foo",
                }),
              ],
            },
          ],
        },
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/index/search?q=foo`);
      expect(res.status).toBe(200);
      expect(Array.isArray(await res.json())).toBe(true);
    });

    it("search without a query → 400", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/index/search`);
      expect(res.status).toBe(400);
    });
  });
});
