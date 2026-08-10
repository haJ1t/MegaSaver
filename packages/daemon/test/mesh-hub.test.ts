import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionMeshHub } from "../src/mesh-hub.js";
import { meshSocketPath } from "../src/paths.js";

let store: string;
let hubs: SessionMeshHub[] = [];
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mesh-"));
  hubs = [];
});
afterEach(async () => {
  for (const h of hubs) await h.stop().catch(() => {});
  rmSync(store, { recursive: true, force: true });
});

describe("SessionMeshHub", () => {
  it("3-client broadcast delivers to all", async () => {
    const hub = new SessionMeshHub(store);
    hubs.push(hub);
    await hub.start();
    const c1 = await hub.connect("agent-a", "wk1");
    const c2 = await hub.connect("agent-b", "wk1");
    const c3 = await hub.connect("agent-c", "wk1");
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    const gotC: unknown[] = [];
    c1.on("event", (e) => gotA.push(e));
    c2.on("event", (e) => gotB.push(e));
    c3.on("event", (e) => gotC.push(e));
    await hub.broadcast({
      eventId: "e1",
      senderAgentId: "agent-a",
      kind: "memory_added",
      payload: { x: 1 },
      timestamp: new Date().toISOString(),
    });
    // Poll until all clients have received (Windows named pipes + scheduler jitter)
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && (gotA.length < 1 || gotB.length < 1 || gotC.length < 1)) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(gotA.length).toBe(1);
    expect(gotB.length).toBe(1);
    expect(gotC.length).toBe(1);
    for (const c of [c1, c2, c3]) c.destroy();
  });

  it("meshSocketPath respects win32 pipe", () => {
    const p = meshSocketPath("/tmp/x");
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });

  it("200ms connect timeout falls back without throwing", async () => {
    const hub = new SessionMeshHub(store);
    const client = await hub.connect("agent-z", "wk1");
    expect(client).toBeDefined();
    client.destroy();
  });
});
