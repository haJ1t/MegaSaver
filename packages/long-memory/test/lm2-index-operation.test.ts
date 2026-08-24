import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let failNextFsync = false;
let failNextClose = false;
let failNextPendingUnlink = false;
let failEveryClose = false;
let failCloseAfter: number | null = null;
let replaceLedgerContentAfterRename = false;
let replacedLedgerIdentity: {
  before: { dev: number; ino: number };
  after: { dev: number; ino: number };
} | null = null;
const injectedCloseFailures: Error[] = [];
const injectedFsyncFailures: Error[] = [];
const injectedPendingUnlinkFailures: Error[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    closeSync(descriptor: number) {
      actual.closeSync(descriptor);
      const delayedFailure = failCloseAfter === 0;
      if (failCloseAfter !== null && failCloseAfter > 0) failCloseAfter -= 1;
      if (delayedFailure) failCloseAfter = null;
      if (failEveryClose || failNextClose || delayedFailure) {
        failNextClose = false;
        const error = new Error("injected descriptor close failure");
        injectedCloseFailures.push(error);
        throw error;
      }
    },
    fsyncSync(descriptor: number) {
      if (failNextFsync) {
        failNextFsync = false;
        const error = new Error("injected post-link fsync failure");
        injectedFsyncFailures.push(error);
        throw error;
      }
      actual.fsyncSync(descriptor);
    },
    renameSync(oldPath: import("node:fs").PathLike, newPath: import("node:fs").PathLike) {
      actual.renameSync(oldPath, newPath);
      if (
        replaceLedgerContentAfterRename &&
        String(newPath).endsWith("vector-quota-ledger-v1.json")
      ) {
        replaceLedgerContentAfterRename = false;
        const before = actual.statSync(newPath);
        const ledger = JSON.parse(actual.readFileSync(newPath, "utf8"));
        ledger.generation += 1;
        if (ledger.activeOperation !== null) ledger.activeOperation.expectedGeneration += 1;
        if (ledger.pending !== null) ledger.pending.expectedGeneration += 1;
        actual.writeFileSync(newPath, `${JSON.stringify(ledger)}\n`);
        const after = actual.statSync(newPath);
        replacedLedgerIdentity = {
          before: { dev: before.dev, ino: before.ino },
          after: { dev: after.dev, ino: after.ino },
        };
      }
    },
    unlinkSync(path: import("node:fs").PathLike) {
      if (failNextPendingUnlink && String(path).endsWith(".pending")) {
        failNextPendingUnlink = false;
        const error = new Error("injected pending unlink failure");
        injectedPendingUnlinkFailures.push(error);
        throw error;
      }
      actual.unlinkSync(path);
    },
  };
});

