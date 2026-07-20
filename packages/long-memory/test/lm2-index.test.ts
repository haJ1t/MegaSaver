import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lm1Record } from "../src/lm1-model.js";
import type { FileLm1Store } from "../src/lm1-store.js";
import type { Lm2CandidateCatalog } from "../src/lm2-catalog.js";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { createLm2IndexService } from "../src/lm2-index.js";
import type { Lm2Candidate, ModelDescriptor } from "../src/lm2-model.js";
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

afterEach(cleanupRoots);

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
    page: vi.fn(({ cursor }) => {
      const index = cursor === null ? 0 : Number(cursor);
      const record = records[index];
      return {
        generation: records.length,
        entries:
          record === undefined
            ? []
            : [
                {
                  id: record.id,
                  sourceDigest: record.sourceDigest,
                  kind: record.kind,
                  observedAt: record.observedAt,
                  captureSequence: index + 1,
                },
              ],
        nextCursor: index + 1 < records.length ? String(index + 1) : null,
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
  const vectors: Lm2VectorStore = {
    readVerified: vi.fn(),
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
    expect(receipt.nextCursor).toBe("256");
    expect(test.embedding.embed.mock.calls.every(([call]) => call.texts.length <= 16)).toBe(true);
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
    expect(receipt).toEqual({ indexedCount: 0, omitted: [], nextCursor: null });
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

    expect(receipt).toMatchObject({ indexedCount: 1, nextCursor: "1" });
  });

  it("aborts timed-out embedding and cannot publish a late result", async () => {
    const record = snapshot(0);
    const test = harness([record]);
    let resolveEmbedding!: (value: { modelFingerprint: string; vectors: number[][] }) => void;
    test.embedding.embed.mockImplementationOnce(
      ({ signal }) =>
        new Promise((resolve) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          resolveEmbedding = resolve;
        }),
    );

    const receipt = await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      timeoutMs: 5,
    });
    resolveEmbedding({ modelFingerprint: modelDescriptorFingerprint(model), vectors: [[1, 0]] });
    await Promise.resolve();

    expect(receipt).toEqual({ indexedCount: 0, omitted: [], nextCursor: null });
  });

  it("publishes only the public canonical candidate projection", async () => {
    const record = snapshot(0, { stateKey: "private", action: null });
    const test = harness([record]);

    await test.index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
    });

    const firstCall = vi.mocked(test.vectors.reserveAndPublish).mock.calls[0];
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
  });
});
