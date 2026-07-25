import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import { lm2QuotaLedgerSchema } from "../src/lm2-quota-ledger.js";
import { buildSerializedSidecar } from "../src/lm2-vector-format.js";
import { vectorNamespacePath, vectorQuotaLedgerPath } from "../src/lm2-vector-paths.js";
import { type Lm2VectorStoreResult, createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  embeddingResult,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

async function initializeLedger(root: string, model: ReturnType<typeof createModel>) {
  const operation = await createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
    workspaceKey,
    model,
    deadline: {
      signal: new AbortController().signal,
      deadlineAtMs: 1_000,
      now: () => 0,
    },
  });
  expect(operation.status).toBe("ready");
  if (operation.status !== "ready") throw new Error("LM2 ledger fixture did not initialize.");
  await operation.finalize();
}

describe("LM2 vector sidecar publication", () => {
  it("exposes timeout as a truthful store result", () => {
    const result = { published: [], reason: "timeout" } satisfies Lm2VectorStoreResult;
    expect(result).toEqual({ published: [], reason: "timeout" });
  });

  it("publishes canonical identity-bound sidecars without exposing private metadata", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const embed = vi.fn(async () => embeddingResult(model, [[3, 4, 0]]));

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [record.id], reason: null });
    expect(embed).toHaveBeenCalledWith({
      model,
      purpose: "document",
      texts: [
        `megasaver.long-memory.lm2.embedding-input.v1\0${JSON.stringify({
          kind: record.kind,
          text: record.text,
        })}`,
      ],
      signal: expect.any(AbortSignal),
    });
    const ledger = lm2QuotaLedgerSchema.parse(
      JSON.parse(readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8")),
    );
    expect(
      readFileSync(
        join(vectorNamespacePath(root, workspaceKey, model), `${record.id}.json`),
        "utf8",
      ),
    ).toBe(
      buildSerializedSidecar(model, record, [3, 4, 0], {
        ledgerEpoch: ledger.epoch,
        allocationSequence: 1,
      }),
    );
    expect(ledger).toMatchObject({
      committedThroughAllocation: 1,
      nextAllocationSequence: 2,
      pending: null,
      namespaces: [
        {
          modelFingerprint: modelDescriptorFingerprint(model),
          sidecarCount: 1,
        },
      ],
    });
  });

  it("performs no egress through symlinked vector parents", async () => {
    const root = createRoot();
    const outside = createRoot();
    const model = createModel();
    const record = createCandidate();
    const workspace = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspace, { recursive: true });
    symlinkSync(outside, join(workspace, "embeddings-v2"));
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "index_lock_unavailable" });
    expect(embed).not.toHaveBeenCalled();

    const secondRoot = createRoot();
    await initializeLedger(secondRoot, model);
    const embeddings = join(secondRoot, "long-memory", "v1", workspaceKey, "embeddings-v2");
    const outsideNamespace = join(outside, "namespace");
    mkdirSync(embeddings, { recursive: true });
    mkdirSync(outsideNamespace, { recursive: true });
    symlinkSync(outsideNamespace, join(embeddings, modelDescriptorFingerprint(model)));
    await expect(
      createLm2VectorStore({ storeRoot: secondRoot }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("uses atomic no-clobber publication", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const conflicting = "foreign-content\n";

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => {
          const path = join(vectorNamespacePath(root, workspaceKey, model), `${record.id}.json`);
          mkdirSync(join(path, ".."), { recursive: true });
          writeFileSync(path, conflicting);
          return embeddingResult(model, [[1, 2, 3]]);
        },
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(
      readFileSync(
        join(vectorNamespacePath(root, workspaceKey, model), `${record.id}.json`),
        "utf8",
      ),
    ).toBe(conflicting);
    expect(
      lm2QuotaLedgerSchema.parse(
        JSON.parse(readFileSync(vectorQuotaLedgerPath(root, workspaceKey), "utf8")),
      ),
    ).toMatchObject({
      committedThroughAllocation: 0,
      nextAllocationSequence: 1,
      pending: { firstAllocationSequence: 1, lastAllocationSequence: 1 },
    });
  });

  it("fails closed instead of publishing through a parent swapped during egress", async () => {
    const root = createRoot();
    const outside = createRoot();
    const model = createModel();
    const record = createCandidate();
    await initializeLedger(root, model);
    const namespace = vectorNamespacePath(root, workspaceKey, model);
    mkdirSync(namespace, { recursive: true });

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => {
          renameSync(namespace, `${namespace}-displaced`);
          symlinkSync(outside, namespace);
          return embeddingResult(model, [[1, 2, 3]]);
        },
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(existsSync(join(outside, `${record.id}.json`))).toBe(false);
  });
});
