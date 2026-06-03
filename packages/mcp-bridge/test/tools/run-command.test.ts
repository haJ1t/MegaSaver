import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRunCommand } from "../../src/tools/run-command.js";

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
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
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
});
