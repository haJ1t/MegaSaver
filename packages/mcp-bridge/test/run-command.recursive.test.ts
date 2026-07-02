import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleRunCommand } from "../src/tools/run-command.js";

// ponytail: hoisted mock — ensures forward.ts sees the mock regardless of
// module-evaluation order (vitest hoisting contract).
vi.mock("@megasaver/daemon", () => ({ getRunningDaemon: vi.fn() }));
import { getRunningDaemon } from "@megasaver/daemon";
const mockGetRunningDaemon = vi.mocked(getRunningDaemon);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
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

describe("handleRunCommand recursion guard (AA1 §8d step 4, §9a)", () => {
  let store: string;
  let projectRoot: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-rec-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "mcp-rec-root-"));
    mockGetRunningDaemon.mockResolvedValue(null);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("inherited originPid mismatching this process → command_denied: recursive_megasaver", async () => {
    const registry = seededRegistry(projectRoot);
    // originPid is some OTHER pid (not String(process.pid)) and
    // non-empty → the orchestrator's evaluateCommand returns
    // recursive_megasaver (AA1 §9a).
    const foreignPid = String(process.pid + 1);
    await expect(
      handleRunCommand(
        { registry, storeRoot: store, now: () => TS, newId: () => "x", originPid: foreignPid },
        { command: "ls", args: ["-a"], intent: "list", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({
      code: "command_denied",
      details: { reason: "recursive_megasaver" },
    });
  });

  it("daemon reachable but foreign originPid → still command_denied: recursive_megasaver (no forward)", async () => {
    // Regression: the daemon runs under its own pid so evaluateCommand inside the
    // daemon would never fire recursive_megasaver. The guard must fire in the tool
    // BEFORE forwardOrFallback is reached (fixes security bypass, Phase 5b review).
    const daemonRequest = vi.fn();
    mockGetRunningDaemon.mockResolvedValue({
      request: daemonRequest,
      close: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getRunningDaemon>>);

    const registry = seededRegistry(projectRoot);
    const foreignPid = String(process.pid + 1);

    await expect(
      handleRunCommand(
        { registry, storeRoot: store, now: () => TS, newId: () => "x", originPid: foreignPid },
        { command: "ls", args: ["-a"], intent: "list", sessionId: SESSION_ID },
      ),
    ).rejects.toMatchObject({
      code: "command_denied",
      details: { reason: "recursive_megasaver" },
    });

    // Guard must fire before any daemon call.
    expect(daemonRequest).not.toHaveBeenCalled();
  });
});
