import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lm1Record } from "../src/lm1-model.js";
import type { FileLm1Store } from "../src/lm1-store.js";
import type { Lm2CandidateCatalog } from "../src/lm2-catalog.js";
import { Lm2Error } from "../src/lm2-errors.js";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { createLm2IndexService } from "../src/lm2-index.js";
import type { Lm2Candidate, ModelDescriptor } from "../src/lm2-model.js";
import { canonicalEmbeddingInput } from "../src/lm2-vector-format.js";
import { type Lm2VectorStore, createLm2VectorStore } from "../src/lm2-vector-store.js";
import { cleanupRoots, createRoot, sidecarPath } from "./lm2-vector-store-fixtures.js";

const workspaceKey = "0123456789abcdef";
const model: ModelDescriptor = {
  provider: "local",
  modelId: "index-test",
  revision: "r1",
  dimensions: 2,
  embeddingInputVersion: "lm2-v1",
};
const evidenceIds = Array.from(
  { length: 1_200 },
  (_, index) => `10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
);

afterEach(() => {
  vi.restoreAllMocks();
  cleanupRoots();
});

function evidenceId(index: number): string {
  const id = evidenceIds[index];
  if (id === undefined) throw new Error("test evidence fixture exhausted");
  return id;
}

function firstEvidenceId(record: Lm1Record): string {
  const id = record.evidenceIds[0];
  if (id === undefined) throw new Error("test record has no evidence");
  return id;
}

function cursorSequence(cursor: string | null): number | null {
  if (cursor === null) return null;
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  return decoded.nextCaptureSequence;
}

function snapshot(index: number, overrides: Record<string, unknown> = {}): Lm1Record {
  const id = `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
  return {
    schemaVersion: 1,
    id,
    sourceDigest: createHash("sha256").update(id).digest("hex"),
    canonicalCaptureDigest: "a".repeat(64),
    evidenceBindingDigest: "b".repeat(64),
    recordedAt: "2026-07-20T00:00:03.000Z",
    evidenceDigests: ["c".repeat(64)],
    status: "recorded",
    workspaceKey,
    kind: "state_snapshot",
    observedAt: new Date(Date.UTC(2026, 6, 20, 0, 0, index % 60)).toISOString(),
    text: `Billing state ${index}`,
    action: null,
    evidenceIds: [evidenceId(index)],
    stateKey: `billing.${index}`,
    representation: "value",
    supersedesSnapshotId: null,
    redactionVersion: "redaction-v1",
    ...overrides,
  } as Lm1Record;
}

function transition(index: number, pre: Lm1Record, post: Lm1Record): Lm1Record {
  return {
    ...snapshot(index),
    kind: "state_transition",
    observedAt: "2026-07-20T00:00:01.000Z",
    text: "Billing changed",
    action: "apply",
    evidenceIds: [evidenceId(index)],
    evidenceDigests: ["d".repeat(64)],
    preSnapshotId: pre.id,
    postSnapshotId: post.id,
    outcome: "applied",
  } as Lm1Record;
}

function candidate(record: Lm1Record): Lm2Candidate {
  return {
    id: record.id,
    workspaceKey: record.workspaceKey,
    observedAt: record.observedAt,
    kind: record.kind,
    text: record.text,
    sourceDigest: record.sourceDigest,
  };
}

function catalogFor(records: readonly Lm1Record[]): Lm2CandidateCatalog {
  return {
    appendPublished: vi.fn(),
    page: vi.fn(({ cursor, limit }) => {
      let index = 0;
      if (cursor !== null) {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        index = decoded.nextCaptureSequence - 1;
      }
      const pageRecords = records.slice(index, index + limit);
      const nextIndex = index + pageRecords.length;
      return {
        generation: records.length,
        entries: pageRecords.map((record, offset) => ({
          id: record.id,
          sourceDigest: record.sourceDigest,
          kind: record.kind,
          observedAt: record.observedAt,
          captureSequence: index + offset + 1,
        })),
        nextCursor:
          nextIndex < records.length
            ? Buffer.from(
                JSON.stringify({
                  schemaVersion: 1,
                  workspaceKey,
                  generation: records.length,
                  nextCaptureSequence: nextIndex + 1,
                }),
                "utf8",
              ).toString("base64url")
            : null,
      };
    }),
  };
}

