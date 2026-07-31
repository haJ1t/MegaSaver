import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-tp";
const DIR = "ws-dir";
const ID = "wssess_tp01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-tp-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-tp-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

describe("Tool Router & Skill Packs bridge routes", () => {
  it("GET /api/tools/router & POST /api/tools/router manages tool allow/block list", async () => {
    server = await start();
    const getRes = await fetch(`${server.baseUrl}/api/tools/router`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(Array.isArray(getData.allowedTools)).toBe(true);

    const postRes = await fetch(`${server.baseUrl}/api/tools/router`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockTool: "danger_execute" }),
    });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.blockedTools).toContain("danger_execute");
  });

  it("GET /api/packs/installed returns skill packs", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/packs/installed`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.packs)).toBe(true);
  });
});
