import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLm2CandidateCatalog } from "../src/lm2-catalog.js";
import {
  catalogEntry,
  cleanupRoots,
  createRecord,
  createRoot,
  v2Paths,
  workspaceKey,
  writeV2Control,
} from "./lm2-catalog-fixtures.js";
import {
  holdCatalogLock,
  runCatalogChild,
  startBarrierAppender,
  startSignaledAppender,
} from "./lm2-catalog-process-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 candidate catalog process safety", () => {
  it("checks V1 after flock before writing the bootstrap token", async () => {
    const root = createRoot();
    const paths = v2Paths(root);
    const gatePath = join(root, "post-flock-gate");
    const finish = await startSignaledAppender(
      root,
      createRecord(),
      "append-pause-after-flock",
      "flocked",
      gatePath,
    );
    const v1Path = join(paths.directory, "candidate-catalog-v1.json");
    const v1 = "legacy-writer-arrived-before-bootstrap\n";
    writeFileSync(v1Path, v1);
    writeFileSync(gatePath, "go\n");

    expect(await finish()).toBe(false);
    expect(readFileSync(paths.lock, "utf8")).toBe("");
    expect(existsSync(paths.control)).toBe(false);
    expect(existsSync(paths.catalog)).toBe(false);
    expect(readFileSync(v1Path, "utf8")).toBe(v1);
  });

  it.each(["candidate-catalog-v1.json", "candidate-catalog-v1.lock"])(
    "invalidates %s without reading, migrating, or overwriting it",
    async (name) => {
      const root = createRoot();
      const paths = v2Paths(root);
      mkdirSync(paths.directory, { recursive: true });
      const v1Path = join(paths.directory, name);
      const original = "legacy-catalog-must-remain-byte-identical\n";
      writeFileSync(v1Path, original);

      expect(await runCatalogChild(root, createRecord())).toBe(false);
      expect(readFileSync(v1Path, "utf8")).toBe(original);
      expect(existsSync(paths.catalog)).toBe(false);
      expect(() =>
        createLm2CandidateCatalog({ storeRoot: root }).page({
          workspaceKey,
          cursor: null,
          limit: 1,
        }),
      ).toThrow(expect.objectContaining({ code: "catalog_schema_unsupported" }));
    },
  );

  it("rejects an orphan catalog lock that is not mode 0600", async () => {
    const root = createRoot();
    const paths = v2Paths(root);
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.lock, "orphaned-before-token\n", { mode: 0o644 });

    expect(await runCatalogChild(root, createRecord())).toBe(false);
    expect(existsSync(paths.control)).toBe(false);
    expect(existsSync(paths.catalog)).toBe(false);
  });

  it("recovers only an orphan V2 lock on the same inode after a creator crash", async () => {
    const root = createRoot();
    const paths = v2Paths(root);
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.lock, "orphaned-before-token\n", { mode: 0o600 });
    const identity = statSync(paths.lock);

    expect(await runCatalogChild(root, createRecord())).toBe(true);
    expect(statSync(paths.lock)).toMatchObject({ dev: identity.dev, ino: identity.ino });
    expect(JSON.parse(readFileSync(paths.catalog, "utf8"))).toMatchObject({
      schemaVersion: 2,
      generation: 1,
    });
    expect(JSON.parse(readFileSync(paths.control, "utf8"))).toMatchObject({
      schemaVersion: 2,
      catalogLock: { device: identity.dev, inode: identity.ino },
    });
  });

  it("recovers the exact empty V2 catalog after a control-before-catalog crash", async () => {
    const root = createRoot();
    const paths = v2Paths(root);
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.lock, `${"a".repeat(64)}\n`, { mode: 0o600 });
    writeV2Control(root);

    expect(await runCatalogChild(root, createRecord())).toBe(true);
    expect(JSON.parse(readFileSync(paths.catalog, "utf8"))).toMatchObject({
      schemaVersion: 2,
      generation: 1,
      entries: [catalogEntry(createRecord(), 1)],
    });
  });

  it("rejects catalog symlinks for both reads and writes", async () => {
    const root = createRoot();
    const outside = createRoot();
    expect(await runCatalogChild(root, createRecord())).toBe(true);
    const paths = v2Paths(root);
    const outsideCatalog = join(outside, "outside-catalog.json");
    const original = "outside-must-not-change\n";
    writeFileSync(outsideCatalog, original);
    renameSync(paths.catalog, `${paths.catalog}.displaced`);
    symlinkSync(outsideCatalog, paths.catalog);

    expect(await runCatalogChild(root, createRecord(1))).toBe(false);
    expect(readFileSync(outsideCatalog, "utf8")).toBe(original);
    expect(() =>
      createLm2CandidateCatalog({ storeRoot: root }).page({
        workspaceKey,
        cursor: null,
        limit: 10,
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("rejects an idle lock-path replacement without adopting the new inode", async () => {
    const root = createRoot();
    expect(await runCatalogChild(root, createRecord())).toBe(true);
    const paths = v2Paths(root);
    renameSync(paths.lock, `${paths.lock}.displaced`);
    writeFileSync(paths.lock, `${"b".repeat(64)}\n`, { mode: 0o600 });

    expect(await runCatalogChild(root, createRecord(1))).toBe(false);
    expect(() =>
      createLm2CandidateCatalog({ storeRoot: root }).page({
        workspaceKey,
        cursor: null,
        limit: 10,
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("rejects real old-inode and replacement-inode API writers without mutation", async () => {
    const root = createRoot();
    expect(await runCatalogChild(root, createRecord())).toBe(true);
    const paths = v2Paths(root);
    const before = readFileSync(paths.catalog, "utf8");
    const release = await holdCatalogLock(paths.lock);
    const finishOldWriter = await startSignaledAppender(
      root,
      createRecord(1),
      "append-observe-flock",
      "flocking",
    );
    try {
      const finishReplacementWriter = await startSignaledAppender(
        root,
        createRecord(2),
        "replace-lock-and-append",
        "replacement-locked",
      );
      expect(await finishReplacementWriter()).toBe(false);
    } finally {
      await release();
    }
    expect(await finishOldWriter()).toBe(false);
    expect(readFileSync(paths.catalog, "utf8")).toBe(before);
    expect(JSON.parse(before)).toMatchObject({ generation: 1 });
  });

  it("fails before V2 publication when V1 appears after lock acquisition", async () => {
    const root = createRoot();
    expect(await runCatalogChild(root, createRecord())).toBe(true);
    const paths = v2Paths(root);
    const before = readFileSync(paths.catalog, "utf8");
    const gatePath = join(root, "publish-gate");
    const finish = await startSignaledAppender(
      root,
      createRecord(1),
      "append-pause-before-publish",
      "prepared",
      gatePath,
    );
    const v1Path = join(paths.directory, "candidate-catalog-v1.json");
    const v1 = "legacy-writer-arrived\n";
    writeFileSync(v1Path, v1);
    writeFileSync(gatePath, "go\n");

    expect(await finish()).toBe(false);
    expect(readFileSync(paths.catalog, "utf8")).toBe(before);
    expect(readFileSync(v1Path, "utf8")).toBe(v1);
  });

  it("releases the catalog flock before reporting an anchor-close failure", async () => {
    const root = createRoot();
    expect(await runCatalogChild(root, createRecord(), "append-with-anchor-close-failure")).toBe(
      false,
    );
    expect(await runCatalogChild(root, createRecord(1))).toBe(true);
    expect(
      createLm2CandidateCatalog({ storeRoot: root }).page({
        workspaceKey,
        cursor: null,
        limit: 10,
      }).entries,
    ).toHaveLength(2);
  });

  it("serializes two real appenders without losing either catalog entry", async () => {
    const root = createRoot();
    expect(await runCatalogChild(root, createRecord())).toBe(true);
    const first = await startBarrierAppender(root, createRecord(1));
    const second = await startBarrierAppender(root, createRecord(2));

    expect(await Promise.all([first(), second()])).toEqual([true, true]);
    expect(
      createLm2CandidateCatalog({ storeRoot: root }).page({
        workspaceKey,
        cursor: null,
        limit: 10,
      }).entries,
    ).toHaveLength(3);
  });
});
