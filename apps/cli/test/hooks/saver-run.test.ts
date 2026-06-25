import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemonServer, writeDiscovery } from "@megasaver/daemon";
import type { RunningDaemon } from "@megasaver/daemon";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRecord, renderSaverStdout } from "../../src/hooks/saver-run.js";

// ─── existing renderSaverStdout tests ────────────────────────────────────────

describe("renderSaverStdout", () => {
  it("emits the PostToolUse envelope on compress", () => {
    const s = renderSaverStdout({ updatedToolOutput: { stdout: "X", stderr: "" } });
    expect(JSON.parse(s)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: { stdout: "X", stderr: "" },
      },
    });
  });
  it("emits nothing on passthrough", () => {
    expect(renderSaverStdout({ passthrough: true })).toBe("");
  });
});

// ─── makeRecord tests ─────────────────────────────────────────────────────────

const WS_KEY = encodeWorkspaceKey("/test/proj");
const SESSION_ID = "live-test-1";
// 50 KB — exceeds every budget threshold, triggers compression in-process.
const LARGE_RAW = "X".repeat(50_000);

// Expected chunk directory layout: <storeRoot>/content/<workspaceKey>/<liveSessionId>/
function chunkDir(storeRoot: string): string {
  return join(storeRoot, "content", WS_KEY, SESSION_ID);
}

function baseInput(storeRoot: string) {
  return {
    storeRoot,
    evidenceStoreRoot: storeRoot,
    workspaceKey: WS_KEY,
    liveSessionId: SESSION_ID,
    raw: LARGE_RAW,
    sourceKind: "command" as const,
    label: "echo test",
    mode: "balanced" as const,
    storeRawOutput: true,
  };
}

// Fake daemon response — shape must match RecordOverlayOutputResult.
// Using a sentinel chunkSetId so we can assert the daemon path was taken.
const DAEMON_CHUNK_SET_ID = "daemon-chunk-abc123";
const FAKE_DAEMON_RESPONSE = {
  decision: "compressed",
  chunkSetId: DAEMON_CHUNK_SET_ID,
  rawBytes: 50_000,
  returnedBytes: 100,
  bytesSaved: 49_900,
  savingRatio: 0.998,
  rawTokens: 12_500,
  returnedTokens: 25,
  summary: "stub daemon response",
  excerpts: [],
};

/** Start a stub HTTP server that responds to /status with 200 and /excerpt with the given response. */
async function startStub(opts: {
  storeRoot: string;
  excerptResponse?: { status: number; body: unknown };
}): Promise<{ port: number; close: () => Promise<void> }> {
  const excerptStatus = opts.excerptResponse?.status ?? 200;
  const excerptBody = opts.excerptResponse?.body ?? FAKE_DAEMON_RESPONSE;

  return new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    const s = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (req.method === "GET" && path === "/status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else if (req.method === "POST" && path === "/excerpt") {
        // Drain body so the connection closes cleanly, then reply.
        let _buf = "";
        req.on("data", (chunk: Buffer) => {
          _buf += chunk.toString();
        });
        req.on("end", () => {
          res.writeHead(excerptStatus, { "content-type": "application/json" });
          res.end(JSON.stringify(excerptBody));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      // Stub does not check auth — write a known token into discovery.
      writeDiscovery(opts.storeRoot, {
        port,
        token: "stub-token",
        pid: process.pid,
        startedAt: new Date().toISOString(),
      });
      resolve({ port, close: () => new Promise<void>((res) => s.close(() => res())) });
    });
  });
}

describe("makeRecord", () => {
  let stores: string[];
  let servers: Array<RunningDaemon | { close: () => Promise<void> }>;

  beforeEach(() => {
    stores = [];
    servers = [];
  });

  afterEach(async () => {
    for (const s of servers) await s.close();
    for (const s of stores) rmSync(s, { recursive: true, force: true });
  });

  function tempStore(): string {
    const s = mkdtempSync(join(tmpdir(), "saver-run-"));
    stores.push(s);
    return s;
  }

  it("forwards to the running daemon /excerpt — returns daemon result and does NOT write chunks in-process", async () => {
    // Use a stub server so /excerpt returns instantly (no 1.5s timeout risk).
    // The stub responds with a sentinel chunkSetId we control — if in-process ran
    // instead, it would write to chunkDir and return a different chunkSetId.
    const clientStore = tempStore();
    const stub = await startStub({ storeRoot: clientStore });
    servers.push(stub);

    const record = makeRecord(clientStore);
    const result = await record(baseInput(clientStore));

    // Sentinel: only the daemon path returns DAEMON_CHUNK_SET_ID.
    expect(result.chunkSetId).toBe(DAEMON_CHUNK_SET_ID);
    expect(result.decision).toBe("compressed");

    // In-process was NOT called: it would have written chunks to clientStore/content.
    expect(existsSync(chunkDir(clientStore))).toBe(false);
  });

  it("falls back to in-process recordAndFilterOverlayOutput when no daemon is running", async () => {
    const store = tempStore();
    // No daemon started — discovery file absent.
    const record = makeRecord(store);
    const result = await record(baseInput(store));

    expect(result.decision).toBe("compressed");
    expect(result.rawBytes).toBeGreaterThan(0);
    // In-process wrote chunks to store/content.
    expect(existsSync(chunkDir(store))).toBe(true);
  });

  it("falls back to in-process when the daemon /excerpt returns a non-2xx (never throws)", async () => {
    // Stub returns 503 for /excerpt — the real production failure mode.
    const clientStore = tempStore();
    const stub = await startStub({
      storeRoot: clientStore,
      excerptResponse: { status: 503, body: { error: "unavailable" } },
    });
    servers.push(stub);

    const record = makeRecord(clientStore);
    const result = await record(baseInput(clientStore));

    // In-process fallback ran after 503: chunkSetId is different from sentinel.
    expect(result.decision).toBe("compressed");
    expect(result.chunkSetId).not.toBe(DAEMON_CHUNK_SET_ID);
    expect(result.rawBytes).toBeGreaterThan(0);
    // In-process wrote chunks to clientStore.
    expect(existsSync(chunkDir(clientStore))).toBe(true);
    // Must not throw — reaching here proves it.
  });

  it("real daemon /excerpt: daemon's storeRoot receives chunks (direct HTTP, no hook timeout)", async () => {
    // Test the daemon itself without going through makeRecord's 1.5s timeout.
    // This proves the daemon's excerptHandler uses its own storeRoot, not the client's.
    const daemonStore = tempStore();
    const clientStore = tempStore();

    const daemon = await startDaemonServer({ storeRoot: daemonStore, port: 0 });
    servers.push(daemon);

    // Call /excerpt directly on the daemon — no hook timeout applies.
    const res = await fetch(`${daemon.url}/excerpt`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${daemon.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceKey: WS_KEY,
        liveSessionId: SESSION_ID,
        raw: LARGE_RAW,
        sourceKind: "command",
        label: "echo test",
        mode: "balanced",
        storeRawOutput: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    expect(res.ok).toBe(true);
    const data = (await res.json()) as { decision: unknown; chunkSetId: unknown };
    expect(data.decision).toBe("compressed");
    expect(typeof data.chunkSetId).toBe("string");

    // Daemon wrote chunks to daemonStore, NOT to clientStore (which was never used).
    expect(existsSync(chunkDir(daemonStore))).toBe(true);
    expect(existsSync(chunkDir(clientStore))).toBe(false);
  }, 30_000);
});
