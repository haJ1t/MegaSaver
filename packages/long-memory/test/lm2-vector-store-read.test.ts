import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import {
  lm2PendingTemporaryName,
  lm2QuotaLedgerSchema,
  serializeLm2QuotaLedger,
} from "../src/lm2-quota-ledger.js";
import { buildSerializedSidecar } from "../src/lm2-vector-format.js";
import { vectorQuotaLedgerPath } from "../src/lm2-vector-paths.js";
import { createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

const deadline = () => ({
  signal: new AbortController().signal,
  deadlineAtMs: 1,
  now: () => 0,
});

const readDeadline = () => ({ deadlineAtMs: 1, now: () => 0 });

async function publish(root: string, records = [createCandidate()]) {
  const model = createModel();
  const store = createLm2VectorStore({ storeRoot: root });
  const operation = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
  expect(operation.status).toBe("ready");
  if (operation.status !== "ready") return { model, store };
  await operation.publishBatch({
    records,
    embed: async () => ({
      modelFingerprint: modelDescriptorFingerprint(model),
      vectors: records.map((_, index) => [index + 1, 2, 3]),
    }),
    assertEgressAllowed: async () => true,
    recheckEvidence: async () => true,
  });
  await operation.finalize();
  return { model, store };
}

function sidecarPath(root: string, model = createModel(), id = createCandidate().id): string {
  return join(
    root,
    "long-memory",
    "v1",
    workspaceKey,
    "embeddings-v2",
    modelDescriptorFingerprint(model),
    `${id}.json`,
  );
}

describe("LM2 committed vector reads", () => {
  it("reads only ledger-committed v2 vectors", async () => {
    const root = createRoot();
    const candidate = createCandidate();
    const { model, store } = await publish(root, [candidate]);

    await expect(
      store.read({
        workspaceKey,
        model,
        candidates: [candidate],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
        ...readDeadline(),
      }),
    ).resolves.toEqual({
      vectors: [{ candidateId: candidate.id, vector: [1, 2, 3], decodedBytes: 12 }],
      diagnostics: [],
    });
  });

  it("excludes pending allocations and reports recovery separately", async () => {
    const root = createRoot();
    const model = createModel();
    const candidate = createCandidate();
    const store = createLm2VectorStore({ storeRoot: root });
    const operation = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    expect(operation.status).toBe("ready");
    if (operation.status !== "ready") return;
    const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
    const ledger = lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")));
    if (ledger.activeOperation === null) throw new Error("expected active operation fence");
    const serialized = buildSerializedSidecar(model, candidate, [1, 2, 3], {
      ledgerEpoch: ledger.epoch,
      allocationSequence: 1,
    });
    const path = sidecarPath(root, model, candidate.id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serialized);
    const fingerprint = modelDescriptorFingerprint(model);
    const pending = {
      operationId: ledger.activeOperation.operationId,
      expectedGeneration: ledger.generation,
      firstAllocationSequence: 1,
      lastAllocationSequence: 1,
      entries: [
        {
          allocationSequence: 1,
          modelFingerprint: fingerprint,
          recordId: candidate.id,
          recordIdentityDigest: createHash("sha256").update("test").digest("hex"),
          reservedBytes: 24 * 1024,
          expectedSidecarDigest: createHash("sha256").update(serialized).digest("hex"),
          serializedBytes: Buffer.byteLength(serialized),
          temporaryName: lm2PendingTemporaryName(ledger.activeOperation.operationId, 1),
          finalName: `${candidate.id}.json`,
          phase: "published",
        },
      ],
    };
    writeFileSync(
      ledgerPath,
      serializeLm2QuotaLedger(lm2QuotaLedgerSchema.parse({ ...ledger, pending })),
    );

    const result = await store.read({
      workspaceKey,
      model,
      candidates: [candidate],
      maxDecodedBytes: 64,
      signal: new AbortController().signal,
      ...readDeadline(),
    });
    expect(result.vectors).toEqual([]);
    expect(result.diagnostics).toEqual([
      { candidateId: candidate.id, reason: "invalid_vectors" },
      { candidateId: candidate.id, reason: "quota_recovery_pending" },
    ]);
    await operation.finalize();
  });

  it("reports invalid unledgered v2 state without mutation", async () => {
    const root = createRoot();
    const model = createModel();
    const candidate = createCandidate();
    const path = sidecarPath(root, model, candidate.id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{invalid\n");
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.read({
        workspaceKey,
        model,
        candidates: [candidate],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
        ...readDeadline(),
      }),
    ).resolves.toEqual({
      vectors: [],
      diagnostics: [{ candidateId: candidate.id, reason: "quota_ledger_invalid" }],
    });
    expect(readFileSync(path, "utf8")).toBe("{invalid\n");
  });

  it("reports the decoded-byte limit without decoding a later vector", async () => {
    const root = createRoot();
    const candidates = [createCandidate(1), createCandidate(2)];
    const { model, store } = await publish(root, candidates);
    const result = await store.read({
      workspaceKey,
      model,
      candidates,
      maxDecodedBytes: 12,
      signal: new AbortController().signal,
      ...readDeadline(),
    });

    expect(result.vectors).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      { candidateId: candidates[1]?.id, reason: "vector_read_limit" },
    ]);
  });

  it("stops before a later named sidecar read at the monotonic deadline", async () => {
    const root = createRoot();
    const candidates = [createCandidate(1), createCandidate(2)];
    const { model, store } = await publish(root, candidates);
    writeFileSync(sidecarPath(root, model, candidates[1]?.id), "{must-not-be-read\n");
    const now = vi
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(5);

    const result = await store.read({
      workspaceKey,
      model,
      candidates,
      maxDecodedBytes: 64,
      signal: new AbortController().signal,
      deadlineAtMs: 5,
      now,
    });

    expect(result.vectors).toEqual([
      { candidateId: candidates[0]?.id, vector: [1, 2, 3], decodedBytes: 12 },
    ]);
    expect(result.diagnostics).toEqual([
      { candidateId: candidates[1]?.id, reason: "vector_read_limit" },
    ]);
  });

  it("reports missing vectors from an absent workspace without creating it", async () => {
    const root = createRoot();
    const candidate = createCandidate();
    await expect(
      createLm2VectorStore({ storeRoot: root }).read({
        workspaceKey,
        model: createModel(),
        candidates: [candidate],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
        ...readDeadline(),
      }),
    ).resolves.toEqual({
      vectors: [],
      diagnostics: [{ candidateId: candidate.id, reason: "missing_vectors" }],
    });
  });
});
