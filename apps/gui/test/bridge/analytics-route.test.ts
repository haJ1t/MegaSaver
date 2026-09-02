import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-analytics";
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

async function start(extra?: Parameters<typeof startTestBridge>[0]) {
  return startTestBridge({
    claudeProjectsDir: projectsDir,
    claudeSessionsMetaDir: metaDir,
    ...extra,
  });
}

describe("Analytics, Budget & ROI bridge routes", () => {
  it("GET /api/roi is honest without data — zeros with footnote (no 142.5 hardcode)", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/roi`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      savedDollars: number;
      timeSavedHours: number;
      roiRatio: number;
      isEstimate: boolean;
      footnote: string;
      capturedAt: string;
      inputPricePerMTokUsd: number;
    };
    expect(typeof data.savedDollars).toBe("number");
    expect(data.savedDollars).toBe(0);
    expect(data.isEstimate).toBe(true);
    expect(typeof data.footnote).toBe("string");
    expect(data.footnote).toContain("est.");
    expect(typeof data.capturedAt).toBe("string");
    expect(typeof data.inputPricePerMTokUsd).toBe("number");
  });

  it("GET /api/roi reflects seeded store — savedDollars equals headline dollars, not 142.5", async () => {
    const wk = "a".repeat(16);
    const liveId = "sess_roi_proof";
    server = await start({
      store: {
        overlaySummaries: [
          {
            workspaceKey: wk,
            liveSessionId: liveId,
            summary: {
              liveSessionId: liveId,
              eventsTotal: 2,
              rawBytesTotal: 80000,
              returnedBytesTotal: 20000,
              bytesSavedTotal: 60000,
              deltaBytesTotal: 60000,
              savingRatio: 0.75,
              secretsRedactedTotal: 0,
              chunksStoredTotal: 0,
              updatedAt: new Date().toISOString(),
            },
          },
        ],
      },
    });
    const res = await fetch(`${server.baseUrl}/api/roi`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { savedDollars: number };
    // With 60k bytes saved = 15k tokens at 4B/tok, $3/M => 0.045
    expect(data.savedDollars).not.toBe(142.5);
    expect(data.savedDollars).toBeGreaterThan(0);
    // Independent recompute via same pricing invariant
    const { computeSavingsHeadline, readAllWorkspaceTokenSaverTotals } = await import(
      "@megasaver/stats"
    );
    const totals = readAllWorkspaceTokenSaverTotals({ root: server.storePath });
    const headline = computeSavingsHeadline(totals);
    expect(data.savedDollars).toBeCloseTo(headline.dollarsSaved, 6);
  });

  it("GET & POST & DELETE /api/savings/budget manages token budget limits", async () => {
    server = await start();
    const getRes = await fetch(`${server.baseUrl}/api/savings/budget`);
    expect(getRes.status).toBe(200);
    const getData = (await getRes.json()) as { status: string; monthlyBudgetTokens: number };
    expect(getData.status).toBe("absent");

    const postRes = await fetch(`${server.baseUrl}/api/savings/budget`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyBudgetTokens: 1000000 }),
    });
    expect(postRes.status).toBe(200);
    const postData = (await postRes.json()) as { monthlyBudgetTokens: number; status: string };
    expect(postData.monthlyBudgetTokens).toBe(1000000);
    expect(postData.status).toBe("ok");

    const delRes = await fetch(`${server.baseUrl}/api/savings/budget`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const delData = (await delRes.json()) as { status: string; monthlyBudgetTokens: number };
    expect(delData.status).toBe("absent");
    expect(delData.monthlyBudgetTokens).toBe(0);
  });

  it("POST /api/savings/budget persists across handler recreation (simulated restart)", async () => {
    server = await start();
    const postRes = await fetch(`${server.baseUrl}/api/savings/budget`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monthlyBudgetTokens: 3000000 }),
    });
    expect(postRes.status).toBe(200);
    const storePath = server.storePath;
    const homePath = (server as unknown as { homePath?: string }).homePath;
    // Recreate bridge with SAME storePath to simulate restart — use helper's second-arg reuse would be ideal,
    // so instead verify the file is on disk and a new reader sees it.
    const { readBudget } = await import("@megasaver/stats");
    const stored = readBudget(storePath);
    expect(stored).not.toBeNull();
    expect(stored?.amount).toBe(3000000);
  });

  it("POST /api/savings/budget validates positive number", async () => {
    server = await start();
    for (const bad of [0, -1, "x", null, {}]) {
      const r = await fetch(`${server.baseUrl}/api/savings/budget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ monthlyBudgetTokens: bad }),
      });
      expect(r.status).toBe(400);
    }
  });

  it("GET /api/savings/budget surfaces corrupt as 200 { status: corrupt }", async () => {
    server = await start();
    const p = join(server.storePath, "stats", "budget.json");
    mkdirSync(join(server.storePath, "stats"), { recursive: true });
    writeFileSync(p, "{ this is not json");
    const r = await fetch(`${server.baseUrl}/api/savings/budget`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { status: string };
    expect(j.status).toBe("corrupt");
  });

  it("GET /api/alerts returns honest { hasData: false } shape", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/alerts`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      hasData: boolean;
      spikes: unknown[];
      firewallAlerts: unknown[];
    };
    expect(data.hasData).toBe(false);
    expect(Array.isArray(data.spikes)).toBe(true);
    expect(Array.isArray(data.firewallAlerts)).toBe(true);
  });

  it("GET /api/bench/report returns honest { hasData: false } shape", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/bench/report`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { hasData: boolean; savingsPercentage: unknown };
    expect(data.hasData).toBe(false);
    expect(data.savingsPercentage).toBeNull();
  });
});
