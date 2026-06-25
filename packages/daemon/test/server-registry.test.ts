import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommandSpawn } from "@megasaver/context-gate";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunningDaemon, startDaemonServer } from "../src/server.js";

const PROJECT_ID = projectIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const SESSION_ID = sessionIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const TS = "2026-06-25T00:00:00.000Z";

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

let storeRoot: string;
let projectRoot: string;
let daemon: RunningDaemon | null;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "daemon-srv-reg-"));
  projectRoot = mkdtempSync(join(tmpdir(), "daemon-srv-reg-proj-"));
  daemon = null;
});

afterEach(async () => {
  await daemon?.close();
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

function seedRegistry() {
  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeRoot });
  registry.createProject({
    id: PROJECT_ID,
    name: "test-project",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "test session",
    startedAt: TS,
    endedAt: null,
  });
}

// ─── auth enforcement ─────────────────────────────────────────────────────────

describe("registry routes — auth enforcement", () => {
  const routes = [
    "/exec-registry",
    "/read-registry",
    "/expand-registry",
    "/recall-registry",
  ] as const;

  for (const route of routes) {
    it(`${route}: 401 on missing token`, async () => {
      daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
      const res = await fetch(`${daemon.url}${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it(`${route}: 401 on wrong token`, async () => {
      daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
      const res = await fetch(`${daemon.url}${route}`, {
        method: "POST",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  }
});

// ─── unknown path ─────────────────────────────────────────────────────────────

describe("registry routes — unknown path", () => {
  it("404 on unknown POST path", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/nonexistent-route`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

// ─── /expand-registry ────────────────────────────────────────────────────────

describe("POST /expand-registry", () => {
  it("400 on invalid body", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/expand-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ chunkId: "0" }), // missing chunkSetId
    });
    expect(res.status).toBe(400);
  });

  it("404 on missing chunk set", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/expand-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ chunkSetId: "no-such-set", chunkId: "0" }),
    });
    expect(res.status).toBe(404);
  });
});

// ─── /recall-registry ────────────────────────────────────────────────────────

describe("POST /recall-registry", () => {
  it("400 on invalid body (non-UUID sessionId)", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/recall-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ sessionId: "not-a-uuid", intent: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when session does not exist", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/recall-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ sessionId: SESSION_ID, intent: "something" }),
    });
    expect(res.status).toBe(404);
  });

  it("200 with memory + chunkSets when session exists", async () => {
    seedRegistry();
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/recall-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ sessionId: SESSION_ID, intent: "what do I know" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { memory: unknown[]; chunkSets: unknown[] };
    expect(Array.isArray(json.memory)).toBe(true);
    expect(Array.isArray(json.chunkSets)).toBe(true);
  });
});

// ─── /exec-registry ──────────────────────────────────────────────────────────

describe("POST /exec-registry", () => {
  it("400 on invalid body (missing sessionId)", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/exec-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ command: "echo" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when session does not exist", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/exec-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        sessionId: SESSION_ID,
        command: "echo",
        args: ["hi"],
        intent: "test",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("200 with excerpts when session exists and command allowed (injected spawn)", async () => {
    seedRegistry();
    // 'ls' is on the allowed-commands list (allowed-commands.ts §9b); 'echo' is not.
    const fakeSpawn = makeFakeSpawn("total 0\ndrwxr-xr-x  2 user user  40 Jan  1 00:00 .");
    daemon = await startDaemonServer({
      storeRoot,
      port: 0,
      token: "secret",
      spawn: fakeSpawn,
      now: () => TS,
    });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/exec-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        sessionId: SESSION_ID,
        command: "ls",
        args: ["-la"],
        intent: "list files",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { excerpts: unknown[] };
    expect(Array.isArray(json.excerpts)).toBe(true);
    expect(fakeSpawn).toHaveBeenCalled();
  });

  it("search-via-exec parity: POST command:grep → 200 with excerpts (no separate /search-registry needed)", async () => {
    seedRegistry();
    writeFileSync(join(projectRoot, "hello.txt"), "hello world\n");
    const grepOutput = `${join(projectRoot, "hello.txt")}:1:hello world`;
    const fakeSpawn = makeFakeSpawn(grepOutput);
    daemon = await startDaemonServer({
      storeRoot,
      port: 0,
      token: "secret",
      spawn: fakeSpawn,
      now: () => TS,
    });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/exec-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        sessionId: SESSION_ID,
        command: "grep",
        args: ["-r", "-n", "-e", "hello", "."],
        intent: "search for hello",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { excerpts: unknown[] };
    expect(Array.isArray(json.excerpts)).toBe(true);
  });
});

// ─── /read-registry ───────────────────────────────────────────────────────────

describe("POST /read-registry", () => {
  it("400 on invalid body (missing sessionId)", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/read-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ path: "x.txt", intent: "read" }),
    });
    expect(res.status).toBe(400);
  });

  it("404 when session does not exist", async () => {
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/read-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        sessionId: SESSION_ID,
        path: "hello.txt",
        intent: "read",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("200 for a file inside the project root", async () => {
    seedRegistry();
    writeFileSync(join(projectRoot, "hello.txt"), "hello world from read-registry");
    daemon = await startDaemonServer({ storeRoot, port: 0, token: "secret", now: () => TS });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const res = await fetch(`${daemon.url}/read-registry`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        sessionId: SESSION_ID,
        path: "hello.txt",
        intent: "read the file",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { excerpts: unknown[] };
    expect(Array.isArray(json.excerpts)).toBe(true);
  });
});
