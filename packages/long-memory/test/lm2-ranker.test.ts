import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import type { Lm2Candidate, Lm2VectorReadResult, ModelDescriptor } from "../src/lm2-model.js";
import { rankLm2Candidates } from "../src/lm2-ranker.js";

const workspaceKey = "0123456789abcdef";
const model: ModelDescriptor = {
  provider: "local",
  modelId: "ranker-test",
  revision: "r1",
  dimensions: 2,
  embeddingInputVersion: "lm2-v1",
};

function candidate(index: number, text: string, observedAt = "2026-01-01T00:00:00.000Z") {
  const id = `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
  return {
    id,
    workspaceKey,
    observedAt,
    kind: "state_snapshot" as const,
    text,
    sourceDigest: createHash("sha256").update(id).digest("hex"),
  };
}

function adaptiveInput(
  candidates: readonly Lm2Candidate[],
  vectors: readonly { candidateId: string; vector: readonly number[]; decodedBytes: number }[],
  diagnostics: Lm2VectorReadResult["diagnostics"] = [],
) {
  return {
    candidates,
    request: { workspaceKey, task: "billing payment", profile: "adaptive" as const, model },
    vectors: { read: vi.fn(async () => ({ vectors, diagnostics })) },
    embedding: {
      egress: "local" as const,
      embed: vi.fn(async () => ({
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [[1, 0]],
      })),
    },
    clock: { now: vi.fn().mockReturnValueOnce(10).mockReturnValue(15) },
  };
}

describe("LM2 hybrid ranker", () => {
  it("assigns lane-local ties before one-based RRF", async () => {
    const newer = candidate(1, "billing payment", "2026-01-02T00:00:00.000Z");
    const older = candidate(2, "billing payment", "2026-01-01T00:00:00.000Z");
    const input = adaptiveInput(
      [newer, older],
      [
        { candidateId: older.id, vector: [1, 0], decodedBytes: 8 },
        { candidateId: newer.id, vector: [1, 0], decodedBytes: 8 },
      ],
    );

    const result = await rankLm2Candidates(input);

    expect(result.orderedCandidateIds).toEqual([newer.id, older.id]);
    expect(result.scores).toEqual([
      { id: newer.id, score: 2 / 61 },
      { id: older.id, score: 2 / 62 },
    ]);
  });

  it("uses cosine only for positive finite hits and can change lexical order", async () => {
    const lexical = candidate(1, "billing payment billing payment");
    const semantic = candidate(2, "invoice settled");
    const excluded = candidate(3, "unrelated");
    const input = adaptiveInput(
      [lexical, semantic, excluded],
      [
        { candidateId: lexical.id, vector: [0.5, 1], decodedBytes: 8 },
        { candidateId: semantic.id, vector: [1, 0], decodedBytes: 8 },
        { candidateId: excluded.id, vector: [-1, 0], decodedBytes: 8 },
      ],
    );

    const result = await rankLm2Candidates(input);

    expect(result.orderedCandidateIds).toEqual([lexical.id, semantic.id]);
    expect(result.hybrid.semanticCandidateCount).toBe(2);
  });

  it("caps each lane and the fused list at 1,000", async () => {
    const candidates = Array.from({ length: 1_001 }, (_, index) =>
      candidate(
        index + 1,
        "billing payment",
        new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ),
    );
    const input = adaptiveInput(
      candidates,
      candidates.map((entry) => ({ candidateId: entry.id, vector: [1, 0], decodedBytes: 8 })),
    );

    const result = await rankLm2Candidates(input);

    expect(result.orderedCandidateIds).toHaveLength(1_000);
    expect(result.hybrid).toMatchObject({
      lexicalCandidateCount: 1_000,
      semanticCandidateCount: 1_000,
      fusedCandidateCount: 1_000,
    });
  });

  it("keeps Safe lexical-only and makes zero embedding or sidecar calls", async () => {
    const vectors = { read: vi.fn() };
    const embedding = { egress: "remote" as const, embed: vi.fn() };
    const records = [candidate(1, "billing billing"), candidate(2, "billing")];

    const result = await rankLm2Candidates({
      candidates: records,
      request: { workspaceKey, task: "billing", profile: "safe" },
      vectors,
      embedding,
      clock: { now: vi.fn().mockReturnValueOnce(1).mockReturnValue(2) },
    });

    expect(result.orderedCandidateIds).toEqual(records.map((entry) => entry.id));
    expect(result.hybrid.semanticStatus).toBe("not_requested");
    expect(vectors.read).not.toHaveBeenCalled();
    expect(embedding.embed).not.toHaveBeenCalled();
  });

  it("skips semantic input above 8,192 units with a sorted reason", async () => {
    const input = adaptiveInput([candidate(1, "billing")], []);
    input.request.task = "x".repeat(8_193);

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticStatus: "degraded",
      semanticReasons: ["input_limit"],
    });
    expect(input.vectors.read).not.toHaveBeenCalled();
    expect(input.embedding.embed).not.toHaveBeenCalled();
  });

  it("reports a valid semantic subset as used_partial_index", async () => {
    const indexed = candidate(1, "billing");
    const records = [indexed, candidate(2, "billing"), candidate(3, "billing")];
    const input = adaptiveInput(records, [
      { candidateId: indexed.id, vector: [1, 0], decodedBytes: 8 },
    ]);

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticStatus: "used_partial_index",
      semanticReasons: ["missing_vectors"],
      indexedVectorCount: 1,
      missingVectorCount: 2,
    });
  });

  it("preserves invalid and quota-ledger diagnostics without synthesizing missing", async () => {
    const indexed = candidate(1, "billing");
    const invalid = candidate(2, "billing");
    const ledgerBlocked = candidate(3, "billing");
    const input = adaptiveInput(
      [indexed, invalid, ledgerBlocked],
      [{ candidateId: indexed.id, vector: [1, 0], decodedBytes: 8 }],
      [
        { candidateId: invalid.id, reason: "invalid_vectors" },
        { candidateId: ledgerBlocked.id, reason: "quota_ledger_invalid" },
      ],
    );

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticStatus: "used_partial_index",
      semanticReasons: ["invalid_vectors", "quota_ledger_invalid"],
      indexedVectorCount: 1,
      missingVectorCount: 0,
      invalidVectorCount: 1,
    });
  });

  it("reports recovery-pending without reclassifying it as missing", async () => {
    const record = candidate(1, "billing");
    const input = adaptiveInput(
      [record],
      [],
      [{ candidateId: record.id, reason: "quota_recovery_pending" }],
    );

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticStatus: "degraded",
      semanticReasons: ["quota_recovery_pending"],
      missingVectorCount: 0,
    });
    expect(input.embedding.embed).not.toHaveBeenCalled();
  });

  it("maps and de-duplicates vector-read diagnostics in sorted order", async () => {
    const first = candidate(1, "billing");
    const second = candidate(2, "billing");
    const input = adaptiveInput(
      [first, second],
      [],
      [
        { candidateId: second.id, reason: "vector_read_limit" },
        { candidateId: first.id, reason: "missing_vectors" },
        { candidateId: second.id, reason: "vector_read_limit" },
      ],
    );

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticReasons: ["missing_vectors", "vector_read_limit"],
      missingVectorCount: 1,
    });
  });

  it.each([
    {
      name: "candidate membership",
      vector: {
        candidateId: "00000000-0000-4000-8000-999999999999",
        vector: [1, 0],
        decodedBytes: 8,
      },
    },
    {
      name: "duplicate identity",
      vector: null,
    },
    {
      name: "descriptor dimension",
      vector: { candidateId: candidate(1, "billing").id, vector: [1], decodedBytes: 4 },
    },
    {
      name: "decoded-byte claim",
      vector: { candidateId: candidate(1, "billing").id, vector: [1, 0], decodedBytes: 4 },
    },
    {
      name: "finite components",
      vector: { candidateId: candidate(1, "billing").id, vector: [Number.NaN, 0], decodedBytes: 8 },
    },
  ])("rejects invalid returned-vector $name before query embedding", async ({ name, vector }) => {
    const record = candidate(1, "billing");
    const returned =
      name === "duplicate identity"
        ? [
            { candidateId: record.id, vector: [1, 0], decodedBytes: 8 },
            { candidateId: record.id, vector: [1, 0], decodedBytes: 8 },
          ]
        : [vector as { candidateId: string; vector: readonly number[]; decodedBytes: number }];
    const input = adaptiveInput([record], returned);

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticStatus: "degraded",
      semanticReasons: ["invalid_vectors"],
    });
    expect(result.orderedCandidateIds).toEqual([record.id]);
    expect(input.embedding.embed).not.toHaveBeenCalled();
  });

  it("passes a monotonic deadline through the bounded vector read", async () => {
    const record = candidate(1, "billing");
    const input = adaptiveInput(
      [record],
      [{ candidateId: record.id, vector: [1, 0], decodedBytes: 8 }],
    );
    input.clock.now = vi.fn(() => 10);

    await rankLm2Candidates(input);

    expect(input.vectors.read).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineAtMs: 1_510,
        now: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("ends a completed vector read at the monotonic deadline", async () => {
    const record = candidate(1, "billing");
    const input = adaptiveInput(
      [record],
      [{ candidateId: record.id, vector: [1, 0], decodedBytes: 8 }],
    );
    input.clock.now = vi
      .fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10)
      .mockReturnValue(1_510);

    const result = await rankLm2Candidates(input);

    expect(result.hybrid).toMatchObject({
      semanticStatus: "degraded",
      semanticReasons: ["timeout"],
    });
    expect(input.embedding.embed).not.toHaveBeenCalled();
  });

  it("uses only the canonical public query as embedding input", async () => {
    const record = candidate(1, "billing");
    const input = adaptiveInput(
      [record],
      [{ candidateId: record.id, vector: [1, 0], decodedBytes: 8 }],
    );
    input.request.task = "  billing  ";

    await rankLm2Candidates(input);

    expect(input.embedding.embed).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "query", texts: ["billing"] }),
    );
  });

  it("checks current remote query approval immediately before egress", async () => {
    const record = candidate(1, "billing");
    const input = adaptiveInput(
      [record],
      [{ candidateId: record.id, vector: [1, 0], decodedBytes: 8 }],
    );
    input.embedding.egress = "remote";
    const remoteApproval = { assertCurrent: vi.fn(async () => "denied" as const) };

    const result = await rankLm2Candidates({
      ...input,
      remoteApproval,
      approvalRef: "approval-1",
    });

    expect(remoteApproval.assertCurrent).toHaveBeenCalledWith({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      purpose: "query",
      approvalRef: "approval-1",
    });
    expect(input.embedding.embed).not.toHaveBeenCalled();
    expect(result.hybrid.semanticReasons).toEqual(["remote_approval_denied"]);
  });

  it("aborts at the deadline and discards late semantic output", async () => {
    let resolveEmbedding!: (value: { modelFingerprint: string; vectors: number[][] }) => void;
    const record = candidate(1, "billing");
    const input = adaptiveInput(
      [record],
      [{ candidateId: record.id, vector: [1, 0], decodedBytes: 8 }],
    );
    input.request.timeoutMs = 5;
    input.clock.now = vi.fn(() => 10);
    input.embedding.embed = vi.fn(
      ({ signal }) =>
        new Promise((resolve) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          resolveEmbedding = resolve;
        }),
    );

    const result = await rankLm2Candidates(input);
    resolveEmbedding({ modelFingerprint: modelDescriptorFingerprint(model), vectors: [[1, 0]] });
    await Promise.resolve();

    expect(result.hybrid).toMatchObject({
      semanticStatus: "degraded",
      semanticReasons: ["timeout"],
    });
    expect(result.orderedCandidateIds).toEqual([record.id]);
  });

  it("aborts a stalled vector read and preserves lexical ranking", async () => {
    let resolveRead!: (value: Lm2VectorReadResult) => void;
    let readSignal: AbortSignal | undefined;
    const record = candidate(1, "billing");
    const input = adaptiveInput([record], []);
    input.request.timeoutMs = 5;
    input.clock.now = vi.fn(() => 10);
    input.vectors.read = vi.fn(
      ({ signal }) =>
        new Promise((resolve) => {
          readSignal = signal;
          resolveRead = resolve;
        }),
    );

    const result = await rankLm2Candidates(input);
    resolveRead({
      vectors: [{ candidateId: record.id, vector: [1, 0], decodedBytes: 8 }],
      diagnostics: [],
    });
    await Promise.resolve();

    expect(readSignal?.aborted).toBe(true);
    expect(result.hybrid).toMatchObject({
      semanticStatus: "degraded",
      semanticReasons: ["timeout"],
    });
    expect(result.orderedCandidateIds).toEqual([record.id]);
    expect(input.embedding.embed).not.toHaveBeenCalled();
  });

  it("rejects private or unvalidated candidate fields at its boundary", async () => {
    const record = { ...candidate(1, "billing"), stateKey: "private.state" };

    await expect(
      rankLm2Candidates({
        ...adaptiveInput([record as Lm2Candidate], []),
        candidates: [record as Lm2Candidate],
      }),
    ).rejects.toMatchObject({ code: "candidate_store_invalid" });
  });
});
