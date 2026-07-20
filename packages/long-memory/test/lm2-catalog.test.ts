import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "../src/lm1-identity.js";
import type { Lm1Record } from "../src/lm1-model.js";
import { createFileLm1Store } from "../src/lm1-store.js";
import { createLm2CandidateCatalog } from "../src/lm2-catalog.js";
import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { createLm2IndexService } from "../src/lm2-index.js";
import type { Lm2Candidate, ModelDescriptor } from "../src/lm2-model.js";
import { lm2CandidateCatalogLockPath, lm2CandidateCatalogPath } from "../src/lm2-paths.js";
import {
  lm2PendingTemporaryName,
  lm2QuotaLedgerSchema,
  recordIdentityDigest,
  serializeLm2QuotaLedger,
} from "../src/lm2-quota-ledger.js";
import { embeddingsPath, vectorQuotaLedgerPath } from "../src/lm2-vector-paths.js";
import { createLm2VectorStore } from "../src/lm2-vector-store.js";

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

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceIds = ["11111111-1111-4111-8111-111111111111"];
const evidenceDigests = ["a".repeat(64)];
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-catalog-")));
  roots.push(root);
  return root;
}

function createRecord(
  index = 0,
  requestedWorkspaceKey = workspaceKey,
  text = `Billing status ${index} is paid.`,
): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey: requestedWorkspaceKey,
    kind: "state_snapshot" as const,
    observedAt: new Date(Date.UTC(2026, 6, 20, 0, 0, index % 60)).toISOString(),
    text,
    action: null,
    evidenceIds,
    stateKey: `billing.status.${index}`,
    representation: "value" as const,
    supersedesSnapshotId: null,
    redactionVersion: "redaction-v1",
  };
  const sourceDigest = canonicalCaptureDigest(capture);
  return {
    ...capture,
    id: deriveLm1RecordId(requestedWorkspaceKey, "state_snapshot", sourceDigest),
    sourceDigest,
    canonicalCaptureDigest: sourceDigest,
    evidenceBindingDigest: deriveEvidenceBindingDigest({
      workspaceKey: requestedWorkspaceKey,
      canonicalCaptureDigest: sourceDigest,
      evidenceIds,
      evidenceDigests,
    }),
    recordedAt: "2026-07-20T00:00:01.000Z",
    evidenceDigests,
    status: "recorded" as const,
  };
}

