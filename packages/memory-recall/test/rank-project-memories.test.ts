import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type MemoryEntry,
  memoryEmbeddingContentHash,
  memoryEmbeddingHashesSidecarPath,
  memoryEmbeddingsSidecarPath,
} from "@megasaver/core";
import { writeVectors } from "@megasaver/embeddings";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { memoryCandidate, projectWorkspaceKey, rankProjectMemories } from "../src/index.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
const NOW = "2026-07-26T00:00:00.000Z";
const roots: string[] = [];

function memory(
  input: Partial<MemoryEntry> & Pick<MemoryEntry, "id" | "title" | "content">,
): MemoryEntry {
  return {
    id: input.id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: input.title,
    content: input.content,
    keywords: input.keywords ?? [],
    confidence: input.confidence ?? "high",
    source: input.source ?? "manual",
    approval: input.approval ?? "approved",
    stale: input.stale ?? false,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
    ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
    ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
    ...(input.tier !== undefined ? { tier: input.tier } : {}),
  };
}

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "megasaver-memory-recall-"));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("LM2 product-memory recall", () => {
  it("returns an empty Safe result without passing an invalid zero limit to Core", async () => {
    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [],
      task: "deployment policy",
      storeRoot: root(),
      query: { text: "deployment policy" },
    });

    expect(result).toMatchObject({ memory: [], hybrid: { profile: "safe" } });
  });

  it("derives a stable opaque workspace key from the project id", () => {
    const key = projectWorkspaceKey(PROJECT_ID);
    expect(key).toMatch(/^[0-9a-f]{16}$/u);
    expect(key).not.toContain(PROJECT_ID);
    expect(key).toBe(projectWorkspaceKey(PROJECT_ID));
  });

  it("binds a candidate digest to the exact title content and keywords projection", () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000010",
      title: "Rotate credentials",
      content: "Rotate deployment credentials before release.",
      keywords: ["deploy", "secret"],
    });

    const candidate = memoryCandidate(entry, projectWorkspaceKey(PROJECT_ID));

    expect(candidate.kind).toBe("memory_entry");
    expect(candidate.text).toContain("Rotate credentials");
    expect(candidate.text).toContain("deploy");
    expect(candidate.sourceDigest).toBe(
      createHash("sha256").update(candidate.text, "utf8").digest("hex"),
    );
  });

  it("keeps a lexical candidate that lacks a vector in partial adaptive recall", async () => {
    const semantic = memory({
      id: "00000000-0000-4000-8000-000000000011",
      title: "Credential rotation",
      content: "Rotate deployment credentials before release.",
    });
    const lexicalOnly = memory({
      id: "00000000-0000-4000-8000-000000000012",
      title: "Release guard",
      content: "Deployment credential rotation requires approval.",
    });
    const storeRoot = root();
    const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID), [{ id: semantic.id, vector }]);
    writeFileSync(
      memoryEmbeddingHashesSidecarPath(storeRoot, PROJECT_ID),
      JSON.stringify({ [semantic.id]: memoryEmbeddingContentHash(semantic) }),
      "utf8",
    );

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [semantic, lexicalOnly],
      task: "deployment credential rotation",
      storeRoot,
      query: { text: "deployment credential rotation" },
      embed: async () => [new Float32Array(vector)],
      now: () => 0,
    });

    expect(result.memory.map((entry) => entry.id)).toContain(lexicalOnly.id);
    expect(result.hybrid).toMatchObject({
      profile: "adaptive",
      semanticStatus: "used_partial_index",
    });
  });

  it("excludes unapproved stale expired and archival entries before ranking", async () => {
    const included = memory({
      id: "00000000-0000-4000-8000-000000000013",
      title: "Current deploy policy",
      content: "deployment policy",
    });
    const excluded = [
      memory({
        id: "00000000-0000-4000-8000-000000000014",
        title: "Suggested",
        content: "deployment policy",
        approval: "suggested",
      }),
      memory({
        id: "00000000-0000-4000-8000-000000000015",
        title: "Stale",
        content: "deployment policy",
        stale: true,
      }),
      memory({
        id: "00000000-0000-4000-8000-000000000016",
        title: "Expired",
        content: "deployment policy",
        validTo: "2026-07-25T00:00:00.000Z",
      }),
      memory({
        id: "00000000-0000-4000-8000-000000000017",
        title: "Archived",
        content: "deployment policy",
        tier: "archival",
      }),
    ];

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [included, ...excluded],
      task: "deployment policy",
      storeRoot: root(),
      query: { text: "deployment policy", asOf: NOW },
      now: () => 0,
    });

    expect(result.memory.map((entry) => entry.id)).toEqual([included.id]);
  });

  it("falls back to Safe ranking when the existing vector sidecar is malformed", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000018",
      title: "Current deploy policy",
      content: "deployment policy",
    });
    const storeRoot = root();
    const sidecarPath = memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID);
    mkdirSync(dirname(sidecarPath), { recursive: true });
    writeFileSync(sidecarPath, "not-json\n", "utf8");

    await expect(
      rankProjectMemories({
        projectId: PROJECT_ID,
        entries: [entry],
        task: "deployment policy",
        storeRoot,
        query: { text: "deployment policy" },
      }),
    ).resolves.toMatchObject({ memory: [entry], hybrid: { profile: "safe" } });
  });

  it("does not use a vector whose saved projection hash predates changed memory text", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000019",
      title: "Deploy policy",
      content: "current deployment policy",
    });
    const storeRoot = root();
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID), [
      { id: entry.id, vector: Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0)) },
    ]);
    writeFileSync(
      join(storeRoot, "memory", `${PROJECT_ID}.embeddings.hashes.json`),
      JSON.stringify({
        [entry.id]: createHash("sha256").update("old projection", "utf8").digest("hex"),
      }),
      "utf8",
    );

    const embedCalls: string[][] = [];
    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [entry],
      task: "deployment policy",
      storeRoot,
      query: { text: "deployment policy" },
      embed: async (texts) => {
        embedCalls.push([...texts]);
        return [new Float32Array(Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0)))];
      },
    });

    expect(result.hybrid.profile).toBe("safe");
    expect(embedCalls).toEqual([]);
  });

  it("uses Adaptive ranking only with a current vector and projection hash", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000020",
      title: "Deploy policy",
      content: "deployment policy requires explicit approval",
    });
    const storeRoot = root();
    const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID), [{ id: entry.id, vector }]);
    writeFileSync(
      memoryEmbeddingHashesSidecarPath(storeRoot, PROJECT_ID),
      JSON.stringify({ [entry.id]: memoryEmbeddingContentHash(entry) }),
      "utf8",
    );

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [entry],
      task: "deployment approval policy",
      storeRoot,
      query: { text: "deployment approval policy" },
      embed: async () => [new Float32Array(vector)],
      now: () => 0,
    });

    expect(result.memory).toEqual([entry]);
    expect(result.hybrid).toMatchObject({ profile: "adaptive", semanticStatus: "used" });
  });

  it("returns a Safe receipt when local embedding fails after current vectors are read", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000021",
      title: "Deploy policy",
      content: "deployment policy requires explicit approval",
    });
    const storeRoot = root();
    const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID), [{ id: entry.id, vector }]);
    writeFileSync(
      memoryEmbeddingHashesSidecarPath(storeRoot, PROJECT_ID),
      JSON.stringify({ [entry.id]: memoryEmbeddingContentHash(entry) }),
      "utf8",
    );

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [entry],
      task: "deployment approval policy",
      storeRoot,
      query: { text: "deployment approval policy" },
      embed: async () => {
        throw new Error("local model unavailable");
      },
      now: () => 0,
    });

    expect(result).toMatchObject({ memory: [entry], hybrid: { profile: "safe" } });
  });

  it("preselects the LM2 window by task relevance rather than newest entries", async () => {
    const irrelevant = Array.from({ length: 1_000 }, (_, index) =>
      memory({
        id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        title: `Unrelated entry ${index}`,
        content: "unrelated memory",
      }),
    );
    const relevant = memory({
      id: "00000000-0000-4000-8000-000000009999",
      title: "Deploy rollback needle",
      content: "Needle memory must remain recallable beyond the newest 1,000 entries.",
    });

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries: [...irrelevant, relevant],
      task: "needle",
      storeRoot: root(),
      query: { text: "needle" },
      now: () => 0,
    });

    expect(result.memory).toEqual([relevant]);
  });

  it("falls back to Core lexical recall when a memory projection exceeds the LM2 limit", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000022",
      title: "Oversized deploy policy",
      content: `needle ${"x".repeat(50_000)}`,
    });

    await expect(
      rankProjectMemories({
        projectId: PROJECT_ID,
        entries: [entry],
        task: "needle",
        storeRoot: root(),
        query: { text: "needle" },
      }),
    ).resolves.toMatchObject({ memory: [entry], hybrid: { profile: "safe" } });
  });

  it("falls back to Core lexical recall when the task exceeds the LM2 limit", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000023",
      title: "Needle policy",
      content: "needle",
    });
    const task = `needle ${"x".repeat(50_000)}`;

    await expect(
      rankProjectMemories({
        projectId: PROJECT_ID,
        entries: [entry],
        task,
        storeRoot: root(),
        query: { text: task },
      }),
    ).resolves.toMatchObject({ memory: [entry], hybrid: { profile: "safe" } });
  });

  it("falls back to Core lexical recall when candidates exceed LM2's UTF-8 corpus limit", async () => {
    const entries = Array.from({ length: 1_000 }, (_, index) =>
      memory({
        id: `00000000-0000-4000-8000-${String(index + 300).padStart(12, "0")}`,
        title: `Needle policy ${index}`,
        content: `needle ${"😀".repeat(16_780)}`,
      }),
    );

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries,
      task: "needle",
      storeRoot: root(),
      query: { text: "needle" },
    });

    expect(result.memory).toHaveLength(20);
    expect(result.hybrid).toMatchObject({ profile: "safe", semanticStatus: "not_requested" });
  });

  it("reads a requested vector from a sidecar with more than 1,000 unrelated rows", async () => {
    const entry = memory({
      id: "00000000-0000-4000-8000-000000000024",
      title: "Needle policy",
      content: "needle",
    });
    const storeRoot = root();
    writeVectors(
      memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID),
      Array.from({ length: 1_001 }, (_, index) => ({
        id: index === 0 ? entry.id : `unrelated-${index}`,
        vector: Array.from({ length: 384 }, (_, vectorIndex) => (vectorIndex === 0 ? 1 : 0)),
      })),
    );
    writeFileSync(
      memoryEmbeddingHashesSidecarPath(storeRoot, PROJECT_ID),
      JSON.stringify({ [entry.id]: memoryEmbeddingContentHash(entry) }),
      "utf8",
    );

    await expect(
      rankProjectMemories({
        projectId: PROJECT_ID,
        entries: [entry],
        task: "needle",
        storeRoot,
        query: { text: "needle" },
        embed: async () => [
          new Float32Array(Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0))),
        ],
      }),
    ).resolves.toMatchObject({ memory: [entry], hybrid: { profile: "adaptive" } });
  });

  it("keeps a recent semantic-only candidate above the lexical window", async () => {
    const semantic = memory({
      id: "00000000-0000-4000-8000-000000000025",
      title: "Semantic candidate",
      content: "vector-only memory",
      createdAt: NOW,
    });
    const entries = [
      semantic,
      ...Array.from({ length: 1_000 }, (_, index) =>
        memory({
          id: `00000000-0000-4000-8000-${String(index + 2_000).padStart(12, "0")}`,
          title: `Older entry ${index}`,
          content: "unrelated memory",
          createdAt: `2026-07-${String((index % 25) + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      ),
    ];
    const storeRoot = root();
    const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID), [{ id: semantic.id, vector }]);
    writeFileSync(
      memoryEmbeddingHashesSidecarPath(storeRoot, PROJECT_ID),
      JSON.stringify({ [semantic.id]: memoryEmbeddingContentHash(semantic) }),
      "utf8",
    );

    const result = await rankProjectMemories({
      projectId: PROJECT_ID,
      entries,
      task: "no lexical overlap",
      storeRoot,
      query: { text: "no lexical overlap" },
      embed: async () => [new Float32Array(vector)],
      now: () => 0,
    });

    expect(result.memory.map((entry) => entry.id)).toContain(semantic.id);
    expect(result.hybrid.profile).toBe("adaptive");
  });
});
