import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function createRecord(input?: { stateKey?: string; text?: string }): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt: "2026-07-20T00:00:00.000Z",
    text: input?.text ?? "Billing status is paid.",
    action: null,
    evidenceIds,
    stateKey: input?.stateKey ?? "billing.status",
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

function writeLargeRecordSet(root: string): readonly Lm1Record[] {
  const records = Array.from({ length: 10_001 }, (_, index) =>
    createRecord({
      stateKey: `billing.status.${index}`,
      text: `Billing status ${index} is current.`,
    }),
  );
  mkdirSync(join(root, "long-memory", "v1", workspaceKey, "snapshots"), { recursive: true });
  for (const record of records) {
    writeFileSync(recordPath(root, record.sourceDigest), JSON.stringify(record));
  }
  return records;
}

function publishInChild(root: string, record: Lm1Record): Promise<{ inserted: boolean }> {
  const distUrl = new URL("../dist/index.js", import.meta.url).href;
  const script = [
    `import { createFileLm1Store } from ${JSON.stringify(distUrl)};`,
    "const record = JSON.parse(process.env.MEGASAVER_LM1_RECORD ?? '{}');",
    "const result = createFileLm1Store({ storeRoot: process.env.MEGASAVER_LM1_ROOT ?? '' }).publish(record);",
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEGASAVER_LM1_RECORD: JSON.stringify(record),
        MEGASAVER_LM1_ROOT: root,
      },
    });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(output) as { inserted: boolean });
        return;
      }
      reject(new Error(error));
    });
  });
}

function buildChildRuntime(): void {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(command, ["--filter", "@megasaver/shared", "build"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
  execFileSync(command, ["--filter", "@megasaver/long-memory", "build"], {
    cwd: process.cwd(),
    stdio: "ignore",
  });
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

  it("allows two processes to publish one immutable record without a shared lock", async () => {
    const root = createRoot();
    const record = createRecord();
    buildChildRuntime();
    const results = await Promise.all([publishInChild(root, record), publishInChild(root, record)]);

    expect(results.map((result) => result.inserted).sort()).toEqual([false, true]);
    expect(createFileLm1Store({ storeRoot: root }).list(workspaceKey, 10_000)).toEqual([record]);
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

  it("publishes a retry after a failed pre-publish corruption is cleared", () => {
    const root = createRoot();
    const record = createRecord();
    const path = recordPath(root, record.sourceDigest);
    mkdirSync(join(root, "long-memory", "v1", workspaceKey, "snapshots"), { recursive: true });
    writeFileSync(path, "{not-json");
    const store = createFileLm1Store({ storeRoot: root });

    expect(() => store.publish(record)).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    rmSync(path);
    expect(store.publish(record)).toMatchObject({ inserted: true, record });
  });

  it("fails closed when a valid record is moved under another digest path", () => {
    const root = createRoot();
    const record = createRecord();
    const store = createFileLm1Store({ storeRoot: root });
    store.publish(record);
    renameSync(recordPath(root, record.sourceDigest), recordPath(root, "b".repeat(64)));

    expect(() => store.list(workspaceKey, 10_000)).toThrow(
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

  it("rejects a dangling static symlinked record parent", () => {
    const root = createRoot();
    const outside = createRoot();
    const record = createRecord();
    const workspaceDir = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspaceDir, { recursive: true });
    symlinkSync(join(outside, "missing"), join(workspaceDir, "snapshots"));

    expect(() => createFileLm1Store({ storeRoot: root }).publish(record)).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("fails closed instead of hiding a static symlink while listing records", () => {
    const root = createRoot();
    const outside = createRoot();
    const workspaceDir = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspaceDir, { recursive: true });
    symlinkSync(outside, join(workspaceDir, "snapshots"));

    expect(() => createFileLm1Store({ storeRoot: root }).list(workspaceKey, 10_000)).toThrow(
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

  it("rejects malformed record path components before lookup", () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root });

    expect(() => store.getByDigest(workspaceKey, "state_snapshot", "../../outside")).toThrow(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() =>
      store.getByDigest(workspaceKey, "unexpected" as "state_snapshot", "a".repeat(64)),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("keeps capture lookup unbounded while recall scans only its first ten thousand records", () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root });
    const records = writeLargeRecordSet(root);
    const bySourceDigest = [...records].sort((left, right) =>
      left.sourceDigest.localeCompare(right.sourceDigest),
    );
    const beyondRecallLimit = bySourceDigest[10_000];
    if (beyondRecallLimit === undefined) throw new Error("Expected an eleventh-thousand record.");

    expect(store.getById(workspaceKey, beyondRecallLimit.id)).toEqual(beyondRecallLimit);
    writeFileSync(recordPath(root, beyondRecallLimit.sourceDigest), "{corrupt");
    expect(store.list(workspaceKey, 10_000)).toHaveLength(10_000);
  });
});
