import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDiscovery } from "../src/discovery.js";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

let store: string;
let daemon: RunningDaemon | null;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-srv-"));
  daemon = null;
});
afterEach(async () => {
  await daemon?.close();
  rmSync(store, { recursive: true, force: true });
});

describe("startDaemonServer", () => {
  it("listens on loopback, advertises discovery, and serves /status with the token", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    expect(daemon.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const disc = readDiscovery(store);
    expect(disc?.port).toBe(daemon.port);
    expect(disc?.token).toBe("secret");

    const ok = await fetch(`${daemon.url}/status`, {
      headers: { authorization: "Bearer secret" },
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
  });

  it("rejects a request with a wrong or missing token (401)", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    expect((await fetch(`${daemon.url}/status`)).status).toBe(401);
    expect(
      (await fetch(`${daemon.url}/status`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
  });

  it("clears discovery on close", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    await daemon.close();
    daemon = null;
    expect(readDiscovery(store)).toBeNull();
  });

  it("excerpt → expand round-trips over HTTP with the token", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const bigRaw = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor`).join("\n");

    const exRes = await fetch(`${daemon.url}/excerpt`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        raw: bigRaw,
        sourceKind: "command",
        label: "run tests",
        mode: "aggressive",
        storeRawOutput: true,
      }),
    });
    expect(exRes.status).toBe(200);
    const ex = (await exRes.json()) as { chunkSetId: string; decision: string };
    expect(ex.decision).toBe("compressed");

    const expRes = await fetch(`${daemon.url}/expand`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        chunkSetId: ex.chunkSetId,
        chunkId: "0",
      }),
    });
    expect(expRes.status).toBe(200);
    const exp = (await expRes.json()) as { chunk: { text: string } };
    expect(exp.chunk.text).toContain("line 0");
  });

  it("excerpt without a token is rejected (401)", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/excerpt`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
});
