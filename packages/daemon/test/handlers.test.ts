import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunCommandSpawn } from "@megasaver/context-gate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { excerptHandler, execHandler, expandHandler, searchHandler } from "../src/handlers.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-handlers-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const bigRaw = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor sit amet`).join(
  "\n",
);

describe("excerptHandler", () => {
  it("400s on an invalid body", async () => {
    const res = await excerptHandler(store, { workspaceKey: "ws" });
    expect(res.status).toBe(400);
  });

  it("compresses + stores a large output and returns a chunkSetId", async () => {
    const res = await excerptHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      raw: bigRaw,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe("compressed");
    expect(typeof res.json.chunkSetId).toBe("string");
    expect(res.json.returnedBytes).toBeLessThan(res.json.rawBytes);
  });

  it("rejects a path-traversal workspaceKey without writing outside the store", async () => {
    const res = await excerptHandler(store, {
      workspaceKey: "../escape",
      liveSessionId: "x",
      raw: bigRaw,
      sourceKind: "command",
      label: "l",
      mode: "aggressive",
      // storeRawOutput:false is the unguarded stats-write path the POC abused.
      storeRawOutput: false,
    });
    expect(res.status).toBe(400);
    expect(existsSync(join(store, "..", "escape"))).toBe(false);
  });
});

describe("expandHandler", () => {
  it("round-trips a stored chunk produced by excerpt", async () => {
    const ex = await excerptHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      raw: bigRaw,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
    });
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: ex.json.chunkSetId,
      chunkId: "0",
    });
    expect(res.status).toBe(200);
    expect(res.json.chunk.text).toContain("line 0");
  });

  it("404s on a missing chunk set", async () => {
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "missing",
      chunkId: "0",
    });
    expect(res.status).toBe(404);
  });

  it("400s on a path-traversal chunkSetId", async () => {
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "..",
      chunkId: "0",
    });
    expect(res.status).toBe(400);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a fake spawn that emits stdout then closes with given exit code. */
function makeFakeSpawn(stdout: string, exitCode = 0): RunCommandSpawn {
  return vi.fn((_cmd: string, _args: string[], _opts: unknown) => {
    const ee = new EventEmitter() as ReturnType<RunCommandSpawn>;
    // Attach stream-like stdout/stderr
    const stdoutEm = new EventEmitter() as NodeJS.ReadableStream;
    const stderrEm = new EventEmitter() as NodeJS.ReadableStream;
    (ee as unknown as { stdout: unknown; stderr: unknown }).stdout = stdoutEm;
    (ee as unknown as { stdout: unknown; stderr: unknown }).stderr = stderrEm;
    (ee as unknown as { kill: (sig?: string) => boolean }).kill = () => true;
    // Emit asynchronously so caller attaches listeners first
    setImmediate(() => {
      stdoutEm.emit("data", Buffer.from(stdout));
      ee.emit("close", exitCode);
    });
    return ee;
  }) as unknown as RunCommandSpawn;
}

/** Build a fake spawn that throws if called (proves spawn-never-called). */
function makeThrowingSpawn(): RunCommandSpawn {
  return vi.fn(() => {
    throw new Error("spawn must NOT be called in this test");
  }) as unknown as RunCommandSpawn;
}

const BASE_EXEC_BODY = {
  workspaceKey: "ws",
  liveSessionId: "live1",
  cwd: "/tmp",
  command: "ls",
  args: [] as string[],
  intent: "list files",
  mode: "aggressive" as const,
  storeRawOutput: true,
};

// ─── execHandler ────────────────────────────────────────────────────────────

describe("execHandler", () => {
  it("400s on an invalid body (missing required fields)", async () => {
    const res = await execHandler(store, { workspaceKey: "ws" });
    expect(res.status).toBe(400);
  });

  it("rejects path-traversal workspaceKey with 400, writes nothing outside store", async () => {
    const throwingSpawn = makeThrowingSpawn();
    const res = await execHandler(
      store,
      { ...BASE_EXEC_BODY, workspaceKey: "../escape" },
      { spawn: throwingSpawn },
    );
    expect(res.status).toBe(400);
    expect(existsSync(join(store, "..", "escape"))).toBe(false);
    expect(throwingSpawn).not.toHaveBeenCalled();
  });

  it("returns command_denied (4xx) for a non-allowlisted command; spawn never called", async () => {
    const throwingSpawn = makeThrowingSpawn();
    const res = await execHandler(
      store,
      { ...BASE_EXEC_BODY, command: "rm", args: ["-rf", "/"] },
      { spawn: throwingSpawn },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("command_denied");
    // Policy gate precedes spawn — spawn must NOT have been invoked
    expect(throwingSpawn).not.toHaveBeenCalled();
  });

  it("returns policy_load_failed (400) on a malformed permissions.yaml; spawn never called", async () => {
    const throwingSpawn = makeThrowingSpawn();
    // Create a temp project dir with a malformed permissions.yaml
    const projectDir = mkdtempSync(join(tmpdir(), "daemon-perm-"));
    mkdirSync(join(projectDir, ".megasaver"));
    writeFileSync(join(projectDir, ".megasaver", "permissions.yaml"), "deny: [invalid: yaml:");
    try {
      const res = await execHandler(
        store,
        { ...BASE_EXEC_BODY, cwd: projectDir },
        { spawn: throwingSpawn },
      );
      expect(res.status).toBe(400);
      expect(typeof res.json.error).toBe("string");
      expect(throwingSpawn).not.toHaveBeenCalled();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("happy path: allowlisted command with injected spawn → 200, compressed result", async () => {
    const bigOutput = Array.from({ length: 500 }, (_, i) => `file${i}.ts`).join("\n");
    const fakeSpawn = makeFakeSpawn(bigOutput);
    const res = await execHandler(
      store,
      { ...BASE_EXEC_BODY, command: "ls", args: [] },
      { spawn: fakeSpawn },
    );
    expect(res.status).toBe(200);
    expect(typeof res.json.chunkSetId).toBe("string");
    expect(res.json.returnedBytes).toBeLessThanOrEqual(res.json.rawBytes as number);
    expect(typeof res.json.decision).toBe("string");
  });

  it("returns 400 if maxReturnedBytes exceeds the ceiling", async () => {
    const res = await execHandler(store, {
      ...BASE_EXEC_BODY,
      maxReturnedBytes: 9_999_999,
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/ceiling/i);
  });

  it("exec happy path → expand recovers the stored chunk", async () => {
    const fakeSpawn = makeFakeSpawn(bigRaw);
    const exRes = await execHandler(
      store,
      { ...BASE_EXEC_BODY, command: "ls", args: [] },
      { spawn: fakeSpawn },
    );
    expect(exRes.status).toBe(200);
    const exJson = exRes.json as { chunkSetId: string };

    const expRes = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: exJson.chunkSetId,
      chunkId: "0",
    });
    expect(expRes.status).toBe(200);
    expect((expRes.json.chunk as { text: string }).text).toContain("line 0");
  });
});

// ─── searchHandler ───────────────────────────────────────────────────────────

const BASE_SEARCH_BODY = {
  workspaceKey: "ws",
  liveSessionId: "live1",
  cwd: "/tmp",
  query: "TODO",
  intent: "find todos",
};

describe("searchHandler", () => {
  it("400s on an invalid body", async () => {
    const res = await searchHandler(store, { workspaceKey: "ws" });
    expect(res.status).toBe(400);
  });

  it("rejects path-traversal workspaceKey with 400; spawn never called", async () => {
    const throwingSpawn = makeThrowingSpawn();
    const res = await searchHandler(
      store,
      { ...BASE_SEARCH_BODY, workspaceKey: "../escape" },
      { spawn: throwingSpawn },
    );
    expect(res.status).toBe(400);
    expect(throwingSpawn).not.toHaveBeenCalled();
  });

  it("rejects absolute path_scope ('/etc') with 400; spawn never called", async () => {
    const throwingSpawn = makeThrowingSpawn();
    const res = await searchHandler(
      store,
      { ...BASE_SEARCH_BODY, path_scope: "/etc" },
      { spawn: throwingSpawn },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/path_scope/i);
    expect(throwingSpawn).not.toHaveBeenCalled();
  });

  it("rejects traversal path_scope ('../x') with 400; spawn never called", async () => {
    const throwingSpawn = makeThrowingSpawn();
    const res = await searchHandler(
      store,
      { ...BASE_SEARCH_BODY, path_scope: "../x" },
      { spawn: throwingSpawn },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/path_scope/i);
    expect(throwingSpawn).not.toHaveBeenCalled();
  });

  it("happy path: grep-style output is grouped by file with chunkSetId", async () => {
    const grepOutput = [
      "src/a.ts:12:TODO fix this",
      "src/a.ts:34:TODO another",
      "src/b.ts:1:TODO third",
    ].join("\n");
    const fakeSpawn = makeFakeSpawn(grepOutput);

    const res = await searchHandler(store, BASE_SEARCH_BODY, { spawn: fakeSpawn });
    expect(res.status).toBe(200);
    const json = res.json as {
      query: string;
      files: Array<{ path: string; matchCount: number }>;
      chunkSetId: string | undefined;
    };
    expect(json.query).toBe("TODO");
    expect(json.files.length).toBe(2);
    expect(json.files[0]?.path).toBe("src/a.ts");
    expect(json.files[0]?.matchCount).toBe(2);
    expect(json.files[1]?.path).toBe("src/b.ts");
    // chunkSetId may be undefined if output was small (passthrough)
    expect(json).toHaveProperty("chunkSetId");
  });
});
