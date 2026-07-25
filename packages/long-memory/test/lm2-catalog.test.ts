import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Lm1Record } from "../src/lm1-model.js";
import { createFileLm1Store } from "../src/lm1-store.js";
import { createLm2CandidateCatalog } from "../src/lm2-catalog.js";
import { lm2CandidateCatalogLockPath, lm2CandidateCatalogPath } from "../src/lm2-paths.js";
import {
  catalogEntry,
  cleanupRoots,
  createRecord,
  createRoot,
  workspaceKey,
  writeCatalog,
} from "./lm2-catalog-fixtures.js";
import { holdCatalogLock } from "./lm2-catalog-process-fixtures.js";

afterEach(cleanupRoots);

describe("LM2 candidate catalog", () => {
  it("does not treat an existing catalog lock file as an active lock", () => {
    const root = createRoot();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const record = createRecord();
    writeFileSync(lm2CandidateCatalogLockPath(root, workspaceKey), "held\n", { mode: 0o600 });

    expect(catalog.appendPublished(record)).toBe(true);
    expect(createFileLm1Store({ storeRoot: root }).publish(record)).toMatchObject({
      inserted: true,
      record,
    });
  });

  it("fails closed without catalog writes while another process holds the advisory lock", async () => {
    const root = createRoot();
    const path = lm2CandidateCatalogLockPath(root, workspaceKey);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const release = await holdCatalogLock(path);
    try {
      expect(catalog.appendPublished(createRecord())).toBe(false);
      expect(() => readFileSync(lm2CandidateCatalogPath(root, workspaceKey), "utf8")).toThrow();
    } finally {
      await release();
    }
    expect(catalog.appendPublished(createRecord())).toBe(true);
  });

  it("stores only bounded metadata for an LM1 capture", () => {
    const root = createRoot();
    const record = createRecord();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(true);
    expect(JSON.parse(readFileSync(lm2CandidateCatalogPath(root, workspaceKey), "utf8"))).toEqual({
      schemaVersion: 2,
      generation: 1,
      entries: [catalogEntry(record, 1)],
    });
  });

  it("does not allocate a new sequence for an immutable duplicate", () => {
    const root = createRoot();
    const record = createRecord();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(true);
    expect(catalog.appendPublished(record)).toBe(true);
    expect(catalog.page({ workspaceKey, cursor: null, limit: 10 })).toMatchObject({
      generation: 1,
      entries: [catalogEntry(record, 1)],
    });
  });

  it("fails catalog updates closed for corrupt and conflicting duplicate entries", () => {
    const root = createRoot();
    const record = createRecord();
    writeCatalog(root, [
      catalogEntry(record, 1),
      { ...catalogEntry(record, 1), sourceDigest: "b".repeat(64) },
    ]);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(false);
    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("fails closed for static symlinked catalog directories", () => {
    const root = createRoot();
    const outside = createRoot();
    const workspaceDirectory = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspaceDirectory, { recursive: true });
    symlinkSync(outside, join(workspaceDirectory, ".lm2"));
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(createRecord())).toBe(false);
    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("evicts the oldest capture sequence after the 10,000-record rolling window", () => {
    const root = createRoot();
    const records = Array.from({ length: 10_001 }, (_, index) => createRecord(index));
    writeCatalog(
      root,
      records.slice(0, 10_000).map((record, index) => catalogEntry(record, index + 1)),
    );
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(records[10_000] as Lm1Record)).toBe(true);
    const page = catalog.page({ workspaceKey, cursor: null, limit: 10_000 });
    expect(page.entries).toHaveLength(10_000);
    expect(page.entries[0]).toMatchObject({ captureSequence: 2 });
    expect(page.entries.at(-1)).toMatchObject({ captureSequence: 10_001 });
  });

  it("rejects catalogs over the four-MiB serialized limit", () => {
    const root = createRoot();
    const path = lm2CandidateCatalogPath(root, workspaceKey);
    writeFileSync(path, "x".repeat(4 * 1024 * 1024 + 1));
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(createRecord())).toBe(false);
    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("resumes an opaque cursor across a generation change while its sequence is retained", () => {
    const root = createRoot();
    const first = createRecord(1);
    const second = createRecord(2);
    const third = createRecord(3);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    catalog.appendPublished(first);
    catalog.appendPublished(second);
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;
    catalog.appendPublished(third);

    expect(cursor).not.toBeNull();
    expect(catalog.page({ workspaceKey, cursor, limit: 1 })).toMatchObject({
      generation: 3,
      entries: [catalogEntry(second, 2)],
    });
  });

  it("reports cursor_expired once its next sequence falls out of the rolling window", () => {
    const root = createRoot();
    const records = Array.from({ length: 10_002 }, (_, index) => createRecord(index));
    writeCatalog(
      root,
      records.slice(0, 10_000).map((record, index) => catalogEntry(record, index + 1)),
    );
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;
    catalog.appendPublished(records[10_000] as Lm1Record);
    catalog.appendPublished(records[10_001] as Lm1Record);

    expect(() => catalog.page({ workspaceKey, cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "cursor_expired" }),
    );
  });

  it("rejects a catalog with nonconsecutive retained capture sequences", () => {
    const root = createRoot();
    const first = createRecord();
    const second = createRecord(1);
    writeCatalog(root, [catalogEntry(first, 5), catalogEntry(second, 7)]);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(() => catalog.page({ workspaceKey, cursor: null, limit: 10 })).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("expires structurally valid cursors outside the retained or future generation", () => {
    const root = createRoot();
    const first = createRecord();
    const second = createRecord(1);
    writeCatalog(root, [catalogEntry(first, 1), catalogEntry(second, 2)], 2);
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;

    expect(cursor).not.toBeNull();
    writeCatalog(root, [catalogEntry(first, 5), catalogEntry(second, 6)], 2);
    expect(() => catalog.page({ workspaceKey, cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "cursor_expired" }),
    );
    writeCatalog(root, [catalogEntry(first, 5), catalogEntry(second, 6)], 1);
    expect(() => catalog.page({ workspaceKey, cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "cursor_expired" }),
    );
  });

  it("rejects malformed or cross-workspace opaque cursors", () => {
    const root = createRoot();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    catalog.appendPublished(createRecord());
    catalog.appendPublished(createRecord(1));
    const cursor = catalog.page({ workspaceKey, cursor: null, limit: 1 }).nextCursor;

    expect(() => catalog.page({ workspaceKey, cursor: "not-a-cursor", limit: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(cursor).not.toBeNull();
    expect(() => catalog.page({ workspaceKey: "fedcba9876543210", cursor, limit: 1 })).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});
