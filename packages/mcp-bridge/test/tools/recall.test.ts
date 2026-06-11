import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRecall } from "../../src/tools/recall.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const MEM_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-05-13T00:00:00.000Z";

function seededRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
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
  registry.createMemoryEntry({
    id: MEM_ID,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    scope: "session",
    content: "use pnpm not npm",
    type: "user_preference",
    title: "use pnpm not npm",
    keywords: [],
    confidence: "medium",
    source: "manual",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("handleRecall", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-recall-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("returns session memory and chunk-set summaries", async () => {
    const registry = seededRegistry();
    const dir = join(store, "content", PROJECT_ID, SESSION_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "cs-1.json"),
      JSON.stringify({
        chunkSetId: "cs-1",
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: TS,
        source: { kind: "file", path: "log.txt" },
        rawBytes: 5,
        redacted: true,
        chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
      }),
    );

    const result = await handleRecall(
      { registry, storeRoot: store },
      { sessionId: SESSION_ID, intent: "build tooling" },
    );
    expect(result.memory.map((m) => m.content)).toContain("use pnpm not npm");
    expect(result.chunkSets.map((c) => c.chunkSetId)).toContain("cs-1");
  });

  it("throws session_not_found for an unknown session", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecall(
        { registry, storeRoot: store },
        { sessionId: "33333333-3333-4333-8333-333333333333", intent: "x" },
      ),
    ).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("throws intent_required when intent is empty", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecall({ registry, storeRoot: store }, { sessionId: SESSION_ID, intent: "" }),
    ).rejects.toMatchObject({ code: "intent_required" });
  });
});
