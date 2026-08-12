import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSession } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

let store: string;
let daemon: RunningDaemon | null;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-mesh-"));
  daemon = null;
});
afterEach(async () => {
  await daemon?.close();
  rmSync(store, { recursive: true, force: true });
});

describe("GET /mesh/status", () => {
  it("returns 401 without token", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/mesh/status`);
    expect(res.status).toBe(401);
  });

  it("returns empty peers when no presence", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/mesh/status`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; peers: unknown[] };
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.peers)).toBe(true);
    expect(json.peers).toHaveLength(0);
  });

  it("lists live peers from mesh presence", async () => {
    const wk = encodeWorkspaceKey("/repo");
    registerSession(store, {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working",
      lastSeenAt: new Date().toISOString(),
      workspaceKey: wk,
      cwd: "/repo",
    });
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/mesh/status`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; peers: Array<{ liveSessionId: string }> };
    expect(json.ok).toBe(true);
    expect(json.peers.map((p) => p.liveSessionId)).toContain("a1");
  });

  it("rejects wrong token", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/mesh/status`, {
      headers: { authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });
});
