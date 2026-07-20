import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let failNextFsync = false;
let failNextClose = false;
let failNextPendingUnlink = false;
let failEveryClose = false;
let failCloseAfter: number | null = null;

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
        throw new Error("injected descriptor close failure");
      }
    },
    fsyncSync(descriptor: number) {
      if (failNextFsync) {
        failNextFsync = false;
        throw new Error("injected post-link fsync failure");
      }
      actual.fsyncSync(descriptor);
    },
    unlinkSync(path: import("node:fs").PathLike) {
      if (failNextPendingUnlink && String(path).endsWith(".pending")) {
        failNextPendingUnlink = false;
        throw new Error("injected pending unlink failure");
      }
      actual.unlinkSync(path);
    },
  };
});

import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { createLm2IndexPlanSequence } from "../src/lm2-index-plan.js";
import type { Lm2Candidate } from "../src/lm2-model.js";
import {
  lm2PendingTemporaryName,
  lm2QuotaLedgerSchema,
  recordIdentityDigest,
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
  cleanupRoots();
});

function deadline() {
  const controller = new AbortController();
  return { signal: controller.signal, deadlineAtMs: 10_000, now: () => 0 };
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
      }
      await expect(operation.finalize()).rejects.toThrow();
    },
  );

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
      lockIdentity: { device: lockStat.dev, inode: lockStat.ino },
      lockToken: token,
      generation: 1,
      namespaces: [],
      committedThroughAllocation: 0,
      nextAllocationSequence: 1,
      activeOperation: {
        operationId,
        expectedGeneration: 1,
        lockIdentity: { device: lockStat.dev, inode: lockStat.ino },
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

    const recovered = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
      workspaceKey,
      model,
      deadline: deadline(),
    });
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
      lockIdentity: { device: lockStat.dev, inode: lockStat.ino },
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
        lockIdentity: { device: lockStat.dev, inode: lockStat.ino },
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
