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
});