function catalogEntry(record: Lm1Record, captureSequence: number) {
  return {
    id: record.id,
    sourceDigest: record.sourceDigest,
    kind: record.kind,
    observedAt: record.observedAt,
    captureSequence,
  };
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

function writeCatalog(
  root: string,
  entries: readonly ReturnType<typeof catalogEntry>[],
  generation = entries.length,
): void {
  const path = lm2CandidateCatalogPath(root, workspaceKey);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, generation, entries })}\n`);
}

function holdCatalogLock(path: string): Promise<() => Promise<void>> {
  const script = [
    'import { closeSync, openSync } from "node:fs";',
    'import { flockSync } from "fs-ext";',
    'const descriptor = openSync(process.argv[1], "a+");',
    'flockSync(descriptor, "exnb");',
    'process.stdout.write("locked\\n");',
    'process.stdin.once("data", () => { closeSync(descriptor); process.exit(0); });',
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script, path], {
      cwd: packageDirectory,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => {
      if (chunk.toString() !== "locked\n") {
        reject(new Error(`Catalog lock child did not acquire lock: ${stderr}`));
        return;
      }
      resolve(
        () =>
          new Promise<void>((release, rejectRelease) => {
            child.once("error", rejectRelease);
            child.once("close", (code) => {
              if (code === 0) release();
              else rejectRelease(new Error(stderr));
            });
            child.stdin.end("release\n");
          }),
      );
    });
  });
}

afterEach(() => {
  observedDirectories.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM2 candidate catalog", () => {
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

  it("does not treat an existing catalog lock file as an active lock", () => {
    const root = createRoot();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const record = createRecord();
    writeFileSync(lm2CandidateCatalogLockPath(root, workspaceKey), "held\n");

    expect(catalog.appendPublished(record)).toBe(true);
    expect(createFileLm1Store({ storeRoot: root }).publish(record)).toMatchObject({
      inserted: true,
      record,
    });
  });

  it("fails closed without catalog writes while another process holds the advisory lock", async () => {
    const root = createRoot();
    const path = lm2CandidateCatalogLockPath(root, workspaceKey);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const release = await holdCatalogLock(path);
    try {
      expect(catalog.appendPublished(createRecord())).toBe(false);
      expect(() => readFileSync(lm2CandidateCatalogPath(root, workspaceKey), "utf8")).toThrow();
    } finally {
      await release();
    }
    expect(catalog.appendPublished(createRecord())).toBe(true);
  });

  it("stores only bounded metadata for an LM1 capture", () => {
    const root = createRoot();
    const record = createRecord();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(true);
    expect(JSON.parse(readFileSync(lm2CandidateCatalogPath(root, workspaceKey), "utf8"))).toEqual({
      schemaVersion: 1,
      generation: 1,
      entries: [catalogEntry(record, 1)],
    });
  });

  it("does not allocate a new sequence for an immutable duplicate", () => {
    const root = createRoot();
    const record = createRecord();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(true);
    expect(catalog.appendPublished(record)).toBe(true);
    expect(catalog.page({ workspaceKey, cursor: null, limit: 10 })).toMatchObject({
      generation: 1,
      entries: [catalogEntry(record, 1)],
    });
  });

  it("fails catalog updates closed for corrupt and conflicting duplicate entries", () => {
    const root = createRoot();
    const record = createRecord();
    writeCatalog(root, [
      catalogEntry(record, 1),
      { ...catalogEntry(record, 1), sourceDigest: "b".repeat(64) },
    ]);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(false);
    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("fails closed for static symlinked catalog directories", () => {
    const root = createRoot();
    const outside = createRoot();
    const workspaceDirectory = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspaceDirectory, { recursive: true });
    symlinkSync(outside, join(workspaceDirectory, ".lm2"));
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(createRecord())).toBe(false);
    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("evicts the oldest capture sequence after the 10,000-record rolling window", () => {
    const root = createRoot();
    const records = Array.from({ length: 10_001 }, (_, index) => createRecord(index));
    writeCatalog(
      root,
      records.slice(0, 10_000).map((record, index) => catalogEntry(record, index + 1)),
    );
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(records[10_000] as Lm1Record)).toBe(true);
    const page = catalog.page({ workspaceKey, cursor: null, limit: 10_000 });
    expect(page.entries).toHaveLength(10_000);
    expect(page.entries[0]).toMatchObject({ captureSequence: 2 });
    expect(page.entries.at(-1)).toMatchObject({ captureSequence: 10_001 });
  });

  it("rejects catalogs over the four-MiB serialized limit", () => {
    const root = createRoot();
    const path = lm2CandidateCatalogPath(root, workspaceKey);
    writeFileSync(path, "x".repeat(4 * 1024 * 1024 + 1));
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(createRecord())).toBe(false);
    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("resumes an opaque cursor across a generation change while its sequence is retained", () => {
    const root = createRoot();
    const first = createRecord(1);
    const second = createRecord(2);
    const third = createRecord(3);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    catalog.appendPublished(first);
    catalog.appendPublished(second);
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;
    catalog.appendPublished(third);

    expect(cursor).not.toBeNull();
    expect(catalog.page({ workspaceKey, cursor, limit: 1 })).toMatchObject({
      generation: 3,
      entries: [catalogEntry(second, 2)],
    });
  });

  it("reports cursor_expired once its next sequence falls out of the rolling window", () => {
    const root = createRoot();
    const records = Array.from({ length: 10_002 }, (_, index) => createRecord(index));
    writeCatalog(
      root,
      records.slice(0, 10_000).map((record, index) => catalogEntry(record, index + 1)),
    );
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;
    catalog.appendPublished(records[10_000] as Lm1Record);
    catalog.appendPublished(records[10_001] as Lm1Record);

    expect(() => catalog.page({ workspaceKey, cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "cursor_expired" }),
    );
  });

  it("rejects a catalog with nonconsecutive retained capture sequences", () => {
    const root = createRoot();
    const first = createRecord();
    const second = createRecord(1);
    writeCatalog(root, [catalogEntry(first, 5), catalogEntry(second, 7)]);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("expires structurally valid cursors outside the retained or future generation", () => {
    const root = createRoot();
    const first = createRecord();
    const second = createRecord(1);
    writeCatalog(root, [catalogEntry(first, 1), catalogEntry(second, 2)], 2);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;

    expect(cursor).not.toBeNull();
    writeCatalog(root, [catalogEntry(first, 5), catalogEntry(second, 6)], 2);
    expect(() => catalog.page({ workspaceKey, cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "cursor_expired" }),
    );
    writeCatalog(root, [catalogEntry(first, 5), catalogEntry(second, 6)], 1);
    expect(() => catalog.page({ workspaceKey, cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "cursor_expired" }),
    );
  });

  it("rejects malformed or cross-workspace opaque cursors", () => {
    const root = createRoot();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    catalog.appendPublished(createRecord());
    catalog.appendPublished(createRecord(1));
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;

    expect(() => catalog.page({ workspaceKey, cursor: "not-a-cursor", limit: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(cursor).not.toBeNull();
    expect(() => catalog.page({ workspaceKey: "fedcba9876543210", cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });

  it("reads exact LM1 locators with expected tuples and never needs record enumeration", () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root }) as ReturnType<
      typeof createFileLm1Store
    > & {
      getByIds(
        requestedWorkspaceKey: string,
        entries: readonly Pick<Lm1Record, "id" | "kind" | "sourceDigest">[],
        limit: number,
      ): readonly Lm1Record[];
    };
    const record = createRecord();
    const second = createRecord(1);
    const otherWorkspaceRecord = createRecord(2, "fedcba9876543210");
    store.publish(record);
    store.publish(second);
    store.publish(otherWorkspaceRecord);
    const snapshots = join(root, "long-memory", "v1", workspaceKey, "snapshots");
    writeFileSync(join(snapshots, `${"c".repeat(64)}.json`), "{corrupt");

    expect(store.getByIds(workspaceKey, [catalogEntry(record, 1)], 1)).toEqual([record]);
    expect(
      store.getByIds(workspaceKey, [catalogEntry(record, 1), catalogEntry(second, 2)], 1),
    ).toEqual([record]);
    expect(() =>
      store.getByIds(
        workspaceKey,
        [{ ...catalogEntry(record, 1), sourceDigest: "d".repeat(64) }],
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() => store.getByIds("fedcba9876543210", [catalogEntry(record, 1)], 1)).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
    expect(() =>
      store.getByIds(workspaceKey, [{ ...catalogEntry(record, 1), id: second.id }], 1),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() =>
      store.getByIds(workspaceKey, [{ ...catalogEntry(record, 1), kind: "state_transition" }], 1),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() => store.getByIds(workspaceKey, [catalogEntry(record, 1)], 10_001)).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});