function storeFor(records: readonly Lm1Record[]): FileLm1Store {
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    publish: vi.fn(),
    getByDigest: vi.fn(),
    getById: vi.fn((requestedWorkspaceKey, id) => {
      const record = byId.get(id);
      if (record === undefined || record.workspaceKey !== requestedWorkspaceKey)
        throw new Error("missing");
      return record;
    }),
    list: vi.fn(),
  };
}

function harness(records: readonly Lm1Record[], input: { remote?: boolean } = {}) {
  const catalog = catalogFor(records);
  const store = storeFor(records);
  const eligibility = new Map(evidenceIds.map((id) => [id, "available" as const]));
  const evidenceEligibility = {
    resolve: vi.fn(async ({ workspaceKey: requestedWorkspaceKey, evidenceIds: requestedIds }) =>
      requestedIds.map((evidenceId) => ({
        evidenceId,
        workspaceKey: requestedWorkspaceKey,
        status: eligibility.get(evidenceId) ?? "revoked",
        unresolvedHighRisk: false,
      })),
    ),
  };
  const embedding = {
    egress: input.remote ? ("remote" as const) : ("local" as const),
    embed: vi.fn(async ({ texts }: { texts: readonly string[] }) => ({
      modelFingerprint: modelDescriptorFingerprint(model),
      vectors: texts.map(() => [1, 0]),
    })),
  };
  let operationSignal = new AbortController().signal;
  const finalize = vi.fn(async () => undefined);
  const publishBatch = vi.fn(
    async ({
      records: batch,
      embed,
      assertEgressAllowed,
      recheckEvidence,
    }: Parameters<
      Extract<
        Awaited<ReturnType<Lm2VectorStore["beginIndexOperation"]>>,
        { status: "ready" }
      >["publishBatch"]
    >[0]) => {
      if (!(await assertEgressAllowed())) {
        return { published: [], existing: [], reason: "remote_approval_denied" as const };
      }
      let result: Awaited<ReturnType<typeof embed>>;
      try {
        result = await embed({
          model,
          purpose: "document",
          texts: batch.map(canonicalEmbeddingInput),
          signal: operationSignal,
        });
      } catch {
        return { published: [], existing: [], reason: "port_failure" as const };
      }
      const published: string[] = [];
      for (const record of batch) {
        if (!(await recheckEvidence(record))) {
          return { published, existing: [], reason: "evidence_changed" as const };
        }
        published.push(record.id);
      }
      return {
        published:
          result.vectors.length === batch.length &&
          result.modelFingerprint === modelDescriptorFingerprint(model)
            ? published
            : [],
        existing: [],
        reason: null,
      };
    },
  );
  const vectors: Lm2VectorStore = {
    beginIndexOperation: vi.fn(async ({ deadline }) => {
      operationSignal = deadline.signal;
      return {
        status: "ready" as const,
        quotaRecovery: "not_needed" as const,
        publishBatch,
        finalize,
      };
    }),
    read: vi.fn(),
    reserveAndPublish: vi.fn(async ({ records: batch, embed, signal }) => {
      const result = await embed({
        model,
        purpose: "document",
        texts: batch.map((entry) => entry.text),
        signal,
      });
      return {
        published: result.vectors.length === batch.length ? batch.map((entry) => entry.id) : [],
        reason: null,
      };
    }),
  };
  const remoteApproval = { assertCurrent: vi.fn(async () => "approved" as const) };
  return {
    catalog,
    store,
    eligibility,
    evidenceEligibility,
    embedding,
    vectors,
    publishBatch,
    finalize,
    remoteApproval,
    index: createLm2IndexService({
      catalog,
      store,
      vectors,
      evidenceEligibility,
      embedding,
      model,
      remoteApproval: input.remote ? remoteApproval : undefined,
      approvalRef: input.remote ? "approval-1" : undefined,
      defaultTimeoutMs: 100,
    }),
  };
}

