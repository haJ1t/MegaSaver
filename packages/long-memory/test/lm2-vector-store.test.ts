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
import { createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  embeddingResult,
  seedRawSidecar,
  sidecarPath,
  sidecarValue,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 vector sidecar publication", () => {
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
    expect(readFileSync(sidecarPath(root, record, model), "utf8")).toBe(
      `${JSON.stringify(sidecarValue(record, model, [3, 4, 0]))}\n`,
    );
  });

  it("performs no egress through symlinked vector parents", async () => {
    const root = createRoot();
    const outside = createRoot();
    const model = createModel();
    const record = createCandidate();
    const workspace = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspace, { recursive: true });
    symlinkSync(outside, join(workspace, "embeddings"));
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [record],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(embed).not.toHaveBeenCalled();

    const secondRoot = createRoot();
    const embeddings = join(secondRoot, "long-memory", "v1", workspaceKey, "embeddings");
    const outsideNamespace = join(outside, "namespace");
    mkdirSync(embeddings, { recursive: true });
    mkdirSync(outsideNamespace, { recursive: true });
    writeFileSync(
      join(outsideNamespace, `${record.id}.json`),
      `${JSON.stringify(sidecarValue(record, model, [1, 2, 3]))}\n`,
    );
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
          seedRawSidecar(root, record, model, conflicting);
          return embeddingResult(model, [[1, 2, 3]]);
        },
      }),
    ).resolves.toEqual({ published: [], reason: "write_failed" });
    expect(readFileSync(sidecarPath(root, record, model), "utf8")).toBe(conflicting);
  });

  it("fails closed instead of publishing through a parent swapped during egress", async () => {
    const root = createRoot();
    const outside = createRoot();
    const model = createModel();
    const record = createCandidate();
    const namespace = join(sidecarPath(root, record, model), "..");

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
