import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

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

  describe("tools router", () => {
    it("returns the route split + registered tools", async () => {
      server = await startTestBridge({
        store: {
          workspaceTools: [
            {
              workspaceKey: KEY,
              lines: [
                {
                  id: "00000000-0000-4000-8000-0000000000d1",
                  projectId: BLOCK_PROJECT_ID,
                  name: "git status",
                  description: "show working tree status",
                  category: "git",
                  risk: "safe",
                  inputSchema: null,
                  outputSchema: null,
                  keywords: ["git", "status"],
                  createdAt: "2026-06-14T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/tools`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { route: { reason: string }; tools: unknown[] };
      expect(body.tools).toHaveLength(1);
      expect(typeof body.route.reason).toBe("string");
    });

    it("places a dangerous tool in blockedTools", async () => {
      server = await startTestBridge({
        store: {
          workspaceTools: [
            {
              workspaceKey: KEY,
              lines: [
                {
                  id: "00000000-0000-4000-8000-0000000000d2",
                  projectId: BLOCK_PROJECT_ID,
                  name: "rm rf",
                  description: "delete everything",
                  category: "dangerous",
                  risk: "dangerous",
                  inputSchema: null,
                  outputSchema: null,
                  keywords: ["delete"],
                  createdAt: "2026-06-14T00:00:00.000Z",
                },
              ],
            },
          ],
        },
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/tools`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { route: { blockedTools: { name: string }[] } };
      expect(body.route.blockedTools.map((t) => t.name)).toContain("rm rf");
    });
  });

  describe("context preview", () => {
    it("reports indexed:false with no index and a task", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/context?task=anything`);
      expect(res.status).toBe(200);
      expect((await res.json()).indexed).toBe(false);
    });

    it("returns 400 without a task", async () => {
      server = await startTestBridge();
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/context`);
      expect(res.status).toBe(400);
    });

    it("returns pack + audit with a seeded index", async () => {
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
      const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/context?task=foo`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.indexed).toBe(true);
      expect(body.pack).toBeDefined();
      expect(body.audit).toBeDefined();
    });
  });

  describe("permissions evaluation", () => {
    const tmpRoots: string[] = [];

    afterEach(() => {
      for (const r of tmpRoots) rmSync(r, { recursive: true, force: true });
      tmpRoots.length = 0;
    });

    function setup(permissionsYaml: string | null): {
      cwd: string;
      key: string;
      projectsDir: string;
      metaDir: string;
    } {
      const cwd = mkdtempSync(join(tmpdir(), "ws-cwd-"));
      const projectsDir = mkdtempSync(join(tmpdir(), "ws-proj-"));
      const metaDir = mkdtempSync(join(tmpdir(), "ws-meta-"));
      tmpRoots.push(cwd, projectsDir, metaDir);
      if (permissionsYaml !== null) {
        mkdirSync(join(cwd, ".megasaver"), { recursive: true });
        writeFileSync(join(cwd, ".megasaver", "permissions.yaml"), permissionsYaml);
      }
      seedWorkspaceCwd({ projectsDir, metaDir, cwd });
      return { cwd, key: encodeWorkspaceKey(cwd), projectsDir, metaDir };
    }

    it("reports loaded:false when no permissions file exists", async () => {
      const { key, projectsDir, metaDir } = setup(null);
      server = await startTestBridge({
        claudeProjectsDir: projectsDir,
        claudeSessionsMetaDir: metaDir,
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${key}/permissions`);
      expect(res.status).toBe(200);
      expect((await res.json()).loaded).toBe(false);
    });

    it("denies a command listed under deny.commands", async () => {
      const { key, projectsDir, metaDir } = setup("deny:\n  commands: [curl]\n");
      server = await startTestBridge({
        claudeProjectsDir: projectsDir,
        claudeSessionsMetaDir: metaDir,
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${key}/permissions?command=curl`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.loaded).toBe(true);
      expect(body.evaluation.command.allowed).toBe(false);
    });

    it("denies reading a secret path", async () => {
      const { key, projectsDir, metaDir } = setup("deny: {}\n");
      server = await startTestBridge({
        claudeProjectsDir: projectsDir,
        claudeSessionsMetaDir: metaDir,
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${key}/permissions?path=.env`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.evaluation.pathRead.allowed).toBe(false);
    });

    it("returns 500 policy_load_failed for malformed YAML", async () => {
      const { key, projectsDir, metaDir } = setup("deny: [this, is, not, an, object]\n");
      server = await startTestBridge({
        claudeProjectsDir: projectsDir,
        claudeSessionsMetaDir: metaDir,
      });
      const res = await fetch(`${server.baseUrl}/api/workspaces/${key}/permissions`);
      expect(res.status).toBe(500);
      expect((await res.json()).code).toBe("policy_load_failed");
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