describe("LM2 explicit indexer", () => {
  it("acquires the operation before catalog work and retries a busy page origin", async () => {
    const test = harness([snapshot(0)]);
    vi.mocked(test.vectors.beginIndexOperation).mockResolvedValueOnce({ status: "busy" });

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(test.vectors.beginIndexOperation).toHaveBeenCalledTimes(1);
    expect(test.catalog.page).not.toHaveBeenCalled();
    expect(test.store.getById).not.toHaveBeenCalled();
    expect(receipt).toEqual({
      indexedCount: 0,
      omitted: [],
      outcome: "retry",
      nextCursor: null,
      retryCursor: null,
      transientReason: "index_busy",
      quotaRecovery: "not_needed",
    });
  });

  it("does not embed revoked document text", async () => {
    const revoked = snapshot(0);
    const eligible = snapshot(1);
    const test = harness([revoked, eligible]);
    test.eligibility.set(firstEvidenceId(revoked), "revoked");

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      cursor: undefined,
    });

    expect(test.embedding.embed.mock.calls.flatMap(([call]) => call.texts)).not.toContain(
      revoked.text,
    );
    expect(receipt.omitted).toContainEqual({ id: revoked.id, reason: "evidence_ineligible" });
    expect(receipt.indexedCount).toBe(1);
    expect(receipt.outcome).toBe("complete");
    expect(test.catalog.page).toHaveBeenCalledTimes(1);
    expect(test.finalize).toHaveBeenCalledTimes(1);
  });

  it("requires transition and both endpoint evidence", async () => {
    const pre = snapshot(0, { observedAt: "2026-07-20T00:00:00.000Z", stateKey: "billing" });
    const post = snapshot(1, { observedAt: "2026-07-20T00:00:02.000Z", stateKey: "billing" });
    const changed = transition(2, pre, post);
    const test = harness([changed, pre, post]);
    test.eligibility.set(firstEvidenceId(post), "revoked");

    await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(test.embedding.embed).not.toHaveBeenCalledWith(
      expect.objectContaining({ texts: expect.arrayContaining([changed.text]) }),
    );
  });

  it("stops before the record that would exceed 256 distinct evidence ids", async () => {
    const records = Array.from({ length: 257 }, (_, index) => snapshot(index));
    const test = harness(records);

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt.indexedCount).toBe(256);
    expect(receipt).toMatchObject({ outcome: "continue", indexedCount: 256 });
    expect(receipt.nextCursor).not.toBeNull();
    expect(test.embedding.embed.mock.calls.every(([call]) => call.texts.length <= 16)).toBe(true);
  });

  it("retries the first record that exceeds the evidence budget after committing the prefix", async () => {
    const records = Array.from({ length: 129 }, (_, index) =>
      snapshot(index, {
        evidenceIds: [evidenceId(index * 2), evidenceId(index * 2 + 1)],
        evidenceDigests: ["c".repeat(64), "d".repeat(64)],
      }),
    );
    const test = harness(records);

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toMatchObject({
      outcome: "retry",
      indexedCount: 128,
      transientReason: "evidence_cap_exhausted",
    });
    expect(cursorSequence(receipt.retryCursor)).toBe(129);
  });

  it("charges rejected evidence before resolving the next distinct id", async () => {
    const records = Array.from({ length: 129 }, (_, index) =>
      snapshot(index, {
        evidenceIds: [evidenceId(index * 2), evidenceId(index * 2 + 1)],
        evidenceDigests: ["c".repeat(64), "d".repeat(64)],
      }),
    );
    const test = harness(records);
    for (const record of records) {
      for (const id of record.evidenceIds) test.eligibility.set(id, "revoked");
    }

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(test.evidenceEligibility.resolve).toHaveBeenCalledTimes(128);
    expect(receipt).toMatchObject({
      outcome: "retry",
      transientReason: "evidence_cap_exhausted",
    });
    expect(receipt.omitted).toHaveLength(128);
    expect(cursorSequence(receipt.retryCursor)).toBe(129);
  });

  it("checks current remote approval before every document batch", async () => {
    const test = harness(
      Array.from({ length: 17 }, (_, index) => snapshot(index)),
      { remote: true },
    );

    await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(test.remoteApproval.assertCurrent).toHaveBeenCalledTimes(2);
    expect(test.remoteApproval.assertCurrent).toHaveBeenNthCalledWith(1, {
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      purpose: "document",
      approvalRef: "approval-1",
    });
  });

  it("performs zero egress and preserves the batch cursor when approval is denied", async () => {
    const test = harness([snapshot(0)], { remote: true });
    test.remoteApproval.assertCurrent.mockResolvedValue("revoked");

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(test.embedding.embed).not.toHaveBeenCalled();
    expect(receipt).toEqual({
      indexedCount: 0,
      omitted: [],
      outcome: "retry",
      nextCursor: null,
      retryCursor: null,
      transientReason: "remote_approval_denied",
      quotaRecovery: "not_needed",
    });
  });

  it("accounts for a committed first batch and retries the denied second batch", async () => {
    const test = harness(
      Array.from({ length: 17 }, (_, index) => snapshot(index)),
      { remote: true },
    );
    test.remoteApproval.assertCurrent
      .mockResolvedValueOnce("approved")
      .mockResolvedValueOnce("revoked");

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toMatchObject({
      outcome: "retry",
      indexedCount: 16,
      transientReason: "remote_approval_denied",
    });
    expect(cursorSequence(receipt.retryCursor)).toBe(17);
    expect(test.finalize).toHaveBeenCalledTimes(1);
  });

  it("maps catalog expiration to a terminal expired receipt and finalizes once", async () => {
    const test = harness([snapshot(0)]);
    vi.mocked(test.catalog.page).mockImplementationOnce(() => {
      throw new Lm2Error("cursor_expired", "expired");
    });

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toEqual({
      indexedCount: 0,
      omitted: [],
      outcome: "expired",
      nextCursor: null,
      retryCursor: null,
      transientReason: null,
      quotaRecovery: "not_needed",
    });
    expect(test.finalize).toHaveBeenCalledTimes(1);
  });

  it("rechecks eligibility before publication and drops a revoked result", async () => {
    const record = snapshot(0);
    const test = harness([record]);
    test.embedding.embed.mockImplementationOnce(async () => {
      test.eligibility.set(firstEvidenceId(record), "revoked");
      return { modelFingerprint: modelDescriptorFingerprint(model), vectors: [[1, 0]] };
    });

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt.indexedCount).toBe(0);
    expect(receipt.nextCursor).toBeNull();
  });

  it("does not publish a real sidecar after post-dispatch revocation", async () => {
    const record = snapshot(0);
    const test = harness([record]);
    const root = createRoot();
    const vectors = createLm2VectorStore({ storeRoot: root });
    const index = createLm2IndexService({
      catalog: test.catalog,
      store: test.store,
      vectors,
      evidenceEligibility: test.evidenceEligibility,
      embedding: {
        egress: "local",
        embed: async () => {
          test.eligibility.set(firstEvidenceId(record), "revoked");
          return { modelFingerprint: modelDescriptorFingerprint(model), vectors: [[1, 0]] };
        },
      },
      model,
      defaultTimeoutMs: 100,
    });

    await index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(existsSync(sidecarPath(root, candidate(record), model))).toBe(false);
  });

  it("embeds only the admitted missing subset when a batch already has a committed sidecar", async () => {
    const existing = snapshot(0);
    const missing = snapshot(1);
    const test = harness([existing, missing]);
    const root = createRoot();
    const vectors = createLm2VectorStore({ storeRoot: root });
    const controller = new AbortController();
    const operation = await vectors.beginIndexOperation({
      workspaceKey,
      model,
      deadline: { signal: controller.signal, deadlineAtMs: 15_000, now: () => 0 },
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    await operation.publishBatch({
      records: [candidate(existing)],
      embed: test.embedding.embed,
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
    });
    await operation.finalize();
    test.embedding.embed.mockClear();
    const index = createLm2IndexService({
      catalog: test.catalog,
      store: test.store,
      vectors,
      evidenceEligibility: test.evidenceEligibility,
      embedding: test.embedding,
      model,
      defaultTimeoutMs: 15_000,
    });

    const receipt = await index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toMatchObject({ outcome: "complete", indexedCount: 1 });
    expect(receipt.omitted).toContainEqual({ id: existing.id, reason: "already_indexed" });
    expect(test.embedding.embed).toHaveBeenCalledWith(
      expect.objectContaining({ texts: [canonicalEmbeddingInput(candidate(missing))] }),
    );
  });

  it("retries the first missing record when approval denial follows a committed sidecar", async () => {
    const existing = snapshot(0);
    const missing = snapshot(1);
    const test = harness([existing, missing], { remote: true });
    const root = createRoot();
    const vectors = createLm2VectorStore({ storeRoot: root });
    const operation = await vectors.beginIndexOperation({
      workspaceKey,
      model,
      deadline: {
        signal: new AbortController().signal,
        deadlineAtMs: 15_000,
        now: () => 0,
      },
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    await operation.publishBatch({
      records: [candidate(existing)],
      embed: test.embedding.embed,
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
    });
    await operation.finalize();
    test.embedding.embed.mockClear();
    test.remoteApproval.assertCurrent.mockResolvedValue("revoked");
    let indexPublish: ReturnType<typeof vi.fn> | undefined;
    const indexedVectors: Pick<Lm2VectorStore, "beginIndexOperation"> = {
      async beginIndexOperation(request) {
        const ready = await vectors.beginIndexOperation(request);
        if (ready.status !== "ready") return ready;
        indexPublish = vi.fn(ready.publishBatch);
        return { ...ready, publishBatch: indexPublish };
      },
    };
    const index = createLm2IndexService({
      catalog: test.catalog,
      store: test.store,
      vectors: indexedVectors,
      evidenceEligibility: test.evidenceEligibility,
      embedding: test.embedding,
      model,
      remoteApproval: test.remoteApproval,
      approvalRef: "approval-1",
      defaultTimeoutMs: 15_000,
    });

    const receipt = await index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toMatchObject({
      outcome: "retry",
      indexedCount: 0,
      transientReason: "remote_approval_denied",
    });
    expect(cursorSequence(receipt.retryCursor)).toBe(2);
    expect(test.embedding.embed).not.toHaveBeenCalled();
    expect(indexPublish).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled approval and releases the operation after exact existing progress", async () => {
    const existing = snapshot(0);
    const missing = snapshot(1);
    const test = harness([existing, missing], { remote: true });
    const root = createRoot();
    const vectors = createLm2VectorStore({ storeRoot: root });
    const seed = await vectors.beginIndexOperation({
      workspaceKey,
      model,
      deadline: {
        signal: new AbortController().signal,
        deadlineAtMs: 15_000,
        now: () => 0,
      },
    });
    if (seed.status !== "ready") throw new Error("operation unavailable");
    await seed.publishBatch({
      records: [candidate(existing)],
      embed: test.embedding.embed,
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
    });
    await seed.finalize();
    test.embedding.embed.mockClear();
    let resolveApproval!: (value: "approved") => void;
    test.remoteApproval.assertCurrent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    const index = createLm2IndexService({
      catalog: test.catalog,
      store: test.store,
      vectors,
      evidenceEligibility: test.evidenceEligibility,
      embedding: test.embedding,
      model,
      remoteApproval: test.remoteApproval,
      approvalRef: "approval-1",
      defaultTimeoutMs: 100,
    });

    const receipt = await index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      timeoutMs: 500,
    });

    expect(receipt).toMatchObject({
      outcome: "retry",
      indexedCount: 0,
      transientReason: "timeout",
    });
    expect(receipt.omitted).toEqual([{ id: existing.id, reason: "already_indexed" }]);
    expect(cursorSequence(receipt.retryCursor)).toBe(2);
    expect(test.embedding.embed).not.toHaveBeenCalled();
    resolveApproval("approved");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(test.embedding.embed).not.toHaveBeenCalled();
    expect(existsSync(sidecarPath(root, candidate(missing), model))).toBe(false);
    const next = await vectors.beginIndexOperation({
      workspaceKey,
      model,
      deadline: {
        signal: new AbortController().signal,
        deadlineAtMs: 15_000,
        now: () => 0,
      },
    });
    expect(next).toMatchObject({ status: "ready", quotaRecovery: "not_needed" });
    if (next.status === "ready") await next.finalize();
  }, 5_000);

  it("uses original-batch existing progress for a non-denial transient", async () => {
    const existing = snapshot(0);
    const missing = snapshot(1);
    const test = harness([existing, missing]);
    test.publishBatch.mockImplementationOnce(async () => ({
      published: [],
      existing: [existing.id],
      reason: "port_failure" as const,
    }));

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt.omitted).toEqual([{ id: existing.id, reason: "already_indexed" }]);
    expect(receipt).toMatchObject({ outcome: "retry", transientReason: "embedding_failure" });
    expect(cursorSequence(receipt.retryCursor)).toBe(2);
    expect(test.publishBatch).toHaveBeenCalledTimes(1);
  });

  it("advances after every planned record committed before a later error", async () => {
    const records = [snapshot(0), snapshot(1)];
    const test = harness(records);
    test.publishBatch.mockImplementationOnce(async () => ({
      published: records.map(({ id }) => id),
      existing: [],
      reason: "write_failed" as const,
    }));

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toMatchObject({ outcome: "complete", indexedCount: 2 });
    expect(receipt.transientReason).toBeNull();
  });

  it("never sends more than 16 documents, 65,536 units, or an 8,192-unit projection", async () => {
    const oversized = snapshot(0, { text: "x".repeat(8_193) });
    const records = [oversized, ...Array.from({ length: 17 }, (_, index) => snapshot(index + 1))];
    const test = harness(records);

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt.omitted).toContainEqual({ id: oversized.id, reason: "input_limit" });
    for (const [call] of test.embedding.embed.mock.calls) {
      expect(call.texts.length).toBeLessThanOrEqual(16);
      expect(
        call.texts.reduce((total: number, text: string) => total + text.length, 0),
      ).toBeLessThanOrEqual(65_536);
      expect(call.texts.every((text: string) => text.length <= 8_192)).toBe(true);
    }
  });

  it("stops catalog/direct work at 1,024 and raw text at 16 MiB", async () => {
    const records = Array.from({ length: 1_100 }, (_, index) =>
      snapshot(index, { text: "x".repeat(20_000), evidenceIds: [evidenceId(index % 250)] }),
    );
    const test = harness(records);

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(vi.mocked(test.catalog.page).mock.calls.length).toBeLessThanOrEqual(1_024);
    expect(vi.mocked(test.store.getById).mock.calls.length).toBeLessThanOrEqual(1_024);
    expect(receipt.nextCursor).not.toBeNull();
  });

  it("preserves the first eligible cursor beyond request capacity", async () => {
    const test = harness([snapshot(0), snapshot(1)]);

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 1,
    });

    expect(receipt).toMatchObject({ indexedCount: 1, outcome: "continue" });
    expect(receipt.nextCursor).not.toBeNull();
  });

  it("aborts timed-out embedding and cannot publish a late result", async () => {
    const record = snapshot(0);
    const test = harness([record]);
    test.embedding.embed.mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                modelFingerprint: modelDescriptorFingerprint(model),
                vectors: [[1, 0]],
              }),
            { once: true },
          );
        }),
    );

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      timeoutMs: 5,
    });

    expect(receipt).toEqual({
      indexedCount: 0,
      omitted: [],
      outcome: "retry",
      nextCursor: null,
      retryCursor: null,
      transientReason: "timeout",
      quotaRecovery: "not_needed",
    });
    expect(test.finalize).toHaveBeenCalledTimes(1);
  });

  it("drains a timed-out live publication before finalizing and reports its committed prefix", async () => {
    const records = [snapshot(0), snapshot(1)];
    const test = harness(records);
    let release = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const publicationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    test.publishBatch.mockImplementationOnce(async () => {
      started();
      await gate;
      return { published: [records[0]?.id], existing: [], reason: "port_failure" as const };
    });

    const pending = test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      timeoutMs: 5,
    });
    await publicationStarted;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const finalizedBeforeDrain = test.finalize.mock.calls.length;
    release();
    const receipt = await pending;

    expect(finalizedBeforeDrain).toBe(0);
    expect(test.finalize).toHaveBeenCalledTimes(1);
    expect(receipt).toMatchObject({
      outcome: "retry",
      indexedCount: 1,
      transientReason: "timeout",
    });
    expect(cursorSequence(receipt.retryCursor)).toBe(2);
  });

  it("checks the absolute deadline after a synchronous catalog snapshot", async () => {
    const test = harness([snapshot(0)]);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.mocked(test.catalog.page).mockImplementationOnce(() => {
      now = 101;
      return { generation: 1, entries: [], nextCursor: null };
    });

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      timeoutMs: 100,
    });

    expect(receipt).toMatchObject({ outcome: "retry", transientReason: "timeout" });
    expect(test.store.getById).not.toHaveBeenCalled();
    expect(test.evidenceEligibility.resolve).not.toHaveBeenCalled();
    expect(test.publishBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["fingerprint", { modelFingerprint: "f".repeat(64), vectors: [[1, 0]] }],
    ["count", { modelFingerprint: modelDescriptorFingerprint(model), vectors: [] }],
    ["dimension", { modelFingerprint: modelDescriptorFingerprint(model), vectors: [[1]] }],
    [
      "finite values",
      { modelFingerprint: modelDescriptorFingerprint(model), vectors: [[1, Number.NaN]] },
    ],
    [
      "unexpected ids",
      {
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [[1, 0]],
        candidateIds: [snapshot(0).id],
      },
    ],
  ])("rejects an embedding result with invalid %s", async (_label, result) => {
    const test = harness([snapshot(0)]);
    test.embedding.embed.mockImplementationOnce(async () => result);

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    expect(receipt).toMatchObject({
      outcome: "retry",
      indexedCount: 0,
      transientReason: "embedding_failure",
    });
  });

  it.each(["symbol", "non-enumerable"])(
    "rejects an embedding result with an unexpected %s key",
    async (kind) => {
      const test = harness([snapshot(0)]);
      const result = {
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [[1, 0]],
      };
      if (kind === "symbol") Reflect.defineProperty(result, Symbol("candidateIds"), { value: [] });
      else Reflect.defineProperty(result, "candidateIds", { value: [], enumerable: false });
      test.embedding.embed.mockImplementationOnce(async () => result);

      const receipt = await test.index.index({
        workspaceKey,
        modelFingerprint: modelDescriptorFingerprint(model),
        maxRecords: 256,
      });

      expect(receipt).toMatchObject({ outcome: "retry", transientReason: "embedding_failure" });
      expect(receipt.indexedCount).toBe(0);
    },
  );

  it("rejects remote configuration without an approval reference", () => {
    const test = harness([snapshot(0)]);

    expect(() =>
      createLm2IndexService({
        catalog: test.catalog,
        store: test.store,
        vectors: test.vectors,
        evidenceEligibility: test.evidenceEligibility,
        embedding: { ...test.embedding, egress: "remote" },
        model,
        remoteApproval: test.remoteApproval,
        defaultTimeoutMs: 100,
      }),
    ).toThrowError(Lm2Error);
  });

  it("publishes only the public canonical candidate projection", async () => {
    const record = snapshot(0, { stateKey: "private", action: null });
    const test = harness([record]);

    await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    const firstCall = test.publishBatch.mock.calls[0];
    if (firstCall === undefined) throw new Error("vector store was not called");
    const published = firstCall[0].records[0];
    expect(published).toEqual(candidate(record));
    if (published === undefined) throw new Error("vector store received no record");
    expect(Object.keys(published)).toEqual([
      "id",
      "workspaceKey",
      "observedAt",
      "kind",
      "text",
      "sourceDigest",
    ]);
    expect(test.embedding.embed).toHaveBeenCalledWith({
      model,
      purpose: "document",
      texts: [canonicalEmbeddingInput(candidate(record))],
      signal: expect.any(AbortSignal),
    });
  });
});
