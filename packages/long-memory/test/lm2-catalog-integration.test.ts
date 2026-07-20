import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileLm1Store } from "../src/lm1-store.js";
import { createLm2CandidateCatalog } from "../src/lm2-catalog.js";
import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { createLm2IndexService } from "../src/lm2-index.js";
import type { Lm2Candidate, ModelDescriptor } from "../src/lm2-model.js";
import {
  lm2PendingTemporaryName,
  lm2QuotaLedgerSchema,
  recordIdentityDigest,
  serializeLm2QuotaLedger,
} from "../src/lm2-quota-ledger.js";
import { embeddingsPath, vectorQuotaLedgerPath } from "../src/lm2-vector-paths.js";
import { createLm2VectorStore } from "../src/lm2-vector-store.js";
import { cleanupRoots, createRecord, createRoot, workspaceKey } from "./lm2-catalog-fixtures.js";

const observedDirectories = vi.hoisted(() => [] as string[]);

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    opendirSync(path: Parameters<typeof actual.opendirSync>[0]) {
      observedDirectories.push(String(path));
      return actual.opendirSync(path);
    },
  };
});

function candidate(record: ReturnType<typeof createRecord>): Lm2Candidate {
  return {
    id: record.id,
    workspaceKey: record.workspaceKey,
    observedAt: record.observedAt,
    kind: record.kind,
    text: record.text,
    sourceDigest: record.sourceDigest,
  };
}

afterEach(() => {
  observedDirectories.length = 0;
  cleanupRoots();
});

describe("LM2 candidate catalog integration", () => {
  it("serializes multi-batch indexing and reports recovery of a published pending prefix", async () => {
    const root = createRoot();
    const records = Array.from({ length: 9 }, (_, index) =>
      createRecord(index, workspaceKey, `${index}:${"x".repeat(8_000)}`),
    );
    const store = createFileLm1Store({ storeRoot: root });
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    for (const record of records) {
      expect(store.publish(record).inserted).toBe(true);
      expect(catalog.appendPublished(record)).toBe(true);
    }
    const model: ModelDescriptor = {
      provider: "local",
      modelId: "catalog-integration",
      revision: "r1",
      dimensions: 2,
      embeddingInputVersion: "lm2-v1",
    };
    let embeddingCalls = 0;
    const vectors = createLm2VectorStore({ storeRoot: root });
    const index = createLm2IndexService({
      catalog,
      store,
      vectors,
      evidenceEligibility: {
        resolve: async ({ workspaceKey: requestedWorkspaceKey, evidenceIds: requestedIds }) =>
          requestedIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
      embedding: {
        egress: "local",
        embed: async ({ texts }) => {
          embeddingCalls += 1;
          return {
            modelFingerprint: modelDescriptorFingerprint(model),
            vectors: texts.map(() => [1, 0]),
          };
        },
      },
      model,
      defaultTimeoutMs: 15_000,
    });

    const initialReceipt = await index.index({
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 256,
      timeoutMs: 15_000,
    });

    expect(embeddingCalls).toBe(2);
    expect(initialReceipt).toMatchObject({
      indexedCount: 9,
      outcome: "complete",
      quotaRecovery: "not_needed",
    });

    const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
    const committed = lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")));
    const finalRecord = records.at(-1);
    const namespace = committed.namespaces[0];
    if (finalRecord === undefined || namespace === undefined) {
      throw new Error("Missing multi-batch integration fixture state.");
    }
    const fingerprint = modelDescriptorFingerprint(model);
    const finalPath = join(
      embeddingsPath(root, workspaceKey),
      fingerprint,
      `${finalRecord.id}.json`,
    );
    const serializedSidecar = readFileSync(finalPath, "utf8");
    const serializedBytes = Buffer.byteLength(serializedSidecar, "utf8");
    const operationId = "22222222-2222-4222-8222-222222222222";
    const allocationSequence = committed.committedThroughAllocation;
    const pendingEntry = {
      allocationSequence,
      modelFingerprint: fingerprint,
      recordId: finalRecord.id,
      recordIdentityDigest: recordIdentityDigest({
        workspaceKey,
        id: finalRecord.id,
        kind: finalRecord.kind,
        sourceDigest: finalRecord.sourceDigest,
        embeddingInputDigest: embeddingInputDigest({
          kind: finalRecord.kind,
          text: finalRecord.text,
        }),
        modelFingerprint: fingerprint,
      }),
      reservedBytes: (24 * 1024) as const,
      expectedSidecarDigest: createHash("sha256").update(serializedSidecar).digest("hex"),
      serializedBytes,
      temporaryName: lm2PendingTemporaryName(operationId, allocationSequence),
      finalName: `${finalRecord.id}.json`,
      phase: "published" as const,
    };
    const crashImage = lm2QuotaLedgerSchema.parse({
      ...committed,
      namespaces: [
        {
          ...namespace,
          sidecarCount: namespace.sidecarCount - 1,
          serializedBytes: namespace.serializedBytes - serializedBytes,
        },
      ],
      committedThroughAllocation: allocationSequence - 1,
      nextAllocationSequence: allocationSequence,
      activeOperation: {
        operationId,
        expectedGeneration: committed.generation,
        lockIdentity: committed.lockIdentity,
        lockToken: committed.lockToken,
      },
      pending: {
        operationId,
        expectedGeneration: committed.generation,
        firstAllocationSequence: allocationSequence,
        lastAllocationSequence: allocationSequence,
        entries: [pendingEntry],
      },
    });
    writeFileSync(ledgerPath, serializeLm2QuotaLedger(crashImage));

    await expect(
      vectors.read({
        workspaceKey,
        model,
        candidates: [candidate(finalRecord)],
        maxDecodedBytes: 64 * 1024 * 1024,
        signal: new AbortController().signal,
        deadlineAtMs: 1_000,
        now: () => 0,
      }),
    ).resolves.toEqual({
      vectors: [],
      diagnostics: [
        { candidateId: finalRecord.id, reason: "invalid_vectors" },
        { candidateId: finalRecord.id, reason: "quota_recovery_pending" },
      ],
    });

    observedDirectories.length = 0;
    const recoveredReceipt = await index.index({
      workspaceKey,
      modelFingerprint: fingerprint,
      maxRecords: 256,
      timeoutMs: 15_000,
    });

    expect(recoveredReceipt).toMatchObject({
      indexedCount: 0,
      outcome: "complete",
      quotaRecovery: "recovered_pending",
    });
    expect(embeddingCalls).toBe(2);
    expect(
      observedDirectories.filter((path) => path.startsWith(embeddingsPath(root, workspaceKey))),
    ).toEqual([]);
    expect(lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")))).toMatchObject({
      committedThroughAllocation: 9,
      nextAllocationSequence: 10,
      activeOperation: null,
      pending: null,
      namespaces: [
        {
          modelFingerprint: fingerprint,
          sidecarCount: 9,
          serializedBytes: namespace.serializedBytes,
        },
      ],
    });
  }, 60_000);
});
