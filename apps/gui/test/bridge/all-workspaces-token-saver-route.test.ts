import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";

function overlaySummary(overrides: Record<string, unknown> = {}) {
  return {
    liveSessionId: "00000000-0000-4000-8000-000000000000",
    eventsTotal: 5,
    rawBytesTotal: 10000,
    returnedBytesTotal: 2000,
    bytesSavedTotal: 8000,
    savingRatio: 0.8,
    secretsRedactedTotal: 0,
    chunksStoredTotal: 0,
    updatedAt: "2026-07-03T12:00:00.000Z",
    ...overrides,
  };
}

function writeSummary(
  root: string,
  workspaceKey: string,
  liveSessionId: string,
  data: unknown,
): void {
  const dir = join(root, "stats", workspaceKey);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${liveSessionId}.json`), JSON.stringify(data));
}

describe("GET /api/token-saver/all-workspaces", () => {
  let server: Server;
  let baseUrl: string;
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "megasaver-gui-all-ws-"));
    writeSummary(root, "aaaaaaaaaaaaaaaa", "11111111-1111-4111-8111-111111111111", {
      ...overlaySummary({
        liveSessionId: "11111111-1111-4111-8111-111111111111",
        rawBytesTotal: 1000,
        returnedBytesTotal: 200,
        bytesSavedTotal: 800,
      }),
    });
    writeSummary(root, "bbbbbbbbbbbbbbbb", "22222222-2222-4222-8222-222222222222", {
      ...overlaySummary({
        liveSessionId: "22222222-2222-4222-8222-222222222222",
        rawBytesTotal: 9000,
        returnedBytesTotal: 1800,
        bytesSavedTotal: 7200,
      }),
    });

    const handler = createBridgeHandler({ storePath: root });
    server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the summed totals across every workspace", async () => {
    const res = await fetch(`${baseUrl}/api/token-saver/all-workspaces`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bytesSavedTotal: number;
      sessionsCount: number;
      savingRatio: number;
      workspaceCount: number;
    };
    expect(body.workspaceCount).toBe(2);
    expect(body.sessionsCount).toBe(2);
    expect(body.bytesSavedTotal).toBe(8000);
    expect(body.savingRatio).toBeCloseTo(8000 / 10000);
  });

  it("returns zeros when no stats have been recorded", async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "megasaver-gui-empty-"));
    const handler = createBridgeHandler({ storePath: emptyRoot });
    const s = createServer(handler);
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${url}/api/token-saver/all-workspaces`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { bytesSavedTotal: number; workspaceCount: number };
      expect(body.bytesSavedTotal).toBe(0);
      expect(body.workspaceCount).toBe(0);
    } finally {
      await new Promise<void>((resolve) => s.close(() => resolve()));
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("returns 405 for non-GET methods", async () => {
    const res = await fetch(`${baseUrl}/api/token-saver/all-workspaces`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
