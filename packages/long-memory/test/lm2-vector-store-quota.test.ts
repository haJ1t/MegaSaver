import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import {
  type Lm2QuotaLedger,
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
  serializeLm2QuotaLedger,
} from "../src/lm2-quota-ledger.js";
import { vectorQuotaLedgerPath } from "../src/lm2-vector-paths.js";
import { createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  indexLockPath,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

function seedLedger(root: string, namespaces: Lm2QuotaLedger["namespaces"]): void {
  const committed = namespaces.reduce((sum, entry) => sum + entry.sidecarCount, 0);
  const lockPath = indexLockPath(root);
  const lockToken = "e".repeat(64);
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${lockToken}\n`);
  const lockStat = statSync(lockPath, { bigint: true });
  const ledger: Lm2QuotaLedger = {
    schemaVersion: 1,
    workspaceKey,
    epoch: "a".repeat(64),
    lockIdentity: { device: lockStat.dev.toString(), inode: lockStat.ino.toString() },
    lockToken,
    generation: 1,
    namespaces,
    committedThroughAllocation: committed,
    nextAllocationSequence: committed + 1,
    activeOperation: null,
    pending: null,
  };
  const path = vectorQuotaLedgerPath(root, workspaceKey);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeLm2QuotaLedger(ledger));
}

async function attempt(root: string, model = createModel()) {
  const embed = vi.fn(async () => ({
    modelFingerprint: modelDescriptorFingerprint(model),
    vectors: [[1, 2, 3]],
  }));
  const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
    workspaceKey,
    model,
    deadline: { signal: new AbortController().signal, deadlineAtMs: 1, now: () => 0 },
  });
  expect(operation.status).toBe("ready");
  if (operation.status !== "ready") return { result: null, embed };
  const result = await operation.publishBatch({
    records: [createCandidate(99)],
    embed,
    assertEgressAllowed: async () => true,
    recheckEvidence: async () => true,
  });
  await operation.finalize();
  return { result, embed };
}

describe("LM2 ledger quotas", () => {
  it("rejects a third namespace before egress without enumerating 20,000 sidecars", async () => {
    const root = createRoot();
    const first = modelDescriptorFingerprint(createModel(1));
    const second = modelDescriptorFingerprint(createModel(2));
    seedLedger(
      root,
      [
        { modelFingerprint: first, sidecarCount: 10_000, serializedBytes: 10_000 },
        { modelFingerprint: second, sidecarCount: 10_000, serializedBytes: 10_000 },
      ].sort((left, right) => left.modelFingerprint.localeCompare(right.modelFingerprint)),
    );

    const { result, embed } = await attempt(root, createModel(3));
    expect(result).toEqual({ published: [], existing: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("rejects the 10,001st allocation in one namespace before egress", async () => {
    const root = createRoot();
    const model = createModel();
    seedLedger(root, [
      {
        modelFingerprint: modelDescriptorFingerprint(model),
        sidecarCount: MAX_LM2_SIDECARS_PER_NAMESPACE,
        serializedBytes: MAX_LM2_SIDECARS_PER_NAMESPACE,
      },
    ]);

    const { result, embed } = await attempt(root, model);
    expect(result).toEqual({ published: [], existing: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("reserves 24 KiB against the exact workspace byte counter before egress", async () => {
    const root = createRoot();
    const model = createModel();
    seedLedger(root, [
      {
        modelFingerprint: modelDescriptorFingerprint(model),
        sidecarCount: 1,
        serializedBytes: MAX_LM2_WORKSPACE_VECTOR_BYTES - 24 * 1024 + 1,
      },
    ]);

    const { result, embed } = await attempt(root, model);
    expect(result).toEqual({ published: [], existing: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });
});
