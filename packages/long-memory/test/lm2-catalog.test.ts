import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "../src/lm1-identity.js";
import type { Lm1Record } from "../src/lm1-model.js";
import { createFileLm1Store } from "../src/lm1-store.js";
import { createLm2CandidateCatalog } from "../src/lm2-catalog.js";
import { lm2CandidateCatalogLockPath, lm2CandidateCatalogPath } from "../src/lm2-paths.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceIds = ["11111111-1111-4111-8111-111111111111"];
const evidenceDigests = ["a".repeat(64)];

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm2-catalog-")));
  roots.push(root);
  return root;
}

function createRecord(index = 0): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt: new Date(Date.UTC(2026, 6, 20, 0, 0, index % 60)).toISOString(),
    text: `Billing status ${index} is paid.`,
    action: null,
    evidenceIds,
    stateKey: `billing.status.${index}`,
    representation: "value" as const,
    supersedesSnapshotId: null,
    redactionVersion: "redaction-v1",
  };
  const sourceDigest = canonicalCaptureDigest(capture);
  return {
    ...capture,
    id: deriveLm1RecordId(workspaceKey, "state_snapshot", sourceDigest),
    sourceDigest,
    canonicalCaptureDigest: sourceDigest,
    evidenceBindingDigest: deriveEvidenceBindingDigest({
      workspaceKey,
      canonicalCaptureDigest: sourceDigest,
      evidenceIds,
      evidenceDigests,
    }),
    recordedAt: "2026-07-20T00:00:01.000Z",
    evidenceDigests,
    status: "recorded" as const,
  };
}

function catalogEntry(record: Lm1Record, captureSequence: number) {
  return {
    id: record.id,
    sourceDigest: record.sourceDigest,
    kind: record.kind,
    observedAt: record.observedAt,
    captureSequence,
  };
}

function writeCatalog(root: string, entries: readonly ReturnType<typeof catalogEntry>[]): void {
  const path = lm2CandidateCatalogPath(root, workspaceKey);
  writeFileSync(
    path,
    `${JSON.stringify({ schemaVersion: 1, generation: entries.length, entries })}\n`,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM2 candidate catalog", () => {
  it("keeps a published LM1 record usable when catalog persistence cannot acquire its lock", () => {
    const root = createRoot();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });
    const record = createRecord();
    writeFileSync(lm2CandidateCatalogLockPath(root, workspaceKey), "held\n");

    expect(catalog.appendPublished(record)).toBe(false);
    expect(createFileLm1Store({ storeRoot: root }).publish(record)).toMatchObject({
      inserted: true,
      record,
    });
  });

  it("stores only bounded metadata for an LM1 capture", () => {
    const root = createRoot();
    const record = createRecord();
    const catalog = createLm2CandidateCatalog({ storeRoot: root });

    expect(catalog.appendPublished(record)).toBe(true);
    expect(JSON.parse(readFileSync(lm2CandidateCatalogPath(root, workspaceKey), "utf8"))).toEqual({
      schemaVersion: 1,
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

  it("reads exact LM1 locators with expected tuples and never needs record enumeration", () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root }) as ReturnType<
      typeof createFileLm1Store
    > & {
      getByIds(
        requestedWorkspaceKey: string,
        entries: readonly Pick<Lm1Record, "id" | "kind" | "sourceDigest">[],
        limit: number,
      ): readonly Lm1Record[];
    };
    const record = createRecord();
    const second = createRecord(1);
    store.publish(record);
    store.publish(second);
    const snapshots = join(root, "long-memory", "v1", workspaceKey, "snapshots");
    writeFileSync(join(snapshots, `${"c".repeat(64)}.json`), "{corrupt");

    expect(store.getByIds(workspaceKey, [catalogEntry(record, 1)], 1)).toEqual([record]);
    expect(
      store.getByIds(workspaceKey, [catalogEntry(record, 1), catalogEntry(second, 2)], 1),
    ).toEqual([record]);
    expect(() =>
      store.getByIds(
        workspaceKey,
        [{ ...catalogEntry(record, 1), sourceDigest: "d".repeat(64) }],
        1,
      ),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });
});
