import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsyncedPaths: string[] = [];
const openedPaths = new Map<number, string>();

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync(...args: Parameters<typeof actual.openSync>) {
      const descriptor = actual.openSync(...args);
      openedPaths.set(descriptor, args[0]);
      return descriptor;
    },
    closeSync(descriptor: number) {
      actual.closeSync(descriptor);
      openedPaths.delete(descriptor);
    },
    fsyncSync(descriptor: number) {
      const path = openedPaths.get(descriptor);
      if (path !== undefined) fsyncedPaths.push(path);
      actual.fsyncSync(descriptor);
    },
  };
});

import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "../src/lm1-identity.js";
import type { Lm1Record } from "../src/lm1-model.js";
import { isKnownDarwinSystemAlias } from "../src/lm1-paths.js";
import { createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceIds = ["11111111-1111-4111-8111-111111111111"];
const evidenceDigests = ["a".repeat(64)];

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-paths-")));
  roots.push(root);
  return root;
}

function createRecord(input: { workspaceKey?: string } = {}): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey: input.workspaceKey ?? workspaceKey,
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
    id: deriveLm1RecordId(capture.workspaceKey, "state_snapshot", sourceDigest),
    sourceDigest,
    canonicalCaptureDigest: sourceDigest,
    evidenceBindingDigest: deriveEvidenceBindingDigest({
      workspaceKey: capture.workspaceKey,
      canonicalCaptureDigest: sourceDigest,
      evidenceIds,
      evidenceDigests,
    }),
    recordedAt: "2026-07-20T00:00:01.000Z",
    evidenceDigests,
    status: "recorded" as const,
  };
}

afterEach(() => {
  fsyncedPaths.splice(0);
  openedPaths.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM1 directory durability", () => {
  it("allows only verified macOS system path aliases", () => {
    expect(isKnownDarwinSystemAlias("/var", "/private/var", "darwin")).toBe(true);
    expect(isKnownDarwinSystemAlias("/tmp", "/private/tmp", "darwin")).toBe(true);
    expect(
      isKnownDarwinSystemAlias("/opt/megasaver/alias", "/private/tmp/attacker", "darwin"),
    ).toBe(false);
    expect(isKnownDarwinSystemAlias("/var", "/private/var", "linux")).toBe(false);
  });

  it("syncs each newly created long-memory ancestor before publishing", () => {
    const root = createRoot();
    createFileLm1Store({ storeRoot: root }).publish(createRecord());

    expect(fsyncedPaths).toEqual(
      expect.arrayContaining([
        root,
        join(root, "long-memory"),
        join(root, "long-memory", "v1"),
        join(root, "long-memory", "v1", workspaceKey),
      ]),
    );
  });

  it("syncs already-existing store ancestors before publishing", () => {
    const root = createRoot();
    const version = join(root, "long-memory", "v1");
    const workspace = join(version, workspaceKey);
    mkdirSync(workspace, { recursive: true });

    createFileLm1Store({ storeRoot: root }).publish(createRecord());

    expect(fsyncedPaths).toEqual(
      expect.arrayContaining([root, join(root, "long-memory"), version, workspace]),
    );
  });

  it("rejects the world-writable macOS /tmp alias as the store root", () => {
    if (process.platform !== "darwin" || !lstatSync("/tmp").isSymbolicLink()) return;

    expect(() => createFileLm1Store({ storeRoot: "/tmp" }).publish(createRecord())).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("allows the verified macOS /tmp alias as an ancestor of the store root", () => {
    if (process.platform !== "darwin" || !lstatSync("/tmp").isSymbolicLink()) return;

    const root = mkdtempSync(join("/tmp", "megasaver-lm1-paths-"));
    roots.push(root);
    const store = createFileLm1Store({ storeRoot: root });
    const record = createRecord();
    store.publish(record);

    expect(store.getById(workspaceKey, record.id)).toEqual(record);
  });
});
