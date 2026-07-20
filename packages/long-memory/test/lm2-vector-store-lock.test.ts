import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { flockSync } from "fs-ext";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withWorkspaceIndexLock } from "../src/lm2-lock.js";
import { MAX_LM2_SIDECARS_PER_NAMESPACE, createLm2VectorStore } from "../src/lm2-vector-store.js";
import {
  cleanupRoots,
  createCandidate,
  createModel,
  createRoot,
  holdIndexLock,
  indexLockPath,
  seedSidecar,
  sidecarPath,
  startRealIndexer,
  workspaceKey,
} from "./lm2-vector-store-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 workspace index lock", () => {
  it("returns index_busy to a second process without scan, egress, or writes", async () => {
    const root = createRoot();
    const release = await holdIndexLock(indexLockPath(root));
    const embed = vi.fn();
    try {
      await expect(
        createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
          workspaceKey,
          model: createModel(),
          records: [createCandidate()],
          signal: new AbortController().signal,
          embed,
        }),
      ).resolves.toEqual({ published: [], reason: "index_busy" });
      expect(embed).not.toHaveBeenCalled();
      expect(() => readFileSync(sidecarPath(root, createCandidate(), createModel()))).toThrow();
    } finally {
      await release();
    }
  });

  it("serializes real cross-process indexers at the namespace quota edge", async () => {
    const root = createRoot();
    const model = createModel(0, 1);
    for (let index = 0; index < MAX_LM2_SIDECARS_PER_NAMESPACE - 1; index += 1) {
      seedSidecar(root, createCandidate(index), model, [1]);
    }
    const first = createCandidate(MAX_LM2_SIDECARS_PER_NAMESPACE - 1);
    const second = createCandidate(MAX_LM2_SIDECARS_PER_NAMESPACE);
    const releaseFirst = await startRealIndexer(root, model, first);
    const secondEmbed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model,
        records: [second],
        signal: new AbortController().signal,
        embed: secondEmbed,
      }),
    ).resolves.toEqual({ published: [], reason: "index_busy" });
    expect(secondEmbed).not.toHaveBeenCalled();
    expect(existsSync(sidecarPath(root, second, model))).toBe(false);
    await expect(releaseFirst()).resolves.toEqual({ published: [first.id], reason: null });
    expect(existsSync(sidecarPath(root, first, model))).toBe(true);
  }, 30_000);

  it("returns index_lock_unavailable when the lock cannot open", async () => {
    const root = createRoot();
    mkdirSync(indexLockPath(root), { recursive: true });
    const embed = vi.fn();

    await expect(
      createLm2VectorStore({ storeRoot: root }).reserveAndPublish({
        workspaceKey,
        model: createModel(),
        records: [createCandidate()],
        signal: new AbortController().signal,
        embed,
      }),
    ).resolves.toEqual({ published: [], reason: "index_lock_unavailable" });
    expect(embed).not.toHaveBeenCalled();
  });

  it("maps unsupported flock to index_lock_unavailable without running work", async () => {
    const root = createRoot();
    const path = indexLockPath(root);
    mkdirSync(join(path, ".."), { recursive: true });
    const work = vi.fn();

    await expect(
      withWorkspaceIndexLock(path, work, () => {
        throw Object.assign(new Error("flock unsupported"), { code: "ENOTSUP" });
      }),
    ).rejects.toMatchObject({ code: "index_lock_unavailable" });
    expect(work).not.toHaveBeenCalled();
  });

  it("fails closed when the lock parent changes after descriptor acquisition", async () => {
    const root = createRoot();
    const outside = createRoot();
    const path = indexLockPath(root);
    const directory = join(path, "..");
    mkdirSync(directory, { recursive: true });
    const work = vi.fn();

    await expect(
      withWorkspaceIndexLock(path, work, (descriptor) => {
        flockSync(descriptor, "exnb");
        renameSync(directory, `${directory}-displaced`);
        symlinkSync(outside, directory);
      }),
    ).rejects.toMatchObject({ code: "index_lock_unavailable" });
    expect(work).not.toHaveBeenCalled();
  });
});
