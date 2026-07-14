import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CoreRegistry,
  createInMemoryCoreRegistry,
  memoryEmbeddingsSidecarPath,
} from "@megasaver/core";
import { writeVectors } from "@megasaver/embeddings";
import type { MemoryEntryId, ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetRelevantMemories } from "../../src/tools/get-relevant-memories.js";
import { handleRecall } from "../../src/tools/recall.js";

vi.mock("@megasaver/daemon", () => ({ getRunningDaemon: vi.fn() }));
import { getRunningDaemon } from "@megasaver/daemon";
const mockGetRunningDaemon = vi.mocked(getRunningDaemon);

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const PREDECESSOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as MemoryEntryId;
const SUCCESSOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as MemoryEntryId;
const OTHER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as MemoryEntryId;
const TS = "2026-06-11T00:00:00.000Z";
const CLOSED_AT = "2026-07-01T00:00:00.000Z";
// Pinned asOf AFTER the close: the predecessor is non-current, the successor
// current — deterministic regardless of the wall clock at test time.
const AS_OF = "2026-07-12T00:00:00.000Z";

const EXPECTED_CHANGED_FROM = {
  title: "use npm",
  closedAt: CLOSED_AT,
  reason: "package manager switched",
};

function seededRegistry(opts?: { predecessorValidTo?: string | null }): CoreRegistry {
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
    id: PREDECESSOR_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    content: "use npm for installs",
    type: "decision",
    title: "use npm",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    validTo: opts?.predecessorValidTo === undefined ? CLOSED_AT : opts.predecessorValidTo,
  });
  registry.createMemoryEntry({
    id: SUCCESSOR_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    content: "use pnpm for installs",
    type: "decision",
    title: "use pnpm",
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
    supersedesId: PREDECESSOR_ID,
    reason: "package manager switched",
  });
  return registry;
}

describe("changedFrom enrichment on MCP recall surfaces", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "mcp-changed-from-"));
    // No daemon → forwardOrFallback runs the inProcess closure under test.
    mockGetRunningDaemon.mockResolvedValue(null);
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("get_relevant_memories (BM25 branch) enriches a hit with a closed predecessor", async () => {
    const registry = seededRegistry();
    const result = await handleGetRelevantMemories(
      { registry },
      { projectId: PROJECT_ID, task: "pnpm installs", asOf: AS_OF },
    );
    const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
    expect(hit).toBeDefined();
    expect(hit?.changedFrom).toEqual(EXPECTED_CHANGED_FROM);
  });

  it("get_relevant_memories carries no changedFrom for a reopened predecessor", async () => {
    const registry = seededRegistry({ predecessorValidTo: null });
    const result = await handleGetRelevantMemories(
      { registry },
      { projectId: PROJECT_ID, task: "pnpm installs", asOf: AS_OF },
    );
    const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
    expect(hit).toBeDefined();
    expect(hit?.changedFrom).toBeUndefined();
  });

  it("get_relevant_memories (semantic branch) enriches too — injected embedFn + vectors", async () => {
    const registry = seededRegistry();
    // Second CURRENT entry with identical lexical text so BM25 ties — only
    // the injected sidecar vectors can produce the [SUCCESSOR, OTHER] order,
    // proving the semantic branch (not BM25 fallback) served the response.
    registry.createMemoryEntry({
      id: OTHER_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      content: "use pnpm for installs",
      type: "decision",
      title: "use pnpm",
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    // Full coverage of the AS_OF-current candidates (the closed predecessor
    // is not a candidate, so it needs no vector).
    writeVectors(memoryEmbeddingsSidecarPath(store, PROJECT_ID), [
      { id: SUCCESSOR_ID, vector: [0.9, 0.1, 0] },
      { id: OTHER_ID, vector: [0, 0, 1] },
    ]);
    const fakeEmbed = async () => [Float32Array.from([1, 0, 0])];
    const result = await handleGetRelevantMemories(
      { registry, storeRoot: store, embedFn: fakeEmbed },
      { projectId: PROJECT_ID, task: "use pnpm", asOf: AS_OF },
    );
    expect(result.memory.map((m) => m.id)).toEqual([SUCCESSOR_ID, OTHER_ID]);
    expect(result.memory[0]?.changedFrom).toEqual(EXPECTED_CHANGED_FROM);
    expect(result.memory[1]?.changedFrom).toBeUndefined();
  });

  it("mega_recall enriches in the inProcess closure and drops the closed predecessor", async () => {
    const registry = seededRegistry();
    const result = await handleRecall(
      { registry, storeRoot: store },
      { sessionId: SESSION_ID, intent: "project setup", asOf: AS_OF },
    );
    const ids = result.memory.map((m) => m.id);
    expect(ids).toContain(SUCCESSOR_ID);
    expect(ids).not.toContain(PREDECESSOR_ID);
    const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
    expect(hit?.changedFrom).toEqual(EXPECTED_CHANGED_FROM);
  });

  it("mega_recall carries no changedFrom for a reopened predecessor", async () => {
    const registry = seededRegistry({ predecessorValidTo: null });
    const result = await handleRecall(
      { registry, storeRoot: store },
      { sessionId: SESSION_ID, intent: "project setup", asOf: AS_OF },
    );
    // Reopened predecessor is recallable again — both rows return, no suffix data.
    expect(result.memory.map((m) => m.id)).toContain(PREDECESSOR_ID);
    const hit = result.memory.find((m) => m.id === SUCCESSOR_ID);
    expect(hit?.changedFrom).toBeUndefined();
  });
});
