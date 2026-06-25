import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRunCommand } from "../../src/tools/run-command.js";

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

describe("handleRunCommand", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-run-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-run-root-"));
    // Default: no daemon → existing tests run in-process.
    mockGetRunningDaemon.mockResolvedValue(null);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // originPid === String(process.pid) → root MegaSaver, no
  // re-entry (AA1 §9a). Use an allow-listed command (`ls`, AA1
  // §9b); `echo` is a shell builtin and NOT in ALLOWED_COMMANDS.
  it("returns a filtered command result for an allowed command", async () => {
    const registry = seededRegistry(projectRoot);
    const result = await handleRunCommand(
      {
        registry,
        storeRoot: store,
        now: () => TS,
        newId: () => "cs-run",
        originPid: String(process.pid),
      },
      { command: "ls", args: ["-a"], intent: "see output", sessionId: SESSION_ID },
    );
    expect(result.rawBytes).toBeGreaterThanOrEqual(0);
    expect(result.chunkSetId).toBeDefined();
  });

  it("throws command_denied carrying details.reason (the PolicyDenyCode) for a denied command", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleRunCommand(
        {
          registry,
          storeRoot: store,
          now: () => TS,
          newId: () => "x",
          originPid: String(process.pid),
        },
        { command: "rm", args: ["-rf", "/"], intent: "x", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({
      code: "command_denied",
      // F1: BB7b returns `code` (PolicyDenyCode); the adapter maps
      // it to `details.reason`. rm -rf / → dangerous_pattern (§9c).
      details: { reason: "dangerous_pattern" },
    });
  });

  it("throws policy_load_failed for a present-but-malformed permissions.yaml (fail-closed, I3)", async () => {
    const registry = seededRegistry(projectRoot);
    // Unclosed flow sequence ⇒ a YAML syntax error ⇒ the loader throws ⇒ the
    // orchestrator denies the run BEFORE any spawn. ls is allow-listed, so
    // absent the malformed file this would run — the denial is purely the
    // fail-closed permissions load.
    await mkdir(join(projectRoot, ".megasaver"), { recursive: true });
    await writeFile(
      join(projectRoot, ".megasaver", "permissions.yaml"),
      "deny:\n  commands: [oops",
    );
    await expect(
      handleRunCommand(
        {
          registry,
          storeRoot: store,
          now: () => TS,
          newId: () => "x",
          originPid: String(process.pid),
        },
        { command: "ls", args: [], intent: "see output", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "policy_load_failed" });
  });

  it("throws intent_required when intent is empty", async () => {
    const registry = seededRegistry(projectRoot);
    await expect(
      handleRunCommand(
        {
          registry,
          storeRoot: store,
          now: () => TS,
          newId: () => "x",
          originPid: String(process.pid),
        },
        { command: "ls", args: [], intent: "", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "intent_required" });
  });

  // ─── daemon-forward cases ─────────────────────────────────────────────────────

  it("returns daemon ExecResult as-is when daemon is present", async () => {
    const daemonResult = {
      chunkSetId: "cs-daemon",
      rawBytes: 200,
      returnedBytes: 100,
      bytesSaved: 100,
      savingRatio: 0.5,
      rawTokens: 50,
      returnedTokens: 25,
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

    // Registry has no session — in-process would throw session_not_found.
    // originPid must be the root (String(process.pid)) so the recursion guard passes.
    const registry = createInMemoryCoreRegistry();
    const result = await handleRunCommand(
      {
        registry,
        storeRoot: store,
        now: () => TS,
        newId: () => "x",
        originPid: String(process.pid),
      },
      { command: "ls", args: ["-a"], intent: "see files", sessionId: SESSION_ID },
    );

    expect(result).toEqual(daemonResult);
    const [method, path, body] = handle.request.mock.calls[0] as [string, string, unknown];
    expect(method).toBe("POST");
    expect(path).toBe("/exec-registry");
    expect((body as Record<string, unknown>).sessionId).toBe(SESSION_ID);
    expect((body as Record<string, unknown>).command).toBe("ls");
    // maxBytes is absent when caller didn't specify (daemon uses its own default)
    expect((body as Record<string, unknown>).maxBytes).toBeUndefined();
  });

  it("falls back to in-process on daemon non-2xx (command_denied re-derived)", async () => {
    const handle = {
      url: "http://127.0.0.1:1",
      token: "t",
      request: vi.fn().mockResolvedValue(new Response("{}", { status: 400 })),
    };
    mockGetRunningDaemon.mockResolvedValue(handle);

    const registry = seededRegistry(projectRoot);
    // rm -rf / is denied → in-process throws command_denied
    await expect(
      handleRunCommand(
        {
          registry,
          storeRoot: store,
          now: () => TS,
          newId: () => "x",
          originPid: String(process.pid),
        },
        { command: "rm", args: ["-rf", "/"], intent: "cleanup", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({ code: "command_denied" });
  });
});
