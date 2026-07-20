import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it.each([
    { name: "Float32 overflow", vector: [1e39, 0, 1] },
    { name: "nonfinite", vector: [Number.NaN, 0, 1] },
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
