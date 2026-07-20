import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelDescriptorFingerprint } from "../src/lm2-identity.js";
import {
  MAX_LM2_SIDECARS_PER_NAMESPACE,
  MAX_LM2_SIDECAR_BYTES,
  MAX_LM2_WORKSPACE_VECTOR_BYTES,
  createLm2VectorStore,
} from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  embeddingResult,
  seedRawSidecar,
  seedSidecar,
  sidecarPath,
  sidecarValue,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 vector quotas", () => {
  it("does not egress when a third descriptor namespace exceeds quota", async () => {
    const root = createRoot();
    seedSidecar(root, createCandidate(1), createModel(1), [1, 2, 3]);
    seedSidecar(root, createCandidate(2), createModel(2), [1, 2, 3]);
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model: createModel(3),
        records: [createCandidate(3)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("does not let crash partials or malformed sidecars reserve namespace quota", async () => {
    const root = createRoot();
    const first = createModel(1);
    const second = createModel(2);
    const requested = createModel(3);
    const firstDirectory = join(sidecarPath(root, createCandidate(1), first), "..");
    const secondDirectory = join(sidecarPath(root, createCandidate(2), second), "..");
    mkdirSync(firstDirectory, { recursive: true });
    mkdirSync(secondDirectory, { recursive: true });
    writeFileSync(join(firstDirectory, ".crash.tmp"), "partial");
    writeFileSync(join(secondDirectory, `${createCandidate(2).id}.json`), "{invalid");

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model: requested,
        records: [createCandidate(3)],
        signal: new AbortController().signal,
        embed: async () => embeddingResult(requested, [[1, 2, 3]]),
      }),
    ).resolves.toEqual({ published: [createCandidate(3).id], reason: null });
  });

  it("reserves worst-case bytes before crossing the 10,000-record cap", async () => {
    const root = createRoot();
    const model = createModel(0, 1);
    for (let index = 0; index < MAX_LM2_SIDECARS_PER_NAMESPACE; index += 1) {
      seedSidecar(root, createCandidate(index), model, [1]);
    }
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [createCandidate(MAX_LM2_SIDECARS_PER_NAMESPACE)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("reserves 24 KiB before crossing the 128-MiB workspace cap", async () => {
    const root = createRoot();
    const model = createModel(0, 4_096);
    const vector = Array.from({ length: model.dimensions }, () => 1);
    let serializedBytes = 0;
    let index = 0;
    while (serializedBytes <= MAX_LM2_WORKSPACE_VECTOR_BYTES - MAX_LM2_SIDECAR_BYTES) {
      const candidate = createCandidate(index);
      const raw = `${JSON.stringify(sidecarValue(candidate, model, vector))}\n`;
      seedRawSidecar(root, candidate, model, raw);
      serializedBytes += Buffer.byteLength(raw, "utf8");
      index += 1;
    }
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [createCandidate(index)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "storage_limit" });
    expect(embed).not.toHaveBeenCalled();
  }, 30_000);

  it("fails closed for an unreadable descriptor namespace", async () => {
    const root = createRoot();
    const occupiedModel = createModel(1);
    const occupiedPath = sidecarPath(root, createCandidate(1), occupiedModel);
    seedSidecar(root, createCandidate(1), occupiedModel, [1, 2, 3]);
    chmodSync(join(occupiedPath, ".."), 0o000);
    const embed = vi.fn();
    try {
      await expect(
        createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
          workspaceKey,
          model: createModel(2),
          records: [createCandidate(2)],
          signal: new AbortController().signal,
          embed,
        }),
      ).resolves.toEqual({ published: [], reason: "write_failed" });
      expect(embed).not.toHaveBeenCalled();
    } finally {
      chmodSync(join(occupiedPath, ".."), 0o700);
    }
  });

  it("fails closed when a durable sidecar cannot be read", async () => {
    const root = createRoot();
    const occupiedModel = createModel(1);
    const occupiedPath = sidecarPath(root, createCandidate(1), occupiedModel);
    seedSidecar(root, createCandidate(1), occupiedModel, [1, 2, 3]);
    chmodSync(occupiedPath, 0o000);
    const embed = vi.fn();
    try {
      await expect(
        createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
          workspaceKey,
          model: createModel(2),
          records: [createCandidate(2)],
          signal: new AbortController().signal,
          embed,
        }),
      ).resolves.toEqual({ published: [], reason: "write_failed" });
      expect(embed).not.toHaveBeenCalled();
    } finally {
      chmodSync(occupiedPath, 0o600);
    }
  });

  it("fails closed when any descriptor namespace is a symlink", async () => {
    const root = createRoot();
    const outside = createRoot();
    const embeddings = join(root, "long-memory", "v1", workspaceKey, "embeddings");
    mkdirSync(embeddings, { recursive: true });
    symlinkSync(outside, join(embeddings, modelDescriptorFingerprint(createModel(1))));
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model: createModel(2),
        records: [createCandidate(2)],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(embed).not.toHaveBeenCalled();
  });
});
