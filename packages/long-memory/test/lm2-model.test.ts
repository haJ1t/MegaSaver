import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Lm2Error } from "../src/lm2-errors.js";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import {
  MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
  MAX_LM2_QUERY_TIMEOUT_MS,
  hybridReceiptSchema,
  lm2CandidateSchema,
  lm2IndexReceiptSchema,
  lm2IndexRequestSchema,
  lm2RankRequestSchema,
  lm2RuntimeConfigSchema,
  lm2VectorReadResultSchema,
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
  it("keeps LM2 model modules within the source file limit", () => {
    for (const sourceFile of ["lm2-model-contracts.ts", "lm2-model.ts", "lm2-runtime-model.ts"]) {
      const sourcePath = fileURLToPath(new URL(`../src/${sourceFile}`, import.meta.url));
      const lineCount = readFileSync(sourcePath, "utf8").split("\n").length - 1;

      expect(lineCount, sourceFile).toBeLessThanOrEqual(300);
    }
  });

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
      activeRecallModelFingerprint: modelDescriptorFingerprint(model),
      embeddingEgress: "local" as const,
      remoteApprovals: [],
      queryTimeoutMs: MAX_LM2_QUERY_TIMEOUT_MS,
      indexBatchTimeoutMs: MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
    };

    expect(lm2RuntimeConfigSchema.parse(config)).toEqual(config);
    const { activeRecallModelFingerprint: _active, ...withoutActive } = config;
    expect(() => lm2RuntimeConfigSchema.parse(withoutActive)).toThrow();
    expect(() => lm2RuntimeConfigSchema.parse({ ...config, queryTimeoutMs: 0 })).toThrow();
    expect(() =>
      lm2RuntimeConfigSchema.parse({ ...config, indexBatchTimeoutMs: 15_001 }),
    ).toThrow();
    expect(() =>
      lm2RuntimeConfigSchema.parse({ ...config, admittedModels: [model, model, model] }),
    ).toThrow();
    expect(() => lm2RuntimeConfigSchema.parse({ ...config, unknown: true })).toThrow();
  });

  it("binds remote approvals to admitted models and forbids them for local egress", () => {
    const remoteApproval = {
      workspaceKey: "0123456789abcdef",
      modelFingerprint: modelDescriptorFingerprint(model),
      approvalRef: "approval-1",
    };
    const remoteConfig = {
      admittedModels: [model],
      activeRecallModelFingerprint: modelDescriptorFingerprint(model),
      embeddingEgress: "remote" as const,
      remoteApprovals: [remoteApproval],
      queryTimeoutMs: MAX_LM2_QUERY_TIMEOUT_MS,
      indexBatchTimeoutMs: MAX_LM2_INDEX_BATCH_TIMEOUT_MS,
    };

    expect(lm2RuntimeConfigSchema.parse(remoteConfig)).toEqual(remoteConfig);
    expect(() =>
      lm2RuntimeConfigSchema.parse({
        ...remoteConfig,
        remoteApprovals: [{ ...remoteApproval, modelFingerprint: "b".repeat(64) }],
      }),
    ).toThrow();
    expect(() =>
      lm2RuntimeConfigSchema.parse({ ...remoteConfig, embeddingEgress: "local" }),
    ).toThrow();
    expect(() =>
      lm2RuntimeConfigSchema.parse({
        ...remoteConfig,
        remoteApprovals: [remoteApproval, remoteApproval],
      }),
    ).toThrow();
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
    expect(
      hybridReceiptSchema.parse({
        ...receipt,
        semanticReasons: ["quota_ledger_invalid", "quota_recovery_pending"],
      }).semanticReasons,
    ).toEqual(["quota_ledger_invalid", "quota_recovery_pending"]);
  });

  it("enforces complete, continue, retry, and expired index receipt discriminants", () => {
    const base = {
      indexedCount: 0,
      omitted: [],
      quotaRecovery: "not_needed" as const,
    };
    const complete = {
      ...base,
      outcome: "complete" as const,
      nextCursor: null,
      retryCursor: null,
      transientReason: null,
    };
    const continuing = { ...complete, outcome: "continue" as const, nextCursor: "cursor-2" };
    const retrying = {
      ...complete,
      outcome: "retry" as const,
      retryCursor: null,
      transientReason: "quota_state_invalid" as const,
      quotaRecovery: "blocked_pending" as const,
    };
    const expired = { ...complete, outcome: "expired" as const };

    expect(lm2IndexReceiptSchema.parse(complete)).toEqual(complete);
    expect(lm2IndexReceiptSchema.parse(continuing)).toEqual(continuing);
    expect(lm2IndexReceiptSchema.parse(retrying)).toEqual(retrying);
    expect(lm2IndexReceiptSchema.parse(expired)).toEqual(expired);
    expect(() =>
      lm2IndexReceiptSchema.parse({ ...complete, outcome: "continue", nextCursor: null }),
    ).toThrow();
    expect(() =>
      lm2IndexReceiptSchema.parse({ ...complete, outcome: "retry", transientReason: null }),
    ).toThrow();
    expect(() => lm2IndexReceiptSchema.parse({ ...expired, retryCursor: "cursor-1" })).toThrow();
    for (const outcome of ["complete", "continue", "expired"] as const) {
      expect(() =>
        lm2IndexReceiptSchema.parse({
          ...complete,
          outcome,
          nextCursor: outcome === "continue" ? "cursor-2" : null,
          quotaRecovery: "blocked_pending",
        }),
      ).toThrow();
    }
    expect(() =>
      lm2IndexReceiptSchema.parse({
        ...retrying,
        transientReason: "index_busy",
      }),
    ).toThrow();
  });

  it("keeps vector read diagnostics strict and ledger-specific", () => {
    const result = {
      vectors: [
        { candidateId: "11111111-1111-4111-8111-111111111111", vector: [1, 2], decodedBytes: 8 },
      ],
      diagnostics: [
        {
          candidateId: "22222222-2222-4222-8222-222222222222",
          reason: "quota_recovery_pending" as const,
        },
      ],
    };
    expect(lm2VectorReadResultSchema.parse(result)).toEqual(result);
    expect(() =>
      lm2VectorReadResultSchema.parse({
        ...result,
        diagnostics: [{ ...result.diagnostics[0], reason: "storage_limit" }],
      }),
    ).toThrow();
  });

  it("uses the closed LM2 error boundary", () => {
    expect(new Lm2Error("invalid_vectors", "Invalid embedding vector.")).toMatchObject({
      name: "Lm2Error",
      code: "invalid_vectors",
    });
  });
});
