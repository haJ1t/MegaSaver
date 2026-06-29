import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleReadFile } from "../../src/tools/read-file.js";

vi.mock("@megasaver/daemon", () => ({ getRunningDaemon: vi.fn() }));
import { getRunningDaemon } from "@megasaver/daemon";
const mockGetRunningDaemon = vi.mocked(getRunningDaemon);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry(projectRoot: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "demo",
    startedAt: TS,
    endedAt: null,
  });
  return registry;
}

describe("handleReadFile", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-read-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-read-root-"));
    // Default: no daemon → existing tests run in-process.
    mockGetRunningDaemon.mockResolvedValue(null);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("filters an in-sandbox file and returns a result with chunkSetId", async () => {
    const registry = seededRegistry(projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\nerror: boom\nline three\n");
    const result = await handleReadFile(
      { registry, storeRoot: store, now: () => TS, newId: () => "cs-fixed" },
      { path: logPath, intent: "find the error", sessionId: SESSION_ID },
    );
    expect(result.chunkSetId).toBe("cs-fixed");
    expect(result.rawBytes).toBeGreaterThan(0);
  });

  it("returns decision=outline when outline:true is passed", async () => {
    const registry = seededRegistry(projectRoot);
    const srcPath = join(projectRoot, "multi.ts");
    // A file with multiple top-level declarations so the outline path fires.
    await writeFile(
      srcPath,
      [
        "export function alpha() { return 1; }",
        "export function beta() { return 2; }",
        "export function gamma() { return 3; }",
        "export function delta() { return 4; }",
        "export function epsilon() { return 5; }",
      ].join("\n"),
    );
    const result = await handleReadFile(
      { registry, storeRoot: store, now: () => TS, newId: () => "cs-outline" },
      { path: srcPath, intent: "get structure", sessionId: SESSION_ID, outline: true },
    );
    expect(result.decision).toBe("outline");
  });

  it("throws intent_required when intent is empty", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: join(projectRoot, "a.txt"), intent: "", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "intent_required" });
  });

  it("throws session_not_found for an unknown session", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        {
          path: join(projectRoot, "a.txt"),
          intent: "x",
          sessionId: "33333333-3333-4333-8333-333333333333",
        },
      ),
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("throws path_denied for a secret path", async () => {
    const registry = seededRegistry(projectRoot);
    const envPath = join(projectRoot, ".env");
    await writeFile(envPath, "SECRET=1\n");
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: envPath, intent: "peek", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "path_denied" });
  });

  it("throws policy_load_failed for a present-but-malformed permissions.yaml (fail-closed, I3)", async () => {
    const registry = seededRegistry(projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\n");
    await mkdir(join(projectRoot, ".megasaver"), { recursive: true });
    await writeFile(join(projectRoot, ".megasaver", "permissions.yaml"), "deny:\n  read: [oops");
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: logPath, intent: "find the error", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "policy_load_failed" });
  });

  it("throws max_bytes_exceeded above the 64000 ceiling", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: join(projectRoot, "a.txt"), intent: "x", sessionId: SESSION_ID, maxBytes: 70_000 },
      ),
    ).rejects.toMatchObject({ code: "max_bytes_exceeded" });
  });

  it("throws store_write_failed when the stats dir is unwritable", async () => {
    const registry = seededRegistry(projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\n");
    await writeFile(join(store, "stats"), "not a directory");
    await expect(
      handleReadFile(
        { registry, storeRoot: store, now: () => TS, newId: () => "x" },
        { path: logPath, intent: "read it", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "store_write_failed" });
  });

  it("returns daemon FilterOutputResult as-is when daemon present (no maxBytes in body)", async () => {
    const daemonResult = {
      chunkSetId: "cs-from-daemon",
      rawBytes: 100,
      returnedBytes: 50,
      bytesSaved: 50,
      savingRatio: 0.5,
      rawTokens: 25,
      returnedTokens: 12,
      summary: "from daemon",
      excerpts: [],
    };
    const handle = {
      url: "http://127.0.0.1:1",
      token: "t",
      request: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(daemonResult), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    };
    mockGetRunningDaemon.mockResolvedValue(handle);

    // Registry has no session — if in-process ran it would throw session_not_found.
    const registry = createInMemoryCoreRegistry();
    const result = await handleReadFile(
      { registry, storeRoot: store, now: () => TS, newId: () => "x" },
      { path: "/any/path.txt", intent: "find errors", sessionId: SESSION_ID },
    );

    expect(result).toEqual(daemonResult);
    // Verify body sent to daemon has NO maxBytes field (schema is .strict())
    const [method, path, body] = handle.request.mock.calls[0] as [string, string, unknown];
    expect(method).toBe("POST");
    expect(path).toBe("/read-registry");
    expect(body).toEqual({ sessionId: SESSION_ID, path: "/any/path.txt", intent: "find errors" });
    expect((body as Record<string, unknown>).maxBytes).toBeUndefined();
    expect((body as Record<string, unknown>).outline).toBeUndefined();
  });

  it("forwards outline:true in the daemon body when the caller passes it", async () => {
    const daemonResult = {
      chunkSetId: "cs-from-daemon",
      rawBytes: 100,
      returnedBytes: 50,
      bytesSaved: 50,
      savingRatio: 0.5,
      rawTokens: 25,
      returnedTokens: 12,
      summary: "from daemon",
      excerpts: [],
    };
    const handle = {
      url: "http://127.0.0.1:1",
      token: "t",
      request: vi.fn().mockResolvedValue(
        new Response(JSON.stringify(daemonResult), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    };
    mockGetRunningDaemon.mockResolvedValue(handle);

    const registry = createInMemoryCoreRegistry();
    await handleReadFile(
      { registry, storeRoot: store, now: () => TS, newId: () => "x" },
      { path: "/any/path.txt", intent: "get structure", sessionId: SESSION_ID, outline: true },
    );

    const [, , body] = handle.request.mock.calls[0] as [string, string, unknown];
    expect((body as Record<string, unknown>).outline).toBe(true);
  });

  it("falls back to in-process on daemon non-2xx", async () => {
    const handle = {
      url: "http://127.0.0.1:1",
      token: "t",
      request: vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    };
    mockGetRunningDaemon.mockResolvedValue(handle);

    const registry = seededRegistry(projectRoot);
    const logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\n");

    const result = await handleReadFile(
      { registry, storeRoot: store, now: () => TS, newId: () => "cs-fixed" },
      { path: logPath, intent: "find errors", sessionId: SESSION_ID },
    );

    expect(result.chunkSetId).toBe("cs-fixed");
  });
});
