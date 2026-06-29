import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommandSpawn } from "@megasaver/context-gate";
import { persistChunkSet } from "@megasaver/context-gate";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  execRegistryHandler,
  expandRegistryHandler,
  readRegistryHandler,
  recallRegistryHandler,
} from "../src/handlers-registry.js";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_ID = projectIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const SESSION_ID = sessionIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const TS = "2026-06-25T00:00:00.000Z";
const TS2 = "2026-06-25T00:00:01.000Z";

let storeRoot: string;
let projectRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "daemon-reg-handlers-"));
  // projectRoot must exist so the permissions loader can stat it;
  // no permissions.yaml → allow-all default.
  projectRoot = mkdtempSync(join(tmpdir(), "daemon-reg-proj-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Seed a project + session into a JsonDirectoryCoreRegistry at storeRoot. */
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
  return registry;
}

// ─── spawn helpers ────────────────────────────────────────────────────────────

function makeFakeSpawn(stdout: string, exitCode = 0): RunCommandSpawn {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
    const ee = new EventEmitter() as ReturnType<RunCommandSpawn>;
    const stdoutEm = new EventEmitter() as NodeJS.ReadableStream;
    const stderrEm = new EventEmitter() as NodeJS.ReadableStream;
    (ee as unknown as { stdout: unknown; stderr: unknown }).stdout = stdoutEm;
    (ee as unknown as { stdout: unknown; stderr: unknown }).stderr = stderrEm;
    (ee as unknown as { kill: (sig?: string) => boolean }).kill = () => true;
    setImmediate(() => {
      stdoutEm.emit("data", Buffer.from(stdout));
      ee.emit("close", exitCode);
    });
    return ee;
  }) as unknown as RunCommandSpawn;
}

function makeThrowingSpawn(): RunCommandSpawn {
  return vi.fn(() => {
    throw new Error("spawn must NOT be called in this test");
  }) as unknown as RunCommandSpawn;
}

// ─── expandRegistryHandler ────────────────────────────────────────────────────

describe("expandRegistryHandler", () => {
  it("400s on invalid body (missing chunkSetId)", async () => {
    const res = await expandRegistryHandler(storeRoot, { chunkId: "0" });
    expect(res.status).toBe(400);
  });

  it("400s on path-traversal chunkSetId", async () => {
    const res = await expandRegistryHandler(storeRoot, { chunkSetId: "../escape", chunkId: "0" });
    expect(res.status).toBe(400);
  });

  it("400s on path-traversal chunkId", async () => {
    const res = await expandRegistryHandler(storeRoot, {
      chunkSetId: "valid-id",
      chunkId: "../escape",
    });
    expect(res.status).toBe(400);
  });

  it("404s on a missing chunk set", async () => {
    const res = await expandRegistryHandler(storeRoot, {
      chunkSetId: "does-not-exist",
      chunkId: "0",
    });
    expect(res.status).toBe(404);
  });

  it("200s and returns the chunk for a seeded chunk set", async () => {
    await persistChunkSet({
      storeRoot,
      chunkSetId: "cs-001",
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: TS,
      path: "test.txt",
      result: {
        decision: "compressed",
        rawBytes: 100,
        returnedBytes: 50,
        bytesSaved: 50,
        savingRatio: 0.5,
        rawTokens: 25,
        returnedTokens: 12,
        excerpts: [{ id: "0", text: "hello chunk content", startLine: 1, endLine: 1, score: 1 }],
        summary: "test",
      },
    });

    const res = await expandRegistryHandler(storeRoot, { chunkSetId: "cs-001", chunkId: "0" });
    expect(res.status).toBe(200);
    expect((res.json.chunk as { text: string }).text).toContain("hello chunk content");
  });

  it("404s on a missing chunk within an existing chunk set", async () => {
    await persistChunkSet({
      storeRoot,
      chunkSetId: "cs-002",
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      createdAt: TS,
      path: "test.txt",
      result: {
        decision: "compressed",
        rawBytes: 100,
        returnedBytes: 50,
        bytesSaved: 50,
        savingRatio: 0.5,
        rawTokens: 25,
        returnedTokens: 12,
        excerpts: [{ id: "0", text: "only chunk", startLine: 1, endLine: 1, score: 1 }],
        summary: "test",
      },
    });
    const res = await expandRegistryHandler(storeRoot, {
      chunkSetId: "cs-002",
      chunkId: "no-such-chunk",
    });
    expect(res.status).toBe(404);
  });
});

// ─── recallRegistryHandler ────────────────────────────────────────────────────

