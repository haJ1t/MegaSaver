import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startCaptureProxy } from "../src/capture-proxy.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bench-capture-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("startCaptureProxy", () => {
  it("writes each /v1/messages body verbatim, in order, and forwards the upstream response", async () => {
    // Fake upstream: echoes a fixed body so the test needs no network.
    const upstream = await startFakeUpstream('{"ok":true}');
    const proxy = await startCaptureProxy({ port: 0, upstream: upstream.url, outDir: dir });
    try {
      const bodies = [
        { model: "m", messages: [{ role: "user", content: "one" }] },
        { model: "m", messages: [{ role: "user", content: "two" }] },
      ];
      for (const b of bodies) {
        const res = await fetch(`${proxy.url}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
        });
        expect(await res.text()).toBe('{"ok":true}');
      }
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort();
      expect(files).toEqual(["req-001.json", "req-002.json"]);
      expect(JSON.parse(readFileSync(join(dir, "req-001.json"), "utf8"))).toEqual(bodies[0]);
      expect(JSON.parse(readFileSync(join(dir, "req-002.json"), "utf8"))).toEqual(bodies[1]);
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });

  it("ignores non-/v1/messages paths (no recording, still forwards)", async () => {
    const upstream = await startFakeUpstream('{"pong":1}');
    const proxy = await startCaptureProxy({ port: 0, upstream: upstream.url, outDir: dir });
    try {
      await fetch(`${proxy.url}/v1/models`);
      expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual([]);
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });

  it("returns 502 instead of hanging when upstream is unreachable", async () => {
    // Port 0 never accepts connections; fetch to it rejects immediately.
    const proxy = await startCaptureProxy({ port: 0, upstream: "http://127.0.0.1:0", outDir: dir });
    try {
      const res = await fetch(`${proxy.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [] }),
      });
      expect(res.status).toBe(502);
    } finally {
      await proxy.stop();
    }
  });
});

// Minimal in-process upstream so these tests never touch the network.
async function startFakeUpstream(body: string) {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
