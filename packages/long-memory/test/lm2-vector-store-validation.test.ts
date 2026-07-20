import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import type { Lm2QuotaLedger } from "../src/lm2-quota-ledger.js";
import {
  buildSerializedSidecar,
  isCommittedSidecar,
  parseSidecarMetadata,
} from "../src/lm2-vector-format.js";
import {
  embeddingsPath,
  legacyEmbeddingsPath,
  vectorQuotaLedgerPath,
} from "../src/lm2-vector-paths.js";
import { createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  embeddingResult,
  sidecarPath,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 embedding output validation", () => {
  it("writes only canonical v2 provenance and admits only committed allocations", () => {
    const model = createModel();
    const record = createCandidate();
    const ledgerEpoch = "a".repeat(64);
    const serialized = buildSerializedSidecar(model, record, [1, 2, 3], {
      ledgerEpoch,
      allocationSequence: 4,
    });
    const metadata = parseSidecarMetadata(
      Buffer.from(serialized),
      modelDescriptorFingerprint(model),
    );
    const ledger = {
      schemaVersion: 1,
      workspaceKey,
      epoch: ledgerEpoch,
      generation: 1,
      namespaces: [],
      committedThroughAllocation: 4,
      nextAllocationSequence: 5,
      activeOperation: null,
      pending: null,
    } as const satisfies Lm2QuotaLedger;

    expect(metadata?.sidecar).toMatchObject({
      schemaVersion: 2,
      ledgerEpoch,
      allocationSequence: 4,
    });
    expect(isCommittedSidecar({ ledger, sidecar: metadata?.sidecar as never })).toBe(true);
    expect(
      isCommittedSidecar({
        ledger: { ...ledger, committedThroughAllocation: 3, nextAllocationSequence: 4 },
        sidecar: metadata?.sidecar as never,
      }),
    ).toBe(false);
    expect(() => buildSerializedSidecar(model, record, [1, 2, 3])).toThrow();
  });

  it("fences the v2 authority from the historical embeddings root", () => {
    const root = "/store";
    expect(embeddingsPath(root, workspaceKey)).toBe(
      join(root, "long-memory", "v1", workspaceKey, "embeddings-v2"),
    );
    expect(legacyEmbeddingsPath(root, workspaceKey)).toBe(
      join(root, "long-memory", "v1", workspaceKey, "embeddings"),
    );
    expect(vectorQuotaLedgerPath(root, workspaceKey)).toBe(
      join(root, "long-memory", "v1", workspaceKey, ".lm2", "vector-quota-ledger-v1.json"),
    );
  });

  it.each([
    { name: "Float32 overflow", vector: [1e39, 0, 1] },
    { name: "nonfinite", vector: [Number.NaN, 0, 1] },
    { name: "noncanonical negative zero", vector: [-0, 2, 3] },
    { name: "zero norm", vector: [0, 0, 0] },
    { name: "wrong dimension", vector: [1, 2] },
  ])("publishes nothing for $name", async ({ vector }) => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => embeddingResult(model, [vector]),
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });

  it.each([
    { name: "string", component: "1" },
    { name: "boolean", component: true },
    { name: "null", component: null },
    { name: "object", component: { value: 1 } },
  ])("rejects a $name component before Float32 coercion", async ({ component }) => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => embeddingResult(model, [[component, 2, 3] as never]),
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });

  it("rejects mismatched fingerprint and vector-count tuples", async () => {
    const root = createRoot();
    const model = createModel();
    const records = [createCandidate(1), createCandidate(2)];

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records,
        signal: new AbortController().signal,
        embed: async () => ({ modelFingerprint: "f".repeat(64), vectors: [[1, 2, 3]] }),
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(records.every((record) => !existsSync(sidecarPath(root, record, model)))).toBe(true);
  });

  it("rejects malformed and hostile embedding results", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const store = createLm2VectorStore({ storeRoot: root });

    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () => ({}) as never,
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    await expect(
      store.reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed: async () =>
          Object.defineProperty({}, "modelFingerprint", {
            get() {
              throw new Error("hostile getter");
            },
          }) as never,
      }),
    ).resolves.toEqual({ published: [], reason: "invalid_vectors" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });

  it("rejects a noncanonical candidate before embedding egress", async () => {
    const root = createRoot();
    const model = createModel();
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [{ ...createCandidate(), text: " not canonical " }],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("discards an embedding result delivered after abort", async () => {
    const root = createRoot();
    const model = createModel();
    const record = createCandidate();
    const controller = new AbortController();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: controller.signal,
        embed: async () => {
          controller.abort();
          return embeddingResult(model, [[1, 2, 3]]);
        },
      }),
    ).resolves.toEqual({ published: [], reason: "port_failure" });
    expect(existsSync(sidecarPath(root, record, model))).toBe(false);
  });
});