import type { Lm1Record } from "../src/lm1-model.js";
import type { FileLm1Store } from "../src/lm1-store.js";
import type { Lm2CandidateCatalog } from "../src/lm2-catalog.js";
import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { createLm2IndexPlanSequence } from "../src/lm2-index-plan.js";
import { createLm2IndexService } from "../src/lm2-index.js";
import { createPendingAllocations } from "../src/lm2-ledger-recovery.js";
import type { Lm2Candidate } from "../src/lm2-model.js";
import {
  lm2PendingTemporaryName,
  lm2QuotaLedgerSchema,
  recordIdentityDigest,
  serializeLm2QuotaLedger,
} from "../src/lm2-quota-ledger.js";
import {
  closeAnchoredFile,
  closeDirectoryAnchor,
  openAnchoredUpdateFile,
} from "../src/lm2-secure-fs.js";
import {
  closeAndRemoveAnchoredTemporary,
  materializeAnchoredFile,
  publishLm2ReservedBatch,
} from "../src/lm2-secure-publish.js";
import { buildSerializedSidecar } from "../src/lm2-vector-format.js";
import { ensureVectorNamespace, vectorQuotaLedgerPath } from "../src/lm2-vector-paths.js";
import { createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  holdIndexLock,
  indexLockPath,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(() => {
  failNextFsync = false;
  failNextClose = false;
  failNextPendingUnlink = false;
  failEveryClose = false;
  failCloseAfter = null;
  replaceLedgerContentAfterRename = false;
  replacedLedgerIdentity = null;
  injectedCloseFailures.length = 0;
  injectedFsyncFailures.length = 0;
  injectedPendingUnlinkFailures.length = 0;
  cleanupRoots();
});

function deadline() {
  const controller = new AbortController();
  return { signal: controller.signal, deadlineAtMs: 10_000, now: () => 0 };
}

function exactCleanupRoots(error: unknown): unknown[] {
  if (error instanceof AggregateError) return error.errors.flatMap(exactCleanupRoots);
  if (error instanceof Error && error.cause !== undefined) return exactCleanupRoots(error.cause);
  return [error];
}

describe("LM2 index operation", () => {
  it("consumes only the exact one-shot batch plan under its originating operation", async () => {
    const model = createModel();
    const records = [createCandidate(1), createCandidate(2)];
    const context = {
      operationId: "11111111-1111-4111-8111-111111111111",
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      deadlineAtMs: 100,
    };
    const sequence = createLm2IndexPlanSequence(context);
    const foreign = createLm2IndexPlanSequence({
      ...context,
      operationId: "22222222-2222-4222-8222-222222222222",
    });
    const egress = vi.fn(async () => "sent");
    const plan = sequence.mint({
      generation: 7,
      candidates: records,
      existingIds: [],
      missingIds: records.map(({ id }) => id),
    });

    expect(
      await foreign.consume(plan, {
        generation: 7,
        candidates: records,
        existingIds: [],
        missingIds: records.map(({ id }) => id),
        now: 0,
        egress,
      }),
    ).toEqual({ status: "rejected" });
    for (const attempt of [
      { candidates: records.slice(0, 1), missingIds: [records[0]?.id] },
      { candidates: [...records].reverse(), missingIds: records.map(({ id }) => id).reverse() },
      { candidates: [records[0], records[0]], missingIds: [records[0]?.id, records[0]?.id] },
    ]) {
      expect(
        await sequence.consume(plan, {
          generation: 7,
          candidates: attempt.candidates.filter(
            (record): record is (typeof records)[number] => record !== undefined,
          ),
          existingIds: [],
          missingIds: attempt.missingIds.filter((id): id is string => id !== undefined),
          now: 0,
          egress,
        }),
      ).toEqual({ status: "rejected" });
    }
    expect(egress).not.toHaveBeenCalled();

    const consumed = await sequence.consume(plan, {
      generation: 7,
      candidates: records,
      existingIds: [],
      missingIds: records.map(({ id }) => id),
      now: 0,
      egress,
    });
    expect(consumed).toEqual({ status: "consumed", value: "sent" });
    expect(() =>
      sequence.mint({
        generation: 8,
        candidates: records,
        existingIds: [],
        missingIds: records.map(({ id }) => id),
      }),
    ).toThrow();
    await expect(
      sequence.consume(plan, {
        generation: 7,
        candidates: records,
        existingIds: [],
        missingIds: records.map(({ id }) => id),
        now: 0,
        egress,
      }),
    ).resolves.toEqual({ status: "rejected" });
    expect(egress).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      existingIds: [createCandidate(2).id, createCandidate(1).id],
      missingIds: [createCandidate(3).id],
    },
    {
      existingIds: [createCandidate(1).id],
      missingIds: [createCandidate(3).id, createCandidate(2).id],
    },
  ])("rejects a noncanonical ordered projection before egress", ({ existingIds, missingIds }) => {
    const records = [createCandidate(1), createCandidate(2), createCandidate(3)];
    const sequence = createLm2IndexPlanSequence({
      operationId: "11111111-1111-4111-8111-111111111111",
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(createModel()),
      deadlineAtMs: 100,
    });
    const egress = vi.fn();

    expect(() =>
      sequence.mint({ generation: 1, candidates: records, existingIds, missingIds }),
    ).toThrow();
    expect(egress).not.toHaveBeenCalled();
  });

  it("rejects post-plan mutation and expiry without egress", async () => {
    const record = createCandidate(1);
    const sequence = createLm2IndexPlanSequence({
      operationId: "11111111-1111-4111-8111-111111111111",
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(createModel()),
      deadlineAtMs: 100,
    });
    const egress = vi.fn();
    const plan = sequence.mint({
      generation: 1,
      candidates: [record],
      existingIds: [],
      missingIds: [record.id],
    });
    record.text = "mutated after planning";
    await expect(
      sequence.consume(plan, {
        generation: 1,
        candidates: [record],
        existingIds: [],
        missingIds: [record.id],
        now: 0,
        egress,
      }),
    ).resolves.toEqual({ status: "rejected" });
    const expiring = createLm2IndexPlanSequence({
      operationId: "22222222-2222-4222-8222-222222222222",
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(createModel()),
      deadlineAtMs: 100,
    });
    const fresh = createCandidate(2);
    const expired = expiring.mint({
      generation: 1,
      candidates: [fresh],
      existingIds: [],
      missingIds: [fresh.id],
    });
    await expect(
      expiring.consume(expired, {
        generation: 1,
        candidates: [fresh],
        existingIds: [],
        missingIds: [fresh.id],
        now: 100,
        egress,
      }),
    ).resolves.toEqual({ status: "rejected" });
    expect(egress).not.toHaveBeenCalled();
  });

  it("consumes a 17-record sequence only as batches of sixteen then one", async () => {
    const records = Array.from({ length: 17 }, (_, index) => createCandidate(index + 1));
    const sequence = createLm2IndexPlanSequence({
      operationId: "11111111-1111-4111-8111-111111111111",
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(createModel()),
      deadlineAtMs: 100,
    });
    const egress = vi.fn(async (batch: readonly Lm2Candidate[]) => batch.map(({ id }) => id));
    const firstRecords = records.slice(0, 16);
    const first = sequence.mint({
      generation: 1,
      candidates: firstRecords,
      existingIds: [],
      missingIds: firstRecords.map(({ id }) => id),
    });
    await sequence.consume(first, {
      generation: 1,
      candidates: firstRecords,
      existingIds: [],
      missingIds: firstRecords.map(({ id }) => id),
      now: 0,
      egress,
    });
    await expect(
      sequence.consume(first, {
        generation: 1,
        candidates: firstRecords,
        existingIds: [],
        missingIds: firstRecords.map(({ id }) => id),
        now: 0,
        egress,
      }),
    ).resolves.toEqual({ status: "rejected" });
    expect(() =>
      sequence.mint({
        generation: 2,
        candidates: firstRecords,
        existingIds: [],
        missingIds: firstRecords.map(({ id }) => id),
      }),
    ).toThrow();
    const secondRecords = records.slice(16);
    const second = sequence.mint({
      generation: 2,
      candidates: secondRecords,
      existingIds: [],
      missingIds: secondRecords.map(({ id }) => id),
    });
    await sequence.consume(second, {
      generation: 2,
      candidates: secondRecords,
      existingIds: [],
      missingIds: secondRecords.map(({ id }) => id),
      now: 0,
      egress,
    });

    expect(egress.mock.calls.map(([batch]) => batch.length)).toEqual([16, 1]);
  });

  it("rejects a concurrent batch before reservation or egress", async () => {
    const root = createRoot();
    const model = createModel();
    const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = operation.publishBatch({
      records: [createCandidate(1)],
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
      embed: async () => {
        markStarted();
        await firstGate;
        return {
          modelFingerprint: modelDescriptorFingerprint(model),
          vectors: [[1, 2, 3]],
        };
      },
    });
    await firstStarted;
    const secondEmbed = vi.fn();

    await expect(
      operation.publishBatch({
        records: [createCandidate(2)],
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
        embed: secondEmbed,
      }),
    ).resolves.toEqual({ published: [], existing: [], reason: "lock_integrity_lost" });
    expect(secondEmbed).not.toHaveBeenCalled();
    releaseFirst();
    await expect(first).resolves.toMatchObject({ reason: null });
    await operation.finalize();
  });

  it("publishes 17 real records as sixteen then one without replay egress", async () => {
    const root = createRoot();
    const model = createModel();
    const records = Array.from({ length: 17 }, (_, index) => createCandidate(index + 1));
    const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    const embed = vi.fn(async ({ texts }: { texts: readonly string[] }) => ({
      modelFingerprint: modelDescriptorFingerprint(model),
      vectors: texts.map(() => [1, 2, 3]),
    }));
    const publish = (batch: readonly Lm2Candidate[]) =>
      operation.publishBatch({
        records: batch,
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
        embed,
      });

    await expect(publish(records.slice(0, 16))).resolves.toMatchObject({ reason: null });
    await expect(publish(records.slice(16))).resolves.toMatchObject({ reason: null });
    await expect(publish(records.slice(0, 16))).resolves.toMatchObject({ reason: null });

    expect(embed.mock.calls.map(([call]) => call.texts.length)).toEqual([16, 1]);
    await operation.finalize();
  });

  it("initializes one fenced ledger before returning a ready capability", async () => {
    const root = createRoot();
    const result = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model: createModel(),
      deadline: deadline(),
    });

    expect(result.status).toBe("ready");
    const raw = readFileSync(
      join(root, "long-memory", "v1", workspaceKey, ".lm2", "vector-quota-ledger-v1.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toMatchObject({
      workspaceKey,
      committedThroughAllocation: 0,
      nextAllocationSequence: 1,
      activeOperation: { operationId: expect.any(String), lockToken: expect.any(String) },
    });
    if (result.status === "ready") await result.finalize();
  });

  it("migrates a canonical numeric legacy ledger under the index lock", async () => {
    const root = createRoot();
    const model = createModel();
    const store = createLm2VectorStore({ storeRoot: root });
    const initial = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
    expect(initial.status).toBe("ready");
    if (initial.status !== "ready") return;
    await initial.finalize();

    const path = vectorQuotaLedgerPath(root, workspaceKey);
    const current = JSON.parse(readFileSync(path, "utf8"));
    const device = Number(current.lockIdentity.device);
    const inode = Number(current.lockIdentity.inode);
    if (!Number.isSafeInteger(device) || !Number.isSafeInteger(inode)) return;
    const legacy = {
      ...current,
      lockIdentity: { device, inode },
    };
    writeFileSync(path, `${JSON.stringify(legacy)}\n`);

    const candidate = createCandidate();
    const read = await store.read({
      workspaceKey,
      model,
      candidates: [candidate],
      maxDecodedBytes: 64,
      signal: new AbortController().signal,
      deadlineAtMs: 1,
      now: () => 0,
    });
    expect(read.diagnostics).toEqual([{ candidateId: candidate.id, reason: "missing_vectors" }]);

    const migrated = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
    expect(migrated.status).toBe("ready");
    expect(JSON.parse(readFileSync(path, "utf8")).lockIdentity).toEqual({
      device: String(device),
      inode: String(inode),
    });
    if (migrated.status === "ready") await migrated.finalize();
  });

  it("returns busy while another process holds the fixed inode", async () => {
    const root = createRoot();
    const release = await holdIndexLock(indexLockPath(root));
    try {
      await expect(
        createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
          workspaceKey,
          model: createModel(),
          deadline: deadline(),
        }),
      ).resolves.toEqual({ status: "busy" });
    } finally {
      await release();
    }
  });

  it("fails closed on a non-empty historical embeddings root", async () => {
    const root = createRoot();
    const legacy = join(root, "long-memory", "v1", workspaceKey, "embeddings");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "legacy.json"), "{}\n");

    await expect(
      createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
        workspaceKey,
        model: createModel(),
        deadline: deadline(),
      }),
    ).resolves.toEqual({ status: "invalid", quotaRecovery: "not_needed" });
  });

  it("reserves before egress and commits sidecars in allocation order", async () => {
    const root = createRoot();
    const model = createModel();
    const records = [createCandidate(1), createCandidate(2)];
    const store = createLm2VectorStore({ storeRoot: root });
    const result = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    const publish = await result.publishBatch({
      records,
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
      embed: async () => ({
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }),
    });
    expect(publish).toEqual({
      published: records.map(({ id }) => id),
      existing: [],
      reason: null,
    });
    await result.finalize();

    const ledger = JSON.parse(
      readFileSync(
        join(root, "long-memory", "v1", workspaceKey, ".lm2", "vector-quota-ledger-v1.json"),
        "utf8",
      ),
    );
    expect(ledger).toMatchObject({
      committedThroughAllocation: 2,
      nextAllocationSequence: 3,
      activeOperation: null,
      pending: null,
      namespaces: [
        {
          modelFingerprint: modelDescriptorFingerprint(model),
          sidecarCount: 2,
        },
      ],
    });
    const fingerprint = modelDescriptorFingerprint(model);
    for (const [index, record] of records.entries()) {
      const sidecar = JSON.parse(
        readFileSync(
          join(
            root,
            "long-memory",
            "v1",
            workspaceKey,
            "embeddings-v2",
            fingerprint,
            `${record.id}.json`,
          ),
          "utf8",
        ),
      );
      expect(sidecar.allocationSequence).toBe(index + 1);
      expect(sidecar.sourceDigest).toBe(createHash("sha256").update(record.id).digest("hex"));
    }
  });

  it.each(["close", "unlink"] as const)(
    "keeps a failed temporary %s cleanup blocked on the same operation",
    async (failure) => {
      const root = createRoot();
      const model = createModel();
      const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
        workspaceKey,
        model,
        deadline: deadline(),
      });
      if (operation.status !== "ready") throw new Error("operation unavailable");

      const result = await operation.publishBatch({
        records: [createCandidate(1)],
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => {
          if (failure === "close") failNextClose = true;
          else failNextPendingUnlink = true;
          return true;
        },
        embed: async () => ({
          modelFingerprint: modelDescriptorFingerprint(model),
          vectors: [[1, 2, 3]],
        }),
      });

      expect(result).toEqual({
        published: [],
        existing: [],
        reason: "quota_state_invalid",
        quotaRecovery: "blocked_pending",
      });
      const namespace = dirname(
        join(
          root,
          "long-memory",
          "v1",
          workspaceKey,
          "embeddings-v2",
          modelDescriptorFingerprint(model),
          `${createCandidate(1).id}.json`,
        ),
      );
      if (failure === "close") {
        expect(readdirSync(namespace).some((name) => name.endsWith(".pending"))).toBe(false);
      } else {
        const ledger = lm2QuotaLedgerSchema.parse(
          JSON.parse(readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8")),
        );
        expect(ledger.pending?.entries).toEqual([
          expect.objectContaining({
            recordId: createCandidate(1).id,
            temporaryName: lm2PendingTemporaryName(
              ledger.pending?.operationId ?? "missing-operation",
              1,
            ),
          }),
        ]);
        expect(readdirSync(namespace)).toContain(ledger.pending?.entries[0]?.temporaryName);
      }
      await expect(operation.finalize()).rejects.toThrow();
    },
  );

  it("rejects post-rename ledger content replacement without adopting its identity", async () => {
    const root = createRoot();
    const model = createModel();
    const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    const before = readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8");
    const embed = vi.fn();
    replaceLedgerContentAfterRename = true;

    const result = await operation.publishBatch({
      records: [createCandidate(1)],
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
      embed,
    });

    expect(result).toEqual({ published: [], existing: [], reason: "lock_integrity_lost" });
    expect(embed).not.toHaveBeenCalled();
    expect(replacedLedgerIdentity).not.toBeNull();
    expect(replacedLedgerIdentity?.after).toEqual(replacedLedgerIdentity?.before);
    const replacementEvidence = readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8");
    expect(replacementEvidence).not.toBe(before);
    await expect(operation.finalize()).rejects.toMatchObject({
      cause: { code: "index_lock_unavailable" },
    });
    expect(readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8")).toBe(
      replacementEvidence,
    );
  });

  it("revalidates exact ledger content after approval and immediately before egress", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate(1);
    const store = createLm2VectorStore({ storeRoot: root });
    const operation = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
    let replacementEvidence = "";
    let replacementIdentity:
      | { before: { dev: number; ino: number }; after: { dev: number; ino: number } }
      | undefined;
    const embed = vi.fn(async () => ({
      modelFingerprint: modelDescriptorFingerprint(model),
      vectors: [[1, 2, 3]],
    }));

    const result = await operation.publishBatch({
      records: [record],
      assertEgressAllowed: async () => {
        const before = statSync(ledgerPath);
        const ledger = lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")));
        const generation = ledger.generation + 1;
        replacementEvidence = serializeLm2QuotaLedger({
          ...ledger,
          generation,
          activeOperation:
            ledger.activeOperation === null
              ? null
              : { ...ledger.activeOperation, expectedGeneration: generation },
          pending:
            ledger.pending === null ? null : { ...ledger.pending, expectedGeneration: generation },
        });
        writeFileSync(ledgerPath, replacementEvidence);
        const after = statSync(ledgerPath);
        replacementIdentity = {
          before: { dev: before.dev, ino: before.ino },
          after: { dev: after.dev, ino: after.ino },
        };
        return true;
      },
      recheckEvidence: async () => true,
      embed,
    });

    expect(result).toEqual({
      published: [],
      existing: [],
      reason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    expect(embed).not.toHaveBeenCalled();
    expect(replacementIdentity?.after).toEqual(replacementIdentity?.before);
    expect(existsSync(join(dirname(ledgerPath), "..", "embeddings-v2"))).toBe(false);
    const retryEmbed = vi.fn();
    await expect(
      operation.publishBatch({
        records: [record],
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
        embed: retryEmbed,
      }),
    ).resolves.toEqual({
      published: [],
      existing: [],
      reason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    expect(retryEmbed).not.toHaveBeenCalled();

    const finalizeFailure = await operation.finalize().catch((error: unknown) => error);
    expect(finalizeFailure).toBeInstanceOf(Error);
    expect(exactCleanupRoots(finalizeFailure)).toEqual([
      expect.objectContaining({ name: "Lm2Error", code: "index_lock_unavailable" }),
      expect.objectContaining({ name: "Lm2Error", code: "index_lock_unavailable" }),
    ]);
    expect(readFileSync(ledgerPath, "utf8")).toBe(replacementEvidence);
    const next = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
    expect(next.status).toBe("ready");
    if (next.status === "ready") await next.finalize();
  });

  it("retains all independent temporary cleanup failures", () => {
    const root = createRoot();
    const namespace = ensureVectorNamespace(root, workspaceKey, createModel());
    const temporary = materializeAnchoredFile(namespace, "combined.pending", "sidecar");
    failNextClose = true;
    failNextPendingUnlink = true;
    let failure: unknown;

    try {
      closeAndRemoveAnchoredTemporary(namespace, temporary);
    } catch (error) {
      failure = error;
    }
    closeDirectoryAnchor(namespace);

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error("cleanup failure missing");
    expect(failure.cause).toBeInstanceOf(AggregateError);
    if (!(failure.cause instanceof AggregateError)) throw new Error("cleanup causes missing");
    expect(failure.cause.errors).toHaveLength(2);
    expect(failure.cause.errors[0]).toMatchObject({
      name: "Lm2Error",
      code: "store_corrupt",
      message: "LM2 file descriptor close failed.",
    });
    expect(failure.cause.errors[1]).toBe(injectedPendingUnlinkFailures[0]);
    expect(injectedCloseFailures).toHaveLength(1);
  });

  it("retains every file and parent descriptor cleanup root", () => {
    const path = join(createRoot(), "owned-anchor.json");
    writeFileSync(path, "lock");
    const file = openAnchoredUpdateFile(path);
    failEveryClose = true;
    let failure: unknown;

    try {
      closeAnchoredFile(file);
    } catch (error) {
      failure = error;
    }
    failEveryClose = false;

    expect(injectedCloseFailures.length).toBeGreaterThanOrEqual(2);
    expect(exactCleanupRoots(failure)).toEqual(injectedCloseFailures);
  });

  it("retains publication and temporary cleanup roots together", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate(1);
    const fingerprint = modelDescriptorFingerprint(model);
    const entries = createPendingAllocations({
      records: [record],
      modelFingerprint: fingerprint,
      firstAllocationSequence: 1,
      operationId: "11111111-1111-4111-8111-111111111111",
    });
    let currentEntries = entries;

    const failure = await publishLm2ReservedBatch({
      storeRoot: root,
      workspaceKey,
      model,
      fingerprint,
      records: [record],
      entries,
      ledgerEpoch: "a".repeat(64),
      signal: new AbortController().signal,
      deadlineAtMs: 100,
      now: () => 0,
      embed: async () => ({ modelFingerprint: fingerprint, vectors: [[1, 2, 3]] }),
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => {
        failNextFsync = true;
        failNextClose = true;
        return true;
      },
      assertGuard: () => {},
      settlePending: () => {},
      persistMaterialized: (materialized) => {
        currentEntries = materialized;
      },
      currentEntry: () => currentEntries[0],
      inspectPublished: () => ({ status: "missing" }),
      commitFirst: () => {},
    }).catch((error: unknown) => error);

    // syncDirectoryDescriptor() returns early on win32 — Windows cannot
    // FlushFileBuffers a directory handle — so the post-link directory fsync
    // never runs there and no fsync failure is injectable.
    //
    // The counts are pinned FIRST because the aggregate alone cannot tell a
    // real result from an absent one: indexing an empty injection log yields
    // `undefined`, so if the harness ever stopped injecting, both sides could
    // still line up and the test would pass having exercised nothing. Assert
    // that the injections happened, then that they are what surfaced.
    expect(injectedFsyncFailures).toHaveLength(process.platform === "win32" ? 0 : 1);
    expect(injectedCloseFailures).toHaveLength(1);
    expect(exactCleanupRoots(failure)).toEqual([
      ...injectedFsyncFailures,
      ...injectedCloseFailures,
    ]);
  });

  it("carries aggregate cleanup roots through the real blocked receipt", async () => {
    const root = createRoot();
    const model = createModel();
    const candidate = createCandidate(1);
    const evidenceId = "10000000-0000-4000-8000-000000000001";
    const record = {
      schemaVersion: 1,
      ...candidate,
      canonicalCaptureDigest: "a".repeat(64),
      evidenceBindingDigest: "b".repeat(64),
      recordedAt: "2026-07-20T00:00:03.000Z",
      evidenceDigests: ["c".repeat(64)],
      status: "recorded",
      action: null,
      evidenceIds: [evidenceId],
      stateKey: "billing.status",
      representation: "value",
      supersedesSnapshotId: null,
      redactionVersion: "redaction-v1",
    } as Lm1Record;
    const catalog: Lm2CandidateCatalog = {
      appendPublished: vi.fn(),
      page: vi.fn(() => ({
        generation: 1,
        entries: [
          {
            id: record.id,
            sourceDigest: record.sourceDigest,
            kind: record.kind,
            observedAt: record.observedAt,
            captureSequence: 1,
          },
        ],
        nextCursor: null,
      })),
    };
    const lm1Store: FileLm1Store = {
      publish: vi.fn(),
      getByDigest: vi.fn(),
      getById: vi.fn(() => record),
      list: vi.fn(),
    };
    let eligibilityChecks = 0;
    const evidenceEligibility = {
      resolve: vi.fn(async () => {
        eligibilityChecks += 1;
        if (eligibilityChecks === 2) {
          failNextFsync = true;
          failNextClose = true;
        }
        return [
          {
            evidenceId,
            workspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          },
        ];
      }),
    };
    const embedding = {
      egress: "local" as const,
      embed: vi.fn(async () => ({
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [[1, 2, 3]],
      })),
    };
    const vectors = createLm2VectorStore({ storeRoot: root });
    const index = createLm2IndexService({
      catalog,
      store: lm1Store,
      vectors,
      evidenceEligibility,
      embedding,
      model,
      defaultTimeoutMs: 1_000,
    });
    const request = {
      workspaceKey,
      modelFingerprint: modelDescriptorFingerprint(model),
      maxRecords: 1,
    };

    const receipt = await index.index(request);

    expect(receipt).toEqual({
      indexedCount: 0,
      omitted: [],
      outcome: "retry",
      nextCursor: null,
      retryCursor: null,
      transientReason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    const diagnostic = Reflect.getOwnPropertyDescriptor(receipt, "cause");
    expect(diagnostic).toMatchObject({ enumerable: false });
    expect(diagnostic?.value).toBeInstanceOf(AggregateError);
    expect(exactCleanupRoots(diagnostic?.value)).toEqual([
      injectedCloseFailures[0],
      injectedFsyncFailures[0],
    ]);
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(receipt);

    const recovered = await index.index(request);
    expect(recovered).toMatchObject({ outcome: "complete" });
    expect(embedding.embed).toHaveBeenCalledTimes(2);
  });

  it("retains all independent finalization failures and releases the lock", async () => {
    const root = createRoot();
    const store = createLm2VectorStore({ storeRoot: root });
    const model = createModel();
    const operation = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    const receipt = await operation.publishBatch({
      records: [createCandidate(1)],
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
      embed: async () => {
        failNextClose = true;
        return {
          modelFingerprint: modelDescriptorFingerprint(model),
          vectors: [[1, 2, 3]],
        };
      },
    });
    expect(receipt).toEqual({
      published: [],
      existing: [],
      reason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    injectedCloseFailures.length = 0;
    failEveryClose = true;

    const failure = await operation.finalize().catch((error: unknown) => error);
    failEveryClose = false;

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error)) throw new Error("finalization failure missing");
    expect(failure.cause).toBeInstanceOf(AggregateError);
    if (!(failure.cause instanceof AggregateError)) throw new Error("cleanup causes missing");
    expect(failure.cause.errors).toHaveLength(3);
    expect(failure.cause.errors[0]).toMatchObject({
      name: "Lm2CleanupError",
      message: "LM2 cleanup remains blocked.",
    });
    expect(failure.cause.errors[1]).toMatchObject({
      name: "Lm2Error",
      code: "store_corrupt",
      message: "LM2 directory descriptor close failed.",
    });
    expect(failure.cause.errors[2]).toMatchObject({
      name: "Lm2Error",
      code: "store_corrupt",
      message: "LM2 file descriptor close failed.",
    });
    expect(injectedCloseFailures.length).toBeGreaterThanOrEqual(2);

    const next = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
    expect(next).toMatchObject({ status: "ready" });
    if (next.status === "ready") await next.finalize();
  });

  it("marks a ledger replacement temporary close failure blocked on the same operation", async () => {
    const root = createRoot();
    const model = createModel();
    const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");

    const result = await operation.publishBatch({
      records: [createCandidate(1)],
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
      embed: async () => {
        failNextClose = true;
        return {
          modelFingerprint: modelDescriptorFingerprint(model),
          vectors: [[1, 2, 3]],
        };
      },
    });

    expect(result).toEqual({
      published: [],
      existing: [],
      reason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    const secondEmbed = vi.fn();
    await expect(
      operation.publishBatch({
        records: [createCandidate(2)],
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
        embed: secondEmbed,
      }),
    ).resolves.toEqual({
      published: [],
      existing: [],
      reason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    expect(secondEmbed).not.toHaveBeenCalled();
    await expect(operation.finalize()).rejects.toThrow();
  });

  it.each(["ledger-anchor", "lock", "multiple"] as const)(
    "attempts lock release after %s cleanup failure",
    async (failure) => {
      const root = createRoot();
      const store = createLm2VectorStore({ storeRoot: root });
      const operation = await store.beginIndexOperation({
        workspaceKey,
        model: createModel(),
        deadline: deadline(),
      });
      if (operation.status !== "ready") throw new Error("operation unavailable");
      if (failure === "multiple") failEveryClose = true;
      else if (failure === "lock") {
        failCloseAfter =
          dirname(vectorQuotaLedgerPath(root, workspaceKey)).split("/").filter(Boolean).length + 1;
      } else failNextClose = true;

      await expect(operation.finalize()).rejects.toThrow();
      failEveryClose = false;
      const next = await store.beginIndexOperation({
        workspaceKey,
        model: createModel(),
        deadline: deadline(),
      });
      expect(next).toMatchObject({ status: "ready" });
      if (next.status === "ready") await next.finalize();
    },
  );

  it("reports blocked recovery on the same result with its committed prefix", async () => {
    const root = createRoot();
    const model = createModel();
    const fingerprint = modelDescriptorFingerprint(model);
    const records = [createCandidate(1), createCandidate(2)];
    const store = createLm2VectorStore({ storeRoot: root });
    const operation = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    expect(operation.status).toBe("ready");
    if (operation.status !== "ready") return;
    let evidenceChecks = 0;
    const conflictingPath = join(
      root,
      "long-memory",
      "v1",
      workspaceKey,
      "embeddings-v2",
      fingerprint,
      `${records[1]?.id}.json`,
    );

    const publish = await operation.publishBatch({
      records,
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => {
        evidenceChecks += 1;
        if (evidenceChecks === 2) writeFileSync(conflictingPath, "foreign\n");
        return true;
      },
      embed: async () => ({
        modelFingerprint: fingerprint,
        vectors: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }),
    });
    expect(publish).toEqual({
      published: [records[0]?.id],
      existing: [],
      reason: "quota_state_invalid",
      quotaRecovery: "blocked_pending",
    });
    expect(readFileSync(conflictingPath, "utf8")).toBe("foreign\n");
    const firstPath = join(dirname(conflictingPath), `${records[0]?.id}.json`);
    expect(existsSync(firstPath)).toBe(true);
    const ledger = lm2QuotaLedgerSchema.parse(
      JSON.parse(readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8")),
    );
    expect(ledger).toMatchObject({
      committedThroughAllocation: 1,
      nextAllocationSequence: 2,
      pending: { firstAllocationSequence: 2, lastAllocationSequence: 2 },
    });
    await expect(operation.finalize()).rejects.toThrow();
    await expect(
      store.beginIndexOperation({ workspaceKey, model, deadline: deadline() }),
    ).resolves.toEqual({ status: "invalid", quotaRecovery: "blocked_pending" });
  });

  it("reports a publication committed by post-link recovery exactly once", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate(1);
    const store = createLm2VectorStore({ storeRoot: root });
    const operation = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    expect(operation.status).toBe("ready");
    if (operation.status !== "ready") return;

    const publish = await operation.publishBatch({
      records: [record],
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => {
        failNextFsync = true;
        return true;
      },
      embed: async () => ({
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [[1, 2, 3]],
      }),
    });
    expect(publish).toEqual({ published: [record.id], existing: [], reason: "write_failed" });

    const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
    expect(lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")))).toMatchObject({
      committedThroughAllocation: 1,
      nextAllocationSequence: 2,
      pending: null,
    });
    const retryEmbed = vi.fn();
    await expect(
      operation.publishBatch({
        records: [record],
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
        embed: retryEmbed,
      }),
    ).resolves.toEqual({ published: [], existing: [record.id], reason: null });
    expect(retryEmbed).not.toHaveBeenCalled();
    expect(lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")))).toMatchObject({
      committedThroughAllocation: 1,
      nextAllocationSequence: 2,
      pending: null,
    });
    await operation.finalize();
  });

  it("recovers an exact named prefix and a proven-absent suffix", async () => {
    const root = createRoot();
    const model = createModel();
    const fingerprint = modelDescriptorFingerprint(model);
    const records = [createCandidate(1), createCandidate(2)];
    const token = "b".repeat(64);
    const lockPath = indexLockPath(root);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${token}\n`);
    const lockStat = statSync(lockPath);
    const epoch = "a".repeat(64);
    const firstRecord = records[0];
    if (firstRecord === undefined) throw new Error("missing recovery fixture record");
    const exact = buildSerializedSidecar(model, firstRecord, [1, 2, 3], {
      ledgerEpoch: epoch,
      allocationSequence: 1,
    });
    const exactPath = join(
      root,
      "long-memory",
      "v1",
      workspaceKey,
      "embeddings-v2",
      fingerprint,
      `${records[0]?.id}.json`,
    );
    mkdirSync(dirname(exactPath), { recursive: true });
    writeFileSync(exactPath, exact);
    const operationId = "11111111-1111-4111-8111-111111111111";
    const entries = records.map((record, index) => ({
      allocationSequence: index + 1,
      modelFingerprint: fingerprint,
      recordId: record.id,
      recordIdentityDigest: recordIdentityDigest({
        workspaceKey: record.workspaceKey,
        id: record.id,
        kind: record.kind,
        sourceDigest: record.sourceDigest,
        embeddingInputDigest: embeddingInputDigest({ kind: record.kind, text: record.text }),
        modelFingerprint: fingerprint,
      }),
      reservedBytes: 24 * 1024,
      expectedSidecarDigest: index === 0 ? createHash("sha256").update(exact).digest("hex") : null,
      serializedBytes: index === 0 ? Buffer.byteLength(exact) : null,
      temporaryName: lm2PendingTemporaryName(operationId, index + 1),
      finalName: `${record.id}.json`,
      phase: index === 0 ? "published" : "reserved",
    }));
    const ledger = lm2QuotaLedgerSchema.parse({
      schemaVersion: 1,
      workspaceKey,
      epoch,
      lockIdentity: { device: String(lockStat.dev), inode: String(lockStat.ino) },
      lockToken: token,
      generation: 1,
      namespaces: [],
      committedThroughAllocation: 0,
      nextAllocationSequence: 1,
      activeOperation: {
        operationId,
        expectedGeneration: 1,
        lockIdentity: { device: String(lockStat.dev), inode: String(lockStat.ino) },
        lockToken: token,
      },
      pending: {
        operationId,
        expectedGeneration: 1,
        firstAllocationSequence: 1,
        lastAllocationSequence: 2,
        entries,
      },
    });
    const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
    writeFileSync(ledgerPath, serializeLm2QuotaLedger(ledger));

    let recovered = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    // Transient FS errors (e.g. Windows CI sharing violations) surface as a
    // fail-closed "invalid" before anything is persisted; recovery is
    // idempotent, so retry instead of failing the whole run.
    for (let retry = 0; recovered.status === "invalid" && retry < 2; retry += 1) {
      recovered = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
        workspaceKey,
        model,
        deadline: deadline(),
      });
    }
    expect(recovered.status).toBe("ready");
    if (recovered.status !== "ready") return;
    expect(recovered.quotaRecovery).toBe("recovered_pending");
    const after = lm2QuotaLedgerSchema.parse(JSON.parse(readFileSync(ledgerPath, "utf8")));
    expect(after).toMatchObject({
      committedThroughAllocation: 1,
      nextAllocationSequence: 2,
      pending: null,
      namespaces: [{ modelFingerprint: fingerprint, sidecarCount: 1 }],
    });
    await recovered.finalize();
  });

  it("rejects a pending temporary name aimed at a committed sidecar without deleting it", async () => {
    const root = createRoot();
    const model = createModel();
    const fingerprint = modelDescriptorFingerprint(model);
    const committedRecord = createCandidate(1);
    const pendingRecord = createCandidate(2);
    const token = "b".repeat(64);
    const lockPath = indexLockPath(root);
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${token}\n`);
    const lockStat = statSync(lockPath);
    const epoch = "a".repeat(64);
    const committed = buildSerializedSidecar(model, committedRecord, [1, 2, 3], {
      ledgerEpoch: epoch,
      allocationSequence: 1,
    });
    const committedPath = join(
      root,
      "long-memory",
      "v1",
      workspaceKey,
      "embeddings-v2",
      fingerprint,
      `${committedRecord.id}.json`,
    );
    mkdirSync(dirname(committedPath), { recursive: true });
    writeFileSync(committedPath, committed);
    const operationId = "11111111-1111-4111-8111-111111111111";
    const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
    const rawLedger = {
      schemaVersion: 1,
      workspaceKey,
      epoch,
      lockIdentity: { device: String(lockStat.dev), inode: String(lockStat.ino) },
      lockToken: token,
      generation: 1,
      namespaces: [
        {
          modelFingerprint: fingerprint,
          sidecarCount: 1,
          serializedBytes: Buffer.byteLength(committed),
        },
      ],
      committedThroughAllocation: 1,
      nextAllocationSequence: 2,
      activeOperation: {
        operationId,
        expectedGeneration: 1,
        lockIdentity: { device: String(lockStat.dev), inode: String(lockStat.ino) },
        lockToken: token,
      },
      pending: {
        operationId,
        expectedGeneration: 1,
        firstAllocationSequence: 2,
        lastAllocationSequence: 2,
        entries: [
          {
            allocationSequence: 2,
            modelFingerprint: fingerprint,
            recordId: pendingRecord.id,
            recordIdentityDigest: recordIdentityDigest({
              workspaceKey,
              id: pendingRecord.id,
              kind: pendingRecord.kind,
              sourceDigest: pendingRecord.sourceDigest,
              embeddingInputDigest: embeddingInputDigest({
                kind: pendingRecord.kind,
                text: pendingRecord.text,
              }),
              modelFingerprint: fingerprint,
            }),
            reservedBytes: 24 * 1024,
            expectedSidecarDigest: null,
            serializedBytes: null,
            temporaryName: `${committedRecord.id}.json`,
            finalName: `${pendingRecord.id}.json`,
            phase: "reserved",
          },
        ],
      },
    };
    writeFileSync(ledgerPath, `${JSON.stringify(rawLedger)}\n`);

    await expect(
      createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
        workspaceKey,
        model,
        deadline: deadline(),
      }),
    ).resolves.toEqual({ status: "invalid", quotaRecovery: "not_needed" });
    expect(readFileSync(committedPath, "utf8")).toBe(committed);
  });

  it("fails closed for malformed, oversize, and unledgered v2 state", async () => {
    const cases: readonly ("malformed" | "oversize" | "unledgered")[] = [
      "malformed",
      "oversize",
      "unledgered",
    ];
    for (const kind of cases) {
      const root = createRoot();
      const ledgerPath = vectorQuotaLedgerPath(root, workspaceKey);
      mkdirSync(dirname(ledgerPath), { recursive: true });
      if (kind === "malformed") writeFileSync(ledgerPath, "{invalid\n");
      if (kind === "oversize") writeFileSync(ledgerPath, "x".repeat(64 * 1024 + 1));
      if (kind === "unledgered") {
        const path = join(root, "long-memory", "v1", workspaceKey, "embeddings-v2", "orphan");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "orphan\n");
      }
      await expect(
        createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
          workspaceKey,
          model: createModel(),
          deadline: deadline(),
        }),
      ).resolves.toEqual({ status: "invalid", quotaRecovery: "not_needed" });
    }
  });

  it("rejects every mutation from a finalized capability", async () => {
    const root = createRoot();
    const model = createModel();
    const result = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    await result.finalize();
    const embed = vi.fn();
    await expect(
      result.publishBatch({
        records: [createCandidate()],
        embed,
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
      }),
    ).resolves.toEqual({ published: [], existing: [], reason: "lock_integrity_lost" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("rejects approval denial and a result delivered after abort before mutation", async () => {
    const root = createRoot();
    const model = createModel();
    const store = createLm2VectorStore({ storeRoot: root });
    const denied = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    expect(denied.status).toBe("ready");
    if (denied.status !== "ready") return;
    const deniedEmbed = vi.fn();
    await expect(
      denied.publishBatch({
        records: [createCandidate(1)],
        embed: deniedEmbed,
        assertEgressAllowed: async () => false,
        recheckEvidence: async () => true,
      }),
    ).resolves.toEqual({ published: [], existing: [], reason: "remote_approval_denied" });
    expect(deniedEmbed).not.toHaveBeenCalled();
    await denied.finalize();

    const controller = new AbortController();
    const late = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: { signal: controller.signal, deadlineAtMs: 1, now: () => 0 },
    });
    expect(late.status).toBe("ready");
    if (late.status !== "ready") return;
    await expect(
      late.publishBatch({
        records: [createCandidate(2)],
        embed: async () => {
          controller.abort();
          return {
            modelFingerprint: modelDescriptorFingerprint(model),
            vectors: [[1, 2, 3]],
          };
        },
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
      }),
    ).resolves.toEqual({ published: [], existing: [], reason: "port_failure" });
    expect(
      existsSync(
        join(
          root,
          "long-memory",
          "v1",
          workspaceKey,
          "embeddings-v2",
          modelDescriptorFingerprint(model),
          `${createCandidate(2).id}.json`,
        ),
      ),
    ).toBe(false);
    await late.finalize();
  });

  it("reports existing progress from the original denied batch", async () => {
    const root = createRoot();
    const model = createModel();
    const existing = createCandidate(1);
    const missing = createCandidate(2);
    const store = createLm2VectorStore({ storeRoot: root });
    const first = await store.beginIndexOperation({ workspaceKey, model, deadline: deadline() });
    if (first.status !== "ready") throw new Error("operation unavailable");
    await first.publishBatch({
      records: [existing],
      assertEgressAllowed: async () => true,
      recheckEvidence: async () => true,
      embed: async () => ({
        modelFingerprint: modelDescriptorFingerprint(model),
        vectors: [[1, 2, 3]],
      }),
    });
    await first.finalize();
    const operation = await store.beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
    if (operation.status !== "ready") throw new Error("operation unavailable");
    const embed = vi.fn();

    const result = await operation.publishBatch({
      records: [existing, missing],
      assertEgressAllowed: async () => false,
      recheckEvidence: async () => true,
      embed,
    });

    expect(result).toMatchObject({
      published: [],
      existing: [existing.id],
      reason: "remote_approval_denied",
    });
    expect(embed).not.toHaveBeenCalled();
    await operation.finalize();
  });
});
