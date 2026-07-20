import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Lm2Candidate } from "../src/lm2-model.js";
import { MAX_LM2_SIDECAR_BYTES, createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  seedRawSidecar,
  seedSidecar,
  sidecarPath,
  sidecarValue,
  vectorBase64,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 verified vector reads", () => {
  it("returns only identity-bound canonical Float32 vectors", async () => {
    const root = createRoot();
    const model = createModel();
    const candidates = Array.from({ length: 13 }, (_, index) => createCandidate(index));
    const values = candidates.map((candidate) => sidecarValue(candidate, model, [1, 2, 3]));
    const invalid = [
      "{malformed",
      `${JSON.stringify({ ...values[1], vectorBase64: "AAAA" })}\n`,
      `${JSON.stringify({ ...values[2], workspaceKey: "fedcba9876543210" })}\n`,
      `${JSON.stringify({ ...values[3], recordId: candidates[4]?.id })}\n`,
      `${JSON.stringify({ ...values[4], sourceDigest: "f".repeat(64) })}\n`,
      `${JSON.stringify({ ...values[5], kind: "state_transition" })}\n`,
      `${JSON.stringify({ ...values[6], embeddingInputDigest: "e".repeat(64) })}\n`,
      `${JSON.stringify({ ...values[7], model: createModel(9) })}\n`,
      `${JSON.stringify({ ...values[8], dimension: 2 })}\n`,
      `${JSON.stringify({ ...values[9], vectorBase64: vectorBase64([0, 0, 0]) })}\n`,
      `${JSON.stringify({
        ...values[10],
        vectorBase64: vectorBase64([Number.POSITIVE_INFINITY, 0, 1]),
      })}\n`,
      `${JSON.stringify(values[11], null, 2)}\n`,
    ];
    invalid.forEach((raw, index) =>
      seedRawSidecar(root, candidates[index] as Lm2Candidate, model, raw),
    );
    seedSidecar(root, candidates[12] as Lm2Candidate, model, [1, 2, 3]);

    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model,
        candidates,
        maxDecodedBytes: 64 * 1024 * 1024,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: candidates[12]?.id, vector: [1, 2, 3], decodedBytes: 12 }]);
  });

  it("admits identity and decoded-byte budget before vector decode", async () => {
    const root = createRoot();
    const model = createModel(0, 4_096);
    const wrongIdentity = createCandidate(1);
    const valid = createCandidate(2);
    const vector = Array.from({ length: model.dimensions }, () => 1);
    seedRawSidecar(
      root,
      wrongIdentity,
      model,
      `${JSON.stringify({
        ...sidecarValue(wrongIdentity, model, vector),
        sourceDigest: "f".repeat(64),
      })}\n`,
    );
    seedSidecar(root, valid, model, vector);

    const result = await createLm2VectorStore({ storeRoot: root }).readVerified({
      workspaceKey,
      model,
      candidates: [wrongIdentity, valid],
      maxDecodedBytes: model.dimensions * 4,
      signal: new AbortController().signal,
    });
    expect(result).toEqual([
      { candidateId: valid.id, vector: vector as readonly number[], decodedBytes: 16_384 },
    ]);
    expect(result.reduce((sum, entry) => sum + entry.decodedBytes, 0)).toBeLessThanOrEqual(16_384);
  });

  it("rejects oversized sidecars and honors a smaller decoded-byte budget", async () => {
    const root = createRoot();
    const model = createModel();
    const first = createCandidate(1);
    const second = createCandidate(2);
    const oversized = createCandidate(3);
    seedSidecar(root, first, model, [1, 2, 3]);
    seedSidecar(root, second, model, [4, 5, 6]);
    seedRawSidecar(root, oversized, model, "x".repeat(MAX_LM2_SIDECAR_BYTES + 1));

    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model,
        candidates: [first, second, oversized],
        maxDecodedBytes: 12,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: first.id, vector: [1, 2, 3], decodedBytes: 12 }]);
  });

  it("supports the bounded 10,000-candidate surface", async () => {
    const root = createRoot();
    const model = createModel();
    const candidates = Array.from({ length: 257 }, (_, index) => createCandidate(index));
    seedSidecar(root, candidates[256] as Lm2Candidate, model, [1, 2, 3]);

    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model,
        candidates,
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([{ candidateId: candidates[256]?.id, vector: [1, 2, 3], decodedBytes: 12 }]);
  });

  it("does not mutate an absent query workspace", async () => {
    const root = createRoot();
    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model: createModel(),
        candidates: [createCandidate()],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([]);
    expect(existsSync(join(root, "long-memory"))).toBe(false);
  });

  it("never follows a sidecar symlink", async () => {
    const root = createRoot();
    const outside = createRoot();
    const model = createModel();
    const candidate = createCandidate();
    const path = sidecarPath(root, candidate, model);
    mkdirSync(join(path, ".."), { recursive: true });
    const outsideFile = join(outside, "sidecar.json");
    writeFileSync(outsideFile, `${JSON.stringify(sidecarValue(candidate, model, [1, 2, 3]))}\n`);
    symlinkSync(outsideFile, path);

    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model,
        candidates: [candidate],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([]);
  });

  it.runIf(process.platform !== "win32")("never reads a sidecar FIFO", async () => {
    const root = createRoot();
    const model = createModel();
    const candidate = createCandidate();
    const path = sidecarPath(root, candidate, model);
    mkdirSync(dirname(path), { recursive: true });
    expect(spawnSync("mkfifo", [path]).status).toBe(0);

    await expect(
      createLm2VectorStore({ storeRoot: root }).readVerified({
        workspaceKey,
        model,
        candidates: [candidate],
        maxDecodedBytes: 64,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual([]);
  });
});
