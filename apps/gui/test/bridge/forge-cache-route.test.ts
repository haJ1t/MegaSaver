import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/live-ws-forge";
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

async function start(extra?: Parameters<typeof startTestBridge>[0]) {
  return startTestBridge({
    claudeProjectsDir: projectsDir,
    claudeSessionsMetaDir: metaDir,
    ...extra,
  });
}

describe("FORGE, Firewall & Cache Doctor bridge routes", () => {
  it("GET /api/forge/failures returns failed run patterns", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/forge/failures`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { failures: unknown[] };
    expect(Array.isArray(data.failures)).toBe(true);
  });

  it("GET /api/firewall/status returns firewall status", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/firewall/status`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { enabled: boolean };
    expect(data.enabled).toBe(true);
  });

  it("GET /api/cache/status is honest with no data — zeros with hasData:false", async () => {
    server = await start();
    const res = await fetch(`${server.baseUrl}/api/cache/status`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      cacheHitRatio: number;
      hasData: boolean;
      footnote: string;
      isEstimate: boolean;
    };
    expect(data.hasData).toBe(false);
    expect(data.cacheHitRatio).toBe(0);
    expect(data.isEstimate).toBe(true);
    expect(typeof data.footnote).toBe("string");
  });

  it("GET /api/cache/status reflects real proxy usage — hit ratio computed from file not 0.94 stub", async () => {
    server = await start();
    // write two proxy usage events: creation 4000 + read 6000 => hit ratio 0.6
    const dir = join(server.storePath, "proxy-usage");
    mkdirSync(dir, { recursive: true });
    const row = (read: number, creation: number, id: string) =>
      JSON.stringify({
        id,
        ts: new Date().toISOString(),
        model: "claude-sonnet",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: read,
        cacheCreationTokens: creation,
        messageCount: 1,
        stream: false,
      });
    writeFileSync(
      join(dir, "usage.jsonl"),
      `${row(6000, 4000, "ev1")}\n${row(3000, 1000, "ev2")}\n`,
    );
    const res = await fetch(`${server.baseUrl}/api/cache/status`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      cacheHitRatio: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      proxyCalls: number;
      hasData: boolean;
    };
    expect(data.hasData).toBe(true);
    expect(data.proxyCalls).toBe(2);
    expect(data.cacheReadInputTokens).toBe(9000);
    expect(data.cacheCreationInputTokens).toBe(5000);
    expect(data.cacheHitRatio).toBeCloseTo(9000 / 14000, 6);
    expect(data.cacheHitRatio).not.toBe(0.94);
  });

  it("POST /api/cache/clear truncates the usage log and GET then returns zeros", async () => {
    server = await start();
    const dir = join(server.storePath, "proxy-usage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "usage.jsonl"),
      `${JSON.stringify({
        id: "ev1",
        ts: new Date().toISOString(),
        model: "claude-sonnet",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 5000,
        cacheCreationTokens: 1000,
        messageCount: 1,
        stream: false,
      })}\n`,
    );
    // verify hasData before
    let r = await fetch(`${server.baseUrl}/api/cache/status`);
    expect(((await r.json()) as { hasData: boolean }).hasData).toBe(true);
    const postRes = await fetch(`${server.baseUrl}/api/cache/clear`, { method: "POST" });
    expect(postRes.status).toBe(200);
    const postData = (await postRes.json()) as { cleared: boolean };
    expect(postData.cleared).toBe(true);
    r = await fetch(`${server.baseUrl}/api/cache/status`);
    expect(r.status).toBe(200);
    const after = (await r.json()) as {
      hasData: boolean;
      cacheHitRatio: number;
      cacheReadInputTokens: number;
    };
    expect(after.hasData).toBe(false);
    expect(after.cacheHitRatio).toBe(0);
    expect(after.cacheReadInputTokens).toBe(0);
  });
});
