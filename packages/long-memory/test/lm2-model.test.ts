import { describe, expect, it } from "vitest";
import { Lm2Error } from "../src/lm2-errors.js";
import {
  MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
  MAX_LM2_QUERY_TIMEOUT_MS,
  hybridReceiptSchema,
  lm2CandidateSchema,
  lm2IndexRequestSchema,
  lm2RankRequestSchema,
  lm2RuntimeConfigSchema,
  modelDescriptorSchema,
} from "../src/lm2-model.js";

const model = {
  provider: "local",
  modelId: "mini",
  revision: "r1",
  dimensions: 3,
  embeddingInputVersion: "lm2-v1" as const,
};

describe("LM2 model contracts", () => {
  it("accepts canonical model descriptors and rejects unknown or noncanonical fields", () => {
    expect(modelDescriptorSchema.parse(model)).toEqual(model);
    expect(() => modelDescriptorSchema.parse({ ...model, provider: " local" })).toThrow();
    expect(() => modelDescriptorSchema.parse({ ...model, modelId: "" })).toThrow();
    expect(() => modelDescriptorSchema.parse({ ...model, dimensions: 4_097 })).toThrow();
    expect(() => modelDescriptorSchema.parse({ ...model, extra: true })).toThrow();
  });

  it("bounds config timeouts and admits at most two canonical models", () => {
    const config = {
      admittedModels: [model],
      embeddingEgress: "local" as const,
      remoteApprovals: [],
      queryTimeoutMs: MAX_LM2_QUERY_TIMEOUT_MS,
      indexBatchTimeoutMs: MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
    };

    expect(lm2RuntimeConfigSchema.parse(config)).toEqual(config);
    expect(() => lm2RuntimeConfigSchema.parse({ ...config, queryTimeoutMs: 0 })).toThrow();
    expect(() =>
      lm2RuntimeConfigSchema.parse({ ...config, indexBatchTimeoutMs: 15_001 }),
    ).toThrow();
    expect(() =>
      lm2RuntimeConfigSchema.parse({ ...config, admittedModels: [model, model, model] }),
    ).toThrow();
    expect(() => lm2RuntimeConfigSchema.parse({ ...config, unknown: true })).toThrow();
  });

  it("keeps candidates and rank/index requests inside their strict public bounds", () => {
    const candidate = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceKey: "0123456789abcdef",
      observedAt: "2026-07-20T00:00:00.000Z",
      kind: "state_snapshot" as const,
      text: "redacted text",
      sourceDigest: "a".repeat(64),
    };

    expect(lm2CandidateSchema.parse(candidate)).toEqual(candidate);
    expect(() => lm2CandidateSchema.parse({ ...candidate, text: "" })).toThrow();
    expect(() =>
      lm2CandidateSchema.parse({ ...candidate, workspaceKey: "ABCDEF0123456789" }),
    ).toThrow();
    expect(
      lm2RankRequestSchema.parse({
        workspaceKey: candidate.workspaceKey,
        task: "find status",
        profile: "adaptive",
        model,
        timeoutMs: MAX_LM2_QUERY_TIMEOUT_MS,
      }),
    ).toMatchObject({ profile: "adaptive" });
    expect(() =>
      lm2IndexRequestSchema.parse({
        workspaceKey: candidate.workspaceKey,
        modelFingerprint: "b".repeat(64),
        maxRecords: 257,
      }),
    ).toThrow();
  });

  it("requires receipt reasons to agree with the semantic status", () => {
    const receipt = {
      profile: "adaptive" as const,
      adaptiveCandidateScope: "lm2_capture_window" as const,
      adaptiveCatalogRecordCount: 1,
      candidateInputOmittedCount: 0,
      lexicalCandidateCount: 1,
      semanticCandidateCount: 0,
      fusedCandidateCount: 1,
      semanticStatus: "degraded" as const,
      semanticReasons: ["invalid_vectors"] as const,
      indexedVectorCount: 0,
      missingVectorCount: 0,
      invalidVectorCount: 1,
      semanticVectorBytesRead: 0,
      queryLatencyMs: 1,
    };

    expect(hybridReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(() =>
      hybridReceiptSchema.parse({
        ...receipt,
        semanticStatus: "used",
        semanticReasons: ["timeout"],
      }),
    ).toThrow();
    expect(() => hybridReceiptSchema.parse({ ...receipt, semanticReasons: [] })).toThrow();
    expect(() =>
      hybridReceiptSchema.parse({ ...receipt, semanticReasons: ["timeout", "timeout"] }),
    ).toThrow();
  });

  it("uses the closed LM2 error boundary", () => {
    expect(new Lm2Error("invalid_vectors", "Invalid embedding vector.")).toMatchObject({
      name: "Lm2Error",
      code: "invalid_vectors",
    });
  });
});
