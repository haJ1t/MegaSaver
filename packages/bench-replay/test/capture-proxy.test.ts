import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { connect } from "node:net";
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

  it("streams the SSE response through as chunks arrive instead of buffering it", async () => {
    // Fake upstream drips 5 SSE chunks 500ms apart. A buffering proxy would
    // hand nothing to the client until all 5 (2000ms+) have arrived.
    const upstream = await startFakeSseUpstream(5, 500);
    const proxy = await startCaptureProxy({ port: 0, upstream: upstream.url, outDir: dir });
    try {
      const start = Date.now();
      const res = await fetch(`${proxy.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [] }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("expected a readable response body");
      const { done, value } = await reader.read();
      const firstChunkAt = Date.now() - start;

      expect(done).toBe(false);
      expect(value).toBeDefined();
      // The upstream needs 2000ms+ to emit all 5 chunks; receiving the first
      // one well before that proves bytes are passed through, not buffered.
      expect(firstChunkAt).toBeLessThan(1500);

      // Drain the rest so the fake upstream's timers can finish cleanly.
      while (!(await reader.read()).done) {
        // draining only
      }
    } finally {
      await proxy.stop();
      await upstream.stop();
    }
  });

  it("keeps serving other requests after a client aborts mid-body", async () => {
    const upstream = await startFakeUpstream('{"ok":true}');
    const proxy = await startCaptureProxy({ port: 0, upstream: upstream.url, outDir: dir });
    try {
      const port = new URL(proxy.url).port;
      await new Promise<void>((resolve) => {
        const socket = connect(Number(port), "127.0.0.1", () => {
          // Content-Length promises 1000 bytes; only a few are ever sent, then
          // the connection is torn down mid-body.
          socket.write(
            "POST /v1/messages HTTP/1.1\r\n" +
              "Host: 127.0.0.1\r\n" +
              "Content-Type: application/json\r\n" +
              "Content-Length: 1000\r\n" +
              "\r\n" +
              '{"partial":',
          );
          setTimeout(() => {
            socket.destroy();
            resolve();
          }, 50);
        });
        socket.on("error", () => resolve());
      });

      // The proxy process must still be alive and serving.
      const res = await fetch(`${proxy.url}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", messages: [] }),
      });
      expect(await res.text()).toBe('{"ok":true}');
    } finally {
      await proxy.stop();
      await upstream.stop();
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

// In-process SSE upstream that writes one chunk every `delayMs`, so tests can
// tell a streaming proxy (client sees chunk N before chunk N+1 is sent) apart
// from a buffering one (client sees nothing until the last chunk lands).
async function startFakeSseUpstream(chunkCount: number, delayMs: number) {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    let sent = 0;
    const timer = setInterval(() => {
      sent += 1;
      res.write(`data: chunk-${sent}\n\n`);
      if (sent >= chunkCount) {
        clearInterval(timer);
        res.end();
      }
    }, delayMs);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
