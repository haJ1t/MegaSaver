import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withWorkspaceIndexLock } from "../src/lm2-lock.js";
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

const deadline = () => ({
  signal: new AbortController().signal,
  deadlineAtMs: 1,
  now: () => 0,
});

describe("LM2 fixed operation lock", () => {
  it("returns busy to a second process before embedding or sidecar work", async () => {
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

  it("rejects a stale capability and a replacement lock pathname", async () => {
    const root = createRoot();
    const store = createLm2VectorStore({ storeRoot: root });
    const first = await store.beginIndexOperation({
      workspaceKey,
      model: createModel(),
      deadline: deadline(),
    });
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    const path = indexLockPath(root);
    renameSync(path, `${path}.displaced`);
    writeFileSync(path, `${"f".repeat(64)}\n`);
    const embed = vi.fn();

    await expect(
      first.publishBatch({
        records: [createCandidate()],
        embed,
        assertEgressAllowed: async () => true,
        recheckEvidence: async () => true,
      }),
    ).resolves.toEqual({ published: [], reason: "lock_integrity_lost" });
    expect(embed).not.toHaveBeenCalled();
    await expect(first.finalize()).rejects.toThrow();
    await expect(
      store.beginIndexOperation({
        workspaceKey,
        model: createModel(),
        deadline: deadline(),
      }),
    ).resolves.toEqual({ status: "invalid", quotaRecovery: "not_needed" });
  });

  it("returns unavailable for a malformed fixed token or unusable lock path", async () => {
    const root = createRoot();
    const path = indexLockPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "malformed\n");
    await expect(
      createLm2VectorStore({ storeRoot: root }).beginIndexOperation({
        workspaceKey,
        model: createModel(),
        deadline: deadline(),
      }),
    ).resolves.toEqual({ status: "unavailable" });

    const secondRoot = createRoot();
    mkdirSync(indexLockPath(secondRoot), { recursive: true });
    await expect(
      createLm2VectorStore({ storeRoot: secondRoot }).beginIndexOperation({
        workspaceKey,
        model: createModel(),
        deadline: deadline(),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps unsupported flock to unavailable without running work", async () => {
    const root = createRoot();
    const path = indexLockPath(root);
    mkdirSync(dirname(path), { recursive: true });
    const work = vi.fn();

    await expect(
      withWorkspaceIndexLock(path, work, () => {
        throw Object.assign(new Error("flock unsupported"), { code: "ENOTSUP" });
      }),
    ).rejects.toMatchObject({ code: "index_lock_unavailable" });
    expect(work).not.toHaveBeenCalled();
  });
});
