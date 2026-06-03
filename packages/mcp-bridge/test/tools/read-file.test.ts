import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleReadFile } from "../../src/tools/read-file.js";

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
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
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
});
