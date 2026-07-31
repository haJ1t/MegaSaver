import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-analytics";
const DIR = "ws-dir";
const ID = "wssess_analytics01";

let projectsDir: string;
let metaDir: string;
let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "live-projects-analytics-"));
  metaDir = mkdtempSync(join(tmpdir(), "live-meta-analytics-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});

afterEach(async () => {
  if (server) await server.close();
});

async function start() {
  return startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
}

describe("Analytics, Budget & ROI bridge routes", () => {
  it("GET /api/roi returns ROI analytics metrics", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/roi`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("savedDollars");
    expect(data).toHaveProperty("timeSavedHours");
    expect(data).toHaveProperty("roiRatio");
  });

  it("GET & POST /api/savings/budget manages token budget limits", async () => {
    server = await start();
    const getRes = await fetch(`${server.baseUrl}/api/savings/budget`);
    expect(getRes.status).toBe(200);

    const postRes = await fetch(`${server.baseUrl}/api/savings/budget`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyBudgetTokens: 1000000 }),
    });
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData.monthlyBudgetTokens).toBe(1000000);
  });

  it("GET /api/alerts returns active anomaly alerts", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/alerts`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.spikes)).toBe(true);
  });
});
