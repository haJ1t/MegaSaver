import { expect, expectTypeOf, it } from "vitest";
import * as longMemory from "../src/index.js";
import type { Lm2VectorReadResult } from "../src/lm2-model.js";
import type { Lm2VectorStoreResult } from "../src/lm2-vector-store.js";

it("exports the LM0 package marker", () => {
  expectTypeOf(longMemory.LONG_MEMORY_PACKAGE).toEqualTypeOf<string>();
});

it("preserves LM0 exports while adding LM1 contracts", () => {
  expectTypeOf(longMemory.createInMemoryLongMemoryStore).toBeFunction();
  expectTypeOf<longMemory.LongMemoryStore>().toMatchTypeOf<{
    insert: (observation: longMemory.Observation) => { inserted: boolean };
    query: (request: longMemory.RecallRequest) => longMemory.RecallBundle;
  }>();
  expectTypeOf(longMemory.dispatchRpcLine).toBeFunction();
  expectTypeOf(longMemory.MAX_EVIDENCE_IDS).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_EVIDENCE_ID_LENGTH).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_OBSERVATION_TEXT_CHARS).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_RECALL_TASK_CHARS).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_RECALL_TOKEN_BUDGET).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_WORKSPACE_KEY_LENGTH).toEqualTypeOf<number>();
  expectTypeOf(longMemory.observationKindSchema).toBeObject();
  expectTypeOf(longMemory.observationSchema).toBeObject();
  expectTypeOf(longMemory.recallRequestSchema).toBeObject();
  expectTypeOf(longMemory.recallItemSchema).toBeObject();
  expectTypeOf(longMemory.receiptItemSchema).toBeObject();
  expectTypeOf(longMemory.recallBundleSchema).toBeObject();
  expectTypeOf(longMemory.rpcRequestSchema).toBeObject();
  expectTypeOf(longMemory.rpcResponseSchema).toBeObject();
  expectTypeOf<longMemory.ObservationKind>().toEqualTypeOf<"state_snapshot" | "state_transition">();
  expectTypeOf<longMemory.Observation>().toMatchTypeOf<{
    id: string;
    workspaceKey: string;
  }>();
  expectTypeOf<longMemory.RecallRequest>().toMatchTypeOf<{
    task: string;
    workspaceKey: string;
    tokenBudget: number;
  }>();
  expectTypeOf<longMemory.RecallItem>().toMatchTypeOf<{
    type: "text";
    value: string;
    observationId: string;
  }>();
  expectTypeOf<longMemory.ReceiptItem>().toMatchTypeOf<{
    observationId: string;
    evidenceIds: string[];
  }>();
  expectTypeOf<longMemory.RecallBundle>().toMatchTypeOf<{
    items: longMemory.RecallItem[];
    receipt: longMemory.ReceiptItem[];
  }>();
  expectTypeOf<longMemory.RpcRequest>().toMatchTypeOf<{ id: string }>();
  expectTypeOf<longMemory.RpcResponse>().toMatchTypeOf<{ ok: boolean }>();
  expectTypeOf(longMemory.prepareCapture).toBeFunction();
  expectTypeOf<longMemory.RedactionPort>().toMatchTypeOf<{
    version: string;
    redact(input: { text: string; action: string | null }): unknown;
  }>();
  expect(longMemory).not.toHaveProperty("createFileLm1Store");
  expect(longMemory).not.toHaveProperty("createLm1CaptureService");
  expect(longMemory).not.toHaveProperty("createLm1RecallService");
  expectTypeOf(longMemory.createLm1Runtime).toBeFunction();
});

it("adds LM2 contracts without removing LM0 or LM1 root imports", () => {
  expectTypeOf(longMemory.Lm2Error).toMatchTypeOf<
    new (
      code: longMemory.Lm2ErrorCode,
      message: string,
    ) => Error
  >();
  expectTypeOf(longMemory.modelDescriptorSchema).toBeObject();
  expectTypeOf(longMemory.lm2RuntimeConfigSchema).toBeObject();
  expectTypeOf(longMemory.lm2CandidateSchema).toBeObject();
  expectTypeOf(longMemory.lm2RankRequestSchema).toBeObject();
  expectTypeOf(longMemory.lm2IndexRequestSchema).toBeObject();
  expectTypeOf(longMemory.hybridReceiptSchema).toBeObject();
  expectTypeOf(longMemory.modelDescriptorFingerprint).toBeFunction();
  expectTypeOf(longMemory.embeddingInputDigest).toBeFunction();
  expectTypeOf(longMemory.canonicalFloat32).toBeFunction();
  expectTypeOf<longMemory.ModelDescriptor>().toMatchTypeOf<{
    provider: string;
    dimensions: number;
  }>();
  expectTypeOf<longMemory.EmbeddingPort>().toMatchTypeOf<{
    egress: "local" | "remote";
  }>();
  expectTypeOf<longMemory.RemoteEmbeddingApprovalPort>().toMatchTypeOf<{
    assertCurrent: (input: {
      workspaceKey: string;
      modelFingerprint: string;
      purpose: "document" | "query";
      approvalRef: string;
    }) => Promise<"approved" | "denied" | "revoked" | "unreadable">;
  }>();
  expectTypeOf<longMemory.HybridReceipt>().toMatchTypeOf<{
    semanticStatus: "not_requested" | "used" | "used_partial_index" | "degraded";
  }>();
  expectTypeOf<longMemory.Lm2IndexReceipt["outcome"]>().toEqualTypeOf<
    "complete" | "continue" | "retry" | "expired"
  >();
  expectTypeOf<Extract<longMemory.Lm2IndexReceipt, { outcome: "complete" }>>().toMatchTypeOf<{
    nextCursor: null;
    retryCursor: null;
    transientReason: null;
  }>();
  expectTypeOf<Extract<longMemory.Lm2IndexReceipt, { outcome: "continue" }>>().toMatchTypeOf<{
    nextCursor: string;
    retryCursor: null;
    transientReason: null;
  }>();
  expectTypeOf<Extract<longMemory.Lm2IndexReceipt, { outcome: "retry" }>>().toMatchTypeOf<{
    nextCursor: null;
    retryCursor: string | null;
    transientReason:
      | "index_busy"
      | "index_lock_unavailable"
      | "quota_state_invalid"
      | "evidence_cap_exhausted"
      | "remote_approval_denied"
      | "embedding_failure"
      | "timeout"
      | "sidecar_write_failed"
      | "evidence_changed"
      | "lock_integrity_lost";
  }>();
  expectTypeOf<longMemory.Lm2IndexReceipt["quotaRecovery"]>().toEqualTypeOf<
    "not_needed" | "recovered_pending" | "blocked_pending"
  >();
  expectTypeOf<Lm2VectorStoreResult["reason"]>().toEqualTypeOf<
    | null
    | "index_busy"
    | "index_lock_unavailable"
    | "storage_limit"
    | "invalid_vectors"
    | "port_failure"
    | "timeout"
    | "write_failed"
  >();
  expectTypeOf<Lm2VectorReadResult["diagnostics"][number]["reason"]>().toEqualTypeOf<
    | "missing_vectors"
    | "invalid_vectors"
    | "vector_read_limit"
    | "quota_ledger_invalid"
    | "quota_recovery_pending"
  >();
  expectTypeOf<longMemory.HybridSemanticReason>().toEqualTypeOf<
    | "missing_vectors"
    | "port_failure"
    | "invalid_vectors"
    | "timeout"
    | "input_limit"
    | "storage_limit"
    | "vector_read_limit"
    | "remote_approval_denied"
    | "quota_ledger_invalid"
    | "quota_recovery_pending"
  >();
});