describe("recallRegistryHandler", () => {
  it("400s on invalid body (missing sessionId)", async () => {
    const res = await recallRegistryHandler(storeRoot, { intent: "test" });
    expect(res.status).toBe(400);
  });

  it("400s on a non-UUID sessionId (path-traversal guard via sessionIdSchema)", async () => {
    const res = await recallRegistryHandler(storeRoot, {
      sessionId: "not-a-uuid",
      intent: "test",
    });
    expect(res.status).toBe(400);
  });

  it("404s when the session does not exist in the registry", async () => {
    const res = await recallRegistryHandler(storeRoot, {
      sessionId: SESSION_ID,
      intent: "something",
    });
    expect(res.status).toBe(404);
  });

  it("200s with empty memory + chunkSets when session exists but nothing is approved", async () => {
    const registry = seedRegistry();
    registry.createMemoryEntry({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      content: "suggested note (not approved)",
      type: "decision",
      scope: "session",
      title: "Suggested note",
      keywords: [],
      approval: "suggested",
      source: "agent",
      confidence: "high",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });

    const res = await recallRegistryHandler(storeRoot, {
      sessionId: SESSION_ID,
      intent: "relevant stuff",
    });
    expect(res.status).toBe(200);
    expect(res.json.memory).toEqual([]);
    expect(res.json.chunkSets).toEqual([]);
  });

  it("returns only approved same-session + project-scoped memory, filters others", async () => {
    const registry = seedRegistry();

    const OTHER_SESSION_ID = sessionIdSchema.parse("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    registry.createSession({
      id: OTHER_SESSION_ID,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "other session",
      startedAt: TS2,
      endedAt: null,
    });

    // approved same-session → included
    registry.createMemoryEntry({
      id: "e0000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      content: "approved same-session",
      type: "decision",
      scope: "session",
      title: "Approved same-session",
      keywords: [],
      approval: "approved",
      source: "agent",
      confidence: "high",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    // approved project-scope → included (sessionId must be null for project scope)
    registry.createMemoryEntry({
      id: "e0000000-0000-4000-8000-000000000002",
      projectId: PROJECT_ID,
      sessionId: null,
      content: "approved project-scope",
      type: "decision",
      scope: "project",
      title: "Approved project-scope",
      keywords: [],
      approval: "approved",
      source: "agent",
      confidence: "high",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    // approved other-session session-scope → excluded
    registry.createMemoryEntry({
      id: "e0000000-0000-4000-8000-000000000003",
      projectId: PROJECT_ID,
      sessionId: OTHER_SESSION_ID,
      content: "approved other-session-scope (excluded)",
      type: "decision",
      scope: "session",
      title: "Approved other-session-scope",
      keywords: [],
      approval: "approved",
      source: "agent",
      confidence: "high",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    // rejected same-session → excluded
    registry.createMemoryEntry({
      id: "e0000000-0000-4000-8000-000000000004",
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      content: "rejected note (excluded)",
      type: "decision",
      scope: "session",
      title: "Rejected note",
      keywords: [],
      approval: "rejected",
      source: "agent",
      confidence: "high",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });

    const res = await recallRegistryHandler(storeRoot, {
      sessionId: SESSION_ID,
      intent: "relevant stuff",
    });
    expect(res.status).toBe(200);
    const memory = res.json.memory as Array<{ content: string }>;
    const contents = memory.map((m) => m.content);
    expect(contents).toContain("approved same-session");
    expect(contents).toContain("approved project-scope");
    expect(contents).not.toContain("approved other-session-scope (excluded)");
    expect(contents).not.toContain("rejected note (excluded)");
    expect(memory).toHaveLength(2);
  });
});

// ─── execRegistryHandler ─────────────────────────────────────────────────────

const BASE_EXEC = {
  sessionId: SESSION_ID as string,
  // 'echo' is NOT on the allow-list; 'ls' is (allowed-commands.ts §9b)
  command: "ls",
  args: ["-la"],
  intent: "list files",
};

describe("execRegistryHandler", () => {
  it("400s on invalid body (missing sessionId)", async () => {
    const res = await execRegistryHandler(storeRoot, {
      command: "echo",
      args: [],
      intent: "x",
    });
    expect(res.status).toBe(400);
  });

  it("400s on a non-UUID sessionId", async () => {
    const res = await execRegistryHandler(storeRoot, {
      ...BASE_EXEC,
      sessionId: "not-a-uuid",
    });
    expect(res.status).toBe(400);
  });

  it("400s when maxBytes exceeds the ceiling (64000)", async () => {
    const res = await execRegistryHandler(storeRoot, {
      ...BASE_EXEC,
      maxBytes: 65_000,
    });
    expect(res.status).toBe(400);
  });

  it("404s when the session does not exist", async () => {
    const res = await execRegistryHandler(storeRoot, BASE_EXEC, {
      spawn: makeThrowingSpawn(),
    });
    expect(res.status).toBe(404);
  });

  it("400s on command_denied without calling spawn", async () => {
    seedRegistry();
    const throwingSpawn = makeThrowingSpawn();
    // 'rm -rf /' is on the built-in block list
    const res = await execRegistryHandler(
      storeRoot,
      {
        sessionId: SESSION_ID as string,
        command: "rm",
        args: ["-rf", "/"],
        intent: "dangerous",
      },
      { spawn: throwingSpawn },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("command_denied");
    expect(throwingSpawn).not.toHaveBeenCalled();
  });

  it("200s with excerpts when session exists and command is allowed", async () => {
    seedRegistry();
    const fakeSpawn = makeFakeSpawn("total 0\ndrwxr-xr-x  2 user user  40 Jan  1 00:00 .");
    let idCounter = 0;
    const res = await execRegistryHandler(storeRoot, BASE_EXEC, {
      spawn: fakeSpawn,
      now: () => TS,
      newId: () => `id-${idCounter++}`,
    });
    expect(res.status).toBe(200);
    expect(fakeSpawn).toHaveBeenCalled();
    expect(Array.isArray(res.json.excerpts)).toBe(true);
  });
});

// ─── readRegistryHandler ──────────────────────────────────────────────────────

describe("readRegistryHandler", () => {
  it("400s on invalid body (missing sessionId)", async () => {
    const res = await readRegistryHandler(storeRoot, { path: "/tmp/x", intent: "x" });
    expect(res.status).toBe(400);
  });

  it("400s on a non-UUID sessionId", async () => {
    const res = await readRegistryHandler(storeRoot, {
      sessionId: "not-a-uuid",
      path: "/tmp/x",
      intent: "x",
    });
    expect(res.status).toBe(400);
  });

  it("404s when the session does not exist", async () => {
    const res = await readRegistryHandler(storeRoot, {
      sessionId: SESSION_ID as string,
      path: "x.txt",
      intent: "x",
    });
    expect(res.status).toBe(404);
  });

  it("400s on a path outside the project root (path_denied or path_unsafe)", async () => {
    seedRegistry();
    const res = await readRegistryHandler(storeRoot, {
      sessionId: SESSION_ID as string,
      path: "/etc/passwd",
      intent: "read secrets",
    });
    expect([400, 502]).toContain(res.status);
  });

  it("502s on a missing file within the project root", async () => {
    seedRegistry();
    const res = await readRegistryHandler(storeRoot, {
      sessionId: SESSION_ID as string,
      path: "no-such-file.txt",
      intent: "read",
    });
    expect(res.status).toBe(502);
  });

  it("200s and returns excerpts for a file inside the project root", async () => {
    seedRegistry();
    writeFileSync(join(projectRoot, "hello.txt"), "hello world content for test");

    let idCounter = 0;
    const res = await readRegistryHandler(
      storeRoot,
      {
        sessionId: SESSION_ID as string,
        path: "hello.txt",
        intent: "read the file",
      },
      {
        now: () => TS,
        newId: () => `rid-${idCounter++}`,
      },
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.excerpts)).toBe(true);
  });

  it("T11: a re-read of an unchanged file returns the unchanged marker via { ...result.result }", async () => {
    seedRegistry();
    writeFileSync(join(projectRoot, "reread.txt"), "hello world content for diff-on-reread test");

    const body = {
      sessionId: SESSION_ID as string,
      path: "reread.txt",
      intent: "read it",
    };

    const first = await readRegistryHandler(storeRoot, body);
    expect(first.status).toBe(200);
    const firstJson = first.json as Record<string, unknown>;
    expect("unchanged" in firstJson).toBe(false);
    const firstChunkSetId = firstJson.chunkSetId as string;
    expect(firstChunkSetId).toBeDefined();

    const second = await readRegistryHandler(storeRoot, body);
    expect(second.status).toBe(200);
    const secondJson = second.json as Record<string, unknown>;
    expect(secondJson.unchanged).toEqual({ priorChunkSetId: firstChunkSetId });
    expect(secondJson.excerpts).toEqual([]);
    expect(typeof secondJson.summary).toBe("string");
    expect(secondJson.summary as string).toContain("unchanged");
  });

  it("200s with decision=outline when outline:true forwarded", async () => {
    seedRegistry();
    writeFileSync(
      join(projectRoot, "multi.ts"),
      [
        "export function alpha() { return 1; }",
        "export function beta() { return 2; }",
        "export function gamma() { return 3; }",
        "export function delta() { return 4; }",
        "export function epsilon() { return 5; }",
      ].join("\n"),
    );
    const res = await readRegistryHandler(
      storeRoot,
      {
        sessionId: SESSION_ID as string,
        path: "multi.ts",
        intent: "get structure",
        outline: true,
      },
      {
        now: () => TS,
        newId: () => "rid-outline",
      },
    );
    expect(res.status).toBe(200);
    expect((res.json as Record<string, unknown>).decision).toBe("outline");
  });

  it("T13-recall: recall still works after a suppressed read wrote read-index.json", async () => {
    seedRegistry();
    writeFileSync(
      join(projectRoot, "reread2.txt"),
      "content for recall regression after read-index",
    );
    const body = { sessionId: SESSION_ID as string, path: "reread2.txt", intent: "read" };
    await readRegistryHandler(storeRoot, body);
    // read-index.json now lives in the session dir; recall must not throw store_corrupt.
    const recall = await recallRegistryHandler(storeRoot, {
      sessionId: SESSION_ID as string,
      intent: "read",
    });
    expect(recall.status).toBe(200);
  });
});
