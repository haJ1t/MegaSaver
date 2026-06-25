import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommandSpawn } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDiscovery } from "../src/discovery.js";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

/** Fake spawn emitting stdout then close(0). */
function makeFakeSpawn(stdout: string): RunCommandSpawn {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
    const ee = new EventEmitter() as ReturnType<RunCommandSpawn>;
    const stdoutEm = new EventEmitter() as NodeJS.ReadableStream;
    const stderrEm = new EventEmitter() as NodeJS.ReadableStream;
    (ee as unknown as { stdout: unknown; stderr: unknown }).stdout = stdoutEm;
    (ee as unknown as { stdout: unknown; stderr: unknown }).stderr = stderrEm;
    (ee as unknown as { kill: (sig?: string) => boolean }).kill = () => true;
    setImmediate(() => {
      stdoutEm.emit("data", Buffer.from(stdout));
      ee.emit("close", 0);
    });
    return ee;
  }) as unknown as RunCommandSpawn;
}

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

  it("POST /exec without a token → 401", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/exec`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("POST /exec with token + injected spawn → 200 excerpt shape", async () => {
    const bigOutput = Array.from({ length: 500 }, (_, i) => `file${i}.ts`).join("\n");
    const fakeSpawn = makeFakeSpawn(bigOutput);
    daemon = await startDaemonServer({
      storeRoot: store,
      port: 0,
      token: "secret",
      spawn: fakeSpawn,
    });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/exec`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        cwd: "/tmp",
        command: "ls",
        args: [],
        intent: "list files",
        mode: "aggressive",
        storeRawOutput: true,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { chunkSetId?: string; decision: string; rawBytes: number };
    expect(typeof json.decision).toBe("string");
    expect(typeof json.rawBytes).toBe("number");
  });

  it("POST /search without a token → 401", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/search`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("POST /search with token + injected grep spawn → 200 with files/chunkSetId", async () => {
    const grepOutput = ["src/a.ts:12:TODO fix", "src/b.ts:5:TODO next"].join("\n");
    const fakeSpawn = makeFakeSpawn(grepOutput);
    daemon = await startDaemonServer({
      storeRoot: store,
      port: 0,
      token: "secret",
      spawn: fakeSpawn,
    });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/search`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        cwd: "/tmp",
        query: "TODO",
        intent: "find todos",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      query: string;
      files: Array<{ path: string; matchCount: number }>;
      chunkSetId: string | undefined;
    };
    expect(json.query).toBe("TODO");
    expect(Array.isArray(json.files)).toBe(true);
    expect(json).toHaveProperty("chunkSetId");
  });

  it("/status lists sessions seen via excerpt", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const bigRaw = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum`).join("\n");
    await fetch(`${daemon.url}/excerpt`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        raw: bigRaw,
        sourceKind: "command",
        label: "t",
        mode: "aggressive",
        storeRawOutput: true,
      }),
    });
    const st = (await (
      await fetch(`${daemon.url}/status`, { headers: { authorization: "Bearer secret" } })
    ).json()) as { sessions: Array<{ workspaceKey: string; liveSessionId: string }> };
    expect(st.sessions).toContainEqual({ workspaceKey: "ws", liveSessionId: "live1" });
  });
});
