import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type MemoryEntryId,
  createInMemoryCoreRegistry,
  memoryEmbeddingsSidecarPath,
} from "@megasaver/core";
import { writeVectors } from "@megasaver/embeddings";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleApproveMemory } from "../src/tools/approve-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_ID = "33333333-3333-4333-8333-333333333333";
const TS = "2026-06-12T00:00:00.000Z";

// Deterministic, model-free vectors. Parallel ⇒ cosine 1.0 (≥ 0.95 near-dup);
// orthogonal ⇒ cosine 0.0 (far). The injected embedFn returns the candidate's
// vector by design, so no model is loaded.
const VEC_A = [1, 0, 0];
const VEC_ORTHOGONAL = [0, 1, 0];

function seed(over: { approvedTitle?: string; approvedContent?: string } = {}) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  // An already-approved, current memory — the canonicalization target.
  registry.createMemoryEntry({
    id: APPROVED_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: over.approvedTitle ?? "Use strict TS",
    content: over.approvedContent ?? "tsconfig strict on",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    createdAt: TS,
    updatedAt: TS,
  });
  // A suggested human candidate whose prose differs but is semantically near.
  registry.createMemoryEntry({
    id: CANDIDATE_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Enable strict typescript",
    content: "turn on all strict flags",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "suggested",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

const constEmbed = (vec: number[]) => async () => [Float32Array.from(vec)];

describe("approve_memory semantic canonicalization (M3 — surface, do not block)", () => {
  let storeRoot: string;
  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), "ms-canon-"));
  });
  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("surfaces a near-duplicate: approval SUCCEEDS, records semantic-duplicate + matched id", async () => {
    const registry = seed();
    // Sidecar: the approved target carries VEC_A; the injected embedFn returns
    // VEC_A for the candidate ⇒ cosine 1.0 ≥ threshold ⇒ near-dup surfaced.
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID as never), [
      { id: APPROVED_ID, vector: VEC_A },
    ]);

    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS, embedFn: constEmbed(VEC_A) },
      { memoryEntryId: CANDIDATE_ID, approval: "approved" },
    );

    // SURFACE, not block — the memory is approved.
    expect(result.approval).toBe("approved");
    expect(registry.getMemoryEntry(CANDIDATE_ID as never)?.approval).toBe("approved");

    // The validation sidecar carries the surfaced reason + matched id.
    const validation = registry.getMemoryValidation(CANDIDATE_ID as MemoryEntryId);
    expect(validation?.reasons).toContain("semantic-duplicate");
    expect(validation?.conflictIds).toContain(APPROVED_ID);
    // Returned result also surfaces it for the human.
    expect(result.validation?.reasons).toContain("semantic-duplicate");
    expect(result.conflict?.conflictIds).toContain(APPROVED_ID);
  });

  it("does NOT surface when the candidate is far from every approved memory", async () => {
    const registry = seed();
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID as never), [
      { id: APPROVED_ID, vector: VEC_A },
    ]);

    const result = await handleApproveMemory(
      // Candidate embeds orthogonal to the approved vector ⇒ cosine 0 < threshold.
      { registry, storeRoot, now: () => TS, embedFn: constEmbed(VEC_ORTHOGONAL) },
      { memoryEntryId: CANDIDATE_ID, approval: "approved" },
    );

    expect(result.approval).toBe("approved");
    const validation = registry.getMemoryValidation(CANDIDATE_ID as MemoryEntryId);
    expect(validation?.reasons ?? []).not.toContain("semantic-duplicate");
    expect(validation?.conflictIds ?? []).not.toContain(APPROVED_ID);
  });

  it("is graceful when no sidecar exists: approval unaffected, no semantic reason", async () => {
    const registry = seed();
    // No writeVectors → no sidecar file at all.
    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS, embedFn: constEmbed(VEC_A) },
      { memoryEntryId: CANDIDATE_ID, approval: "approved" },
    );

    expect(result.approval).toBe("approved");
    const validation = registry.getMemoryValidation(CANDIDATE_ID as MemoryEntryId);
    expect(validation?.reasons ?? []).not.toContain("semantic-duplicate");
  });

  it("ignores non-recallable targets: an ARCHIVAL approved memory is not a canonicalization target", async () => {
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    // Approved but ARCHIVAL ⇒ not recallable ⇒ not a target even with a matching vector.
    registry.createMemoryEntry({
      id: APPROVED_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Old strict note",
      content: "archived",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      approval: "approved",
      tier: "archival",
      createdAt: TS,
      updatedAt: TS,
    });
    registry.createMemoryEntry({
      id: CANDIDATE_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Enable strict typescript",
      content: "turn on all strict flags",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      approval: "suggested",
      createdAt: TS,
      updatedAt: TS,
    });
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID as never), [
      { id: APPROVED_ID, vector: VEC_A },
    ]);

    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS, embedFn: constEmbed(VEC_A) },
      { memoryEntryId: CANDIDATE_ID, approval: "approved" },
    );

    expect(result.approval).toBe("approved");
    const validation = registry.getMemoryValidation(CANDIDATE_ID as MemoryEntryId);
    expect(validation?.reasons ?? []).not.toContain("semantic-duplicate");
  });

  it("never throws / blocks when embed throws: approval still succeeds, no semantic reason", async () => {
    const registry = seed();
    writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID as never), [
      { id: APPROVED_ID, vector: VEC_A },
    ]);
    const throwingEmbed = async () => {
      throw new Error("model unavailable");
    };

    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS, embedFn: throwingEmbed },
      { memoryEntryId: CANDIDATE_ID, approval: "approved" },
    );

    expect(result.approval).toBe("approved");
    const validation = registry.getMemoryValidation(CANDIDATE_ID as MemoryEntryId);
    expect(validation?.reasons ?? []).not.toContain("semantic-duplicate");
  });

  it.skipIf(!process.env.MEGA_EMBED_E2E)(
    "real embed: a near-identical approved memory is surfaced as semantic-duplicate",
    async () => {
      const registry = seed();
      // Seed the approved target's vector from the CANDIDATE's own embed text so
      // the real-model cosine is ~1.0 (≥ threshold) — proves the real embed()
      // path end-to-end without depending on a fragile paraphrase distance.
      const { embed } = await import("@megasaver/embeddings");
      const candidate = registry.getMemoryEntry(CANDIDATE_ID as MemoryEntryId);
      const { memoryEmbedText } = await import("@megasaver/core");
      const [vec] = await embed([memoryEmbedText(candidate as never)]);
      writeVectors(memoryEmbeddingsSidecarPath(storeRoot, PROJECT_ID as never), [
        { id: APPROVED_ID, vector: Array.from(vec ?? []) },
      ]);

      const result = await handleApproveMemory(
        { registry, storeRoot, now: () => TS },
        { memoryEntryId: CANDIDATE_ID, approval: "approved" },
      );
      expect(result.approval).toBe("approved");
      const validation = registry.getMemoryValidation(CANDIDATE_ID as MemoryEntryId);
      expect(validation?.reasons).toContain("semantic-duplicate");
    },
  );
});
