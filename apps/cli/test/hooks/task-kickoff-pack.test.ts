import type { ContextPack } from "@megasaver/context-pruner";
import type { MemoryEntry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import {
  TASK_KICKOFF_TOKEN_CAP,
  renderTaskKickoffPack,
} from "../../src/hooks/task-kickoff-pack.js";

const NOW = "2026-08-01T00:00:00.000Z";

function memoryId(value: string): MemoryEntry["id"] {
  return value as MemoryEntry["id"];
}

function memory(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: memoryId("11111111-1111-4111-8111-111111111111"),
    projectId: "22222222-2222-4222-8222-222222222222",
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "use session store",
    content: "use session store. function secretImplementation() {}",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as MemoryEntry;
}

const verified = memory({
  lastVerified: { headSha: "abc", at: NOW, result: "verified", closedByCodeTruth: false },
});
const healed = memory({
  id: memoryId("33333333-3333-4333-8333-333333333333"),
  title: "heal auth fallback",
  lastVerified: { headSha: "def", at: NOW, result: "healed", closedByCodeTruth: false },
});
const unanchored = memory({
  id: memoryId("44444444-4444-4444-8444-444444444444"),
  title: "unanchored memory",
});
const contradicted = memory({
  id: memoryId("55555555-5555-4555-8555-555555555555"),
  title: "contradicted memory",
  lastVerified: { headSha: "ghi", at: NOW, result: "contradicted", closedByCodeTruth: true },
});
const stale = memory({
  id: memoryId("66666666-6666-4666-8666-666666666666"),
  title: "stale memory",
  stale: true,
  lastVerified: { headSha: "jkl", at: NOW, result: "verified", closedByCodeTruth: false },
});

const contextPack = {
  task: "repair auth",
  included: [
    {
      blockId: "auth",
      filePath: "src/auth.ts",
      startLine: 10,
      endLine: 32,
      blockType: "function",
      name: "authenticate",
      score: 1,
      reasons: ["named in task"],
      factors: {
        semanticRelevance: 1,
        embeddingRelevance: 0,
        dependencyRelevance: 0,
        coChangeRelevance: 0,
        testFailureRelevance: 0,
        recentEditRelevance: 0,
        memoryRelevance: 0,
        userMentionRelevance: 1,
        stalePenalty: 0,
        noisePenalty: 0,
      },
    },
    {
      blockId: "auth-test",
      filePath: "test/auth.test.ts",
      startLine: 4,
      endLine: 27,
      blockType: "function",
      score: 0.9,
      reasons: ["failing test evidence"],
      factors: {
        semanticRelevance: 0.9,
        embeddingRelevance: 0,
        dependencyRelevance: 0,
        coChangeRelevance: 0,
        testFailureRelevance: 1,
        recentEditRelevance: 0,
        memoryRelevance: 0,
        userMentionRelevance: 0,
        stalePenalty: 0,
        noisePenalty: 0,
      },
    },
  ],
  excluded: [],
  budget: { maxTokens: null, usedTokens: 0, blocksConsidered: 2 },
} as ContextPack;

const input = {
  projectName: "demo",
  task: "repair auth",
  now: NOW,
  memories: [verified, healed, unanchored, contradicted, stale],
  contextPack,
};

describe("renderTaskKickoffPack", () => {
  it("renders only code-truth-verified current memories and candidate metadata", async () => {
    const pack = await renderTaskKickoffPack({
      ...input,
      count: async (text) => text.split(/\s+/).length,
    });

    expect(pack?.text).toContain("[decision] use session store");
    expect(pack?.text).toContain("src/auth.ts:10-32");
    expect(pack?.text).not.toContain(unanchored.title);
    expect(pack?.text).not.toContain(contradicted.title);
    expect(pack?.text).not.toContain(stale.title);
    expect(pack?.text).not.toContain("function secretImplementation");
  });

  it("is byte-stable and never exceeds the measured hard cap", async () => {
    const largeInput = {
      ...input,
      memories: Array.from({ length: 8 }, (_, index) =>
        memory({
          id: memoryId(`${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`),
          title: `memory ${index}`,
          lastVerified: { headSha: "abc", at: NOW, result: "verified", closedByCodeTruth: false },
        }),
      ),
    };
    const count = async (text: string) => text.length;

    const first = await renderTaskKickoffPack({ ...largeInput, count });
    const second = await renderTaskKickoffPack({ ...largeInput, count });

    expect(first).toEqual(second);
    expect(first?.tokenCount).toBeLessThanOrEqual(TASK_KICKOFF_TOKEN_CAP);
  });

  it("returns null when counting fails", async () => {
    await expect(
      renderTaskKickoffPack({
        ...input,
        count: async () => Promise.reject(new Error("encoder")),
      }),
    ).resolves.toBeNull();
  });
});
