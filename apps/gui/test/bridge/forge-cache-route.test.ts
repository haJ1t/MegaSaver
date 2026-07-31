import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-forge";
const DIR = "ws-dir";
const ID = "wssess_forge01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-forge-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-forge-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

describe("FORGE, Firewall & Cache Doctor bridge routes", () => {
  it("GET /api/forge/failures returns failed run patterns", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/forge/failures`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.failures)).toBe(true);
  });

  it("GET /api/firewall/status returns firewall status", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/firewall/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.enabled).toBe(true);
  });

  it("GET /api/cache/status & POST /api/cache/clear manages cache doctor", async () => {
    server = await start();
    const getRes = await fetch(`${server.baseUrl}/api/cache/status`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData).toHaveProperty("cacheHitRatio");

    const postRes = await fetch(`${server.baseUrl}/api/cache/clear`, { method: "POST" });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.cleared).toBe(true);
  });
});
