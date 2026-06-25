// @vitest-environment node
// Node env required: getRunningDaemon uses AbortSignal.timeout inside Node fetch;
// jsdom's fetch rejects Node-native AbortSignal instances (class mismatch).
import { startDaemonServer } from "@megasaver/daemon";
import type { RunningDaemon } from "@megasaver/daemon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

let server: TestServer;
let daemon: RunningDaemon | null = null;

beforeEach(async () => {
  server = await startTestBridge();
});

afterEach(async () => {
  if (daemon) {
    await daemon.close();
    daemon = null;
  }
  await server.close();
});

describe("GET /api/daemon", () => {
  it("returns {running:false} when no daemon is advertised", async () => {
    const res = await fetch(`${server.baseUrl}/api/daemon`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ running: false });
  });

  it("returns {running:true, url, sessions:0} when a daemon is live", async () => {
    daemon = await startDaemonServer({ storeRoot: server.storePath, port: 0 });
    const res = await fetch(`${server.baseUrl}/api/daemon`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(body.url).toBe(daemon.url);
    expect(body.sessions).toBe(0);
  });

  it("returns 405 for POST /api/daemon", async () => {
    const res = await fetch(`${server.baseUrl}/api/daemon`, { method: "POST" });
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.code).toBe("method_not_allowed");
  });
});
