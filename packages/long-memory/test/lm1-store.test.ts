import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceIds = ["11111111-1111-4111-8111-111111111111"];
const evidenceDigests = ["a".repeat(64)];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-lm1-store-"));
  roots.push(root);
  return root;
}

function createRecord(): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt: "2026-07-20T00:00:00.000Z",
    text: "Billing status is paid.",
    action: null,
    evidenceIds,
    stateKey: "billing.status",
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

function recordPath(root: string, sourceDigest: string): string {
  return join(root, "long-memory", "v1", workspaceKey, "snapshots", `${sourceDigest}.json`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM1 file store", () => {
  it("adopts the first durable record after restart and ignores retry recordedAt", () => {
    const root = createRoot();
    const record = createRecord();

    expect(createFileLm1Store({ storeRoot: root }).publish(record)).toEqual({
      inserted: true,
      record,
    });
    expect(
      createFileLm1Store({ storeRoot: root }).publish({
        ...record,
        recordedAt: "2026-07-20T00:01:00.000Z",
      }),
    ).toEqual({ inserted: false, record });
  });

  it("fails closed for a corrupt deterministic record file", () => {
    const root = createRoot();
    const record = createRecord();
    const path = recordPath(root, record.sourceDigest);
    mkdirSync(join(root, "long-memory", "v1", workspaceKey, "snapshots"), { recursive: true });
    writeFileSync(path, "{not-json");

    expect(() => createFileLm1Store({ storeRoot: root }).publish(record)).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("rejects a static symlinked record parent", () => {
    const root = createRoot();
    const outside = createRoot();
    const record = createRecord();
    const workspaceDir = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspaceDir, { recursive: true });
    symlinkSync(outside, join(workspaceDir, "snapshots"));

    expect(() => createFileLm1Store({ storeRoot: root }).publish(record)).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("reports a missing deterministic record as not_found", () => {
    const root = createRoot();

    expect(() =>
      createFileLm1Store({ storeRoot: root }).getByDigest(
        workspaceKey,
        "state_snapshot",
        "a".repeat(64),
      ),
    ).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});
