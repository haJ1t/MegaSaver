import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddingInputDigest, modelDescriptorFingerprint } from "../src/lm2-identity.js";
import {
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

afterEach(cleanupRoots);

function deadline() {
  const controller = new AbortController();
  return { signal: controller.signal, deadlineAtMs: 10_000, now: () => 0 };
}

describe("LM2 index operation", () => {
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
    expect(publish).toEqual({ published: records.map(({ id }) => id), reason: null });
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
      temporaryName: `.crash-${index}.tmp`,
      finalName: `${record.id}.json`,
      phase: index === 0 ? "published" : "reserved",
    }));
    const ledger = lm2QuotaLedgerSchema.parse({
      schemaVersion: 1,
      workspaceKey,
      epoch,
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
    ).resolves.toEqual({ published: [], reason: "lock_integrity_lost" });
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
    ).resolves.toEqual({ published: [], reason: "remote_approval_denied" });
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
    ).resolves.toEqual({ published: [], reason: "port_failure" });
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
});
