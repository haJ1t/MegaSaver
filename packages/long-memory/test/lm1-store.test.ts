import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "../src/lm1-identity.js";
import type { Lm1Record } from "../src/lm1-model.js";
import { lm1ClosureMarkerPath } from "../src/lm1-paths.js";
import { createLm1RecallService } from "../src/lm1-recall.js";
import {
  type FileLm1Store,
  type Lm1StateIndexStore,
  createFileLm1Store,
} from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceIds = ["11111111-1111-4111-8111-111111111111"];
const evidenceDigests = ["a".repeat(64)];

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-store-")));
  roots.push(root);
  return root;
}

function createRecord(input?: {
  stateKey?: string;
  text?: string;
  observedAt?: string;
  supersedesSnapshotId?: string | null;
}): Lm1Record {
  const capture = {
    schemaVersion: 1 as const,
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt: input?.observedAt ?? "2026-07-20T00:00:00.000Z",
    text: input?.text ?? "Billing status is paid.",
    action: null,
    evidenceIds,
    stateKey: input?.stateKey ?? "billing.status",
    representation: "value" as const,
    supersedesSnapshotId: input?.supersedesSnapshotId ?? null,
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

function writeLargeRecordSet(root: string, count = 10_001): readonly Lm1Record[] {
  const records = Array.from({ length: count }, (_, index) =>
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
    `import { createLm1Runtime } from ${JSON.stringify(distUrl)};`,
    "const record = JSON.parse(process.env.MEGASAVER_LM1_RECORD ?? '{}');",
    "const { id: _id, sourceDigest: _sourceDigest, evidenceBindingDigest: _bindingDigest, recordedAt: _recordedAt, evidenceDigests: _evidenceDigests, status: _status, ...prepared } = record;",
    "const runtime = createLm1Runtime({ storeRoot: process.env.MEGASAVER_LM1_ROOT ?? '', redaction: { version: 'redaction-v1', redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }) }, evidenceBinding: { verify: async ({ evidenceIds }) => ({ evidence: evidenceIds.map((evidenceId) => ({ evidenceId, evidenceDigest: 'a'.repeat(64) })) }) }, evidenceEligibility: { resolve: async ({ workspaceKey, evidenceIds }) => evidenceIds.map((evidenceId) => ({ evidenceId, workspaceKey, status: 'available', unresolvedHighRisk: false })) }, clock: { now: () => record.recordedAt } });",
    "const result = await runtime.capture.capturePrepared({ prepared, authorization: 'signed' });",
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

function createStateIndexStore(root: string): Lm1StateIndexStore {
  return createFileLm1Store({ storeRoot: root }) as Lm1StateIndexStore;
}

function closureSuccessorId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
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
    expect(
      createStateIndexStore(root).stateSnapshotsForStateKeys(workspaceKey, [record.stateKey], 10),
    ).toEqual({
      snapshotsByStateKey: new Map([[record.stateKey, [record]]]),
      indexedStateKeys: new Set([record.stateKey]),
      incompleteStateKeys: new Set(),
    });
  });

  it("rejects a noncanonical recordedAt before persistence", () => {
    const store = createFileLm1Store({ storeRoot: createRoot() });

    expect(() =>
      store.publish({ ...createRecord(), recordedAt: "2026-07-20T03:00:01+03:00" }),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects an on-disk record with a noncanonical recordedAt", () => {
    const root = createRoot();
    const record = { ...createRecord(), recordedAt: "2026-07-20T03:00:01+03:00" };
    mkdirSync(join(root, "long-memory", "v1", workspaceKey, "snapshots"), { recursive: true });
    writeFileSync(recordPath(root, record.sourceDigest), JSON.stringify(record));

    expect(() => createFileLm1Store({ storeRoot: root }).list(workspaceKey, 10_000)).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("persists an append-only correction closure marker before bounded recall", () => {
    const root = createRoot();
    const predecessor = createRecord();
    const successor = createRecord({
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
      supersedesSnapshotId: predecessor.id,
    });
    const store = createStateIndexStore(root);

    store.publish(predecessor);
    store.publish(successor);

    expect(store.closureSuccessorIds(workspaceKey, [predecessor.id])).toEqual({
      successorIdsBySnapshotId: new Map([[predecessor.id, [successor.id]]]),
      incompletePredecessorSnapshotIds: new Set(),
    });
    expect(store.stateSnapshotsForStateKeys(workspaceKey, [predecessor.stateKey], 10)).toEqual({
      snapshotsByStateKey: new Map([[predecessor.stateKey, [successor, predecessor]]]),
      indexedStateKeys: new Set([predecessor.stateKey]),
      incompleteStateKeys: new Set(),
    });
  });

  it("fails closed before reading an oversized valid correction-closure set", () => {
    const root = createRoot();
    const predecessor = createRecord();
    const store = createStateIndexStore(root);
    store.publish(predecessor);
    const closureDirectory = join(
      root,
      "long-memory",
      "v1",
      workspaceKey,
      "closures",
      predecessor.id,
    );
    mkdirSync(closureDirectory, { recursive: true });
    for (let index = 0; index <= 10_000; index += 1) {
      const successorSnapshotId = closureSuccessorId(index);
      writeFileSync(
        join(closureDirectory, `${successorSnapshotId}.json`),
        JSON.stringify({
          workspaceKey,
          predecessorSnapshotId: predecessor.id,
          successorSnapshotId,
        }),
      );
    }

    expect(store.closureSuccessorIds(workspaceKey, [predecessor.id])).toEqual({
      successorIdsBySnapshotId: new Map(),
      incompletePredecessorSnapshotIds: new Set([predecessor.id]),
    });
  });

  it("fails closed when the shared correction-closure budget is exhausted", () => {
    const root = createRoot();
    const store = createStateIndexStore(root);
    store.publish(createRecord());
    const predecessorIds = Array.from({ length: 3 }, (_, index) => closureSuccessorId(index));
    for (const predecessorSnapshotId of predecessorIds) {
      const successorSnapshotId = closureSuccessorId(
        Number.parseInt(predecessorSnapshotId.slice(-12), 16) + 10,
      );
      const path = lm1ClosureMarkerPath(
        root,
        workspaceKey,
        predecessorSnapshotId,
        successorSnapshotId,
      );
      writeFileSync(
        path,
        JSON.stringify({ workspaceKey, predecessorSnapshotId, successorSnapshotId }),
      );
    }

    const lookup = store.closureSuccessorIds(workspaceKey, predecessorIds, 2);

    expect(lookup.successorIdsBySnapshotId).toHaveLength(2);
    expect(lookup.incompletePredecessorSnapshotIds).toEqual(new Set([predecessorIds[2]]));
  });

  it("rejects a static symlinked correction-closure parent", () => {
    const root = createRoot();
    const outside = createRoot();
    const predecessor = createRecord();
    const store = createStateIndexStore(root);
    store.publish(predecessor);
    symlinkSync(outside, join(root, "long-memory", "v1", workspaceKey, "closures"));

    expect(() =>
      store.publish(
        createRecord({
          observedAt: "2026-07-20T00:00:01.000Z",
          text: "Billing status is pending.",
          supersedesSnapshotId: predecessor.id,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("rejects a static symlinked state-index parent", () => {
    const root = createRoot();
    const outside = createRoot();
    const workspaceDirectory = join(root, "long-memory", "v1", workspaceKey);
    mkdirSync(workspaceDirectory, { recursive: true });
    symlinkSync(outside, join(workspaceDirectory, "state-index"));

    expect(() => createFileLm1Store({ storeRoot: root }).publish(createRecord())).toThrow(
      expect.objectContaining({ code: "store_corrupt" }),
    );
  });

  it("allows two processes to publish one immutable record without a shared lock", async () => {
    const root = createRoot();
    const record = createRecord();
    buildChildRuntime();
    const results = await Promise.all([publishInChild(root, record), publishInChild(root, record)]);

    expect(results.map((result) => result.inserted).sort()).toEqual([false, true]);
    expect(createFileLm1Store({ storeRoot: root }).list(workspaceKey, 10_000)).toEqual([record]);
  });

  it("converges concurrent retries with different clocks on the durable record pointer", async () => {
    const root = createRoot();
    const firstAttempt = createRecord();
    const retry = { ...firstAttempt, recordedAt: "2026-07-20T00:01:00.000Z" };
    buildChildRuntime();

    const results = await Promise.all([
      publishInChild(root, firstAttempt),
      publishInChild(root, retry),
    ]);
    const store = createStateIndexStore(root);
    const [durableRecord] = store.list(workspaceKey, 10_000);
    if (durableRecord === undefined) throw new Error("Expected one durable record.");

    expect(results.map((result) => result.inserted).sort()).toEqual([false, true]);
    expect(store.stateSnapshotsForStateKeys(workspaceKey, [durableRecord.stateKey], 10)).toEqual({
      snapshotsByStateKey: new Map([[durableRecord.stateKey, [durableRecord]]]),
      indexedStateKeys: new Set([durableRecord.stateKey]),
      incompleteStateKeys: new Set(),
    });
  });

  it("fails closed for calendar-invalid reservation and pointer timestamps", () => {
    const reservationRoot = createRoot();
    const record = createRecord();
    const reservationStore = createFileLm1Store({ storeRoot: reservationRoot });
    reservationStore.publish(record);
    const reservationPath = join(
      reservationRoot,
      "long-memory",
      "v1",
      workspaceKey,
      "reservations",
      "snapshots",
      `${record.sourceDigest}.json`,
    );
    const reservation = JSON.parse(readFileSync(reservationPath, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      reservationPath,
      JSON.stringify({ ...reservation, recordedAt: "2026-02-99T00:00:01.000Z" }),
    );

    expect(() =>
      reservationStore.publish({ ...record, recordedAt: "2026-07-20T00:01:00.000Z" }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));

    const pointerRoot = createRoot();
    const pointerStore = createStateIndexStore(pointerRoot);
    pointerStore.publish(record);
    const stateIndexRoot = join(pointerRoot, "long-memory", "v1", workspaceKey, "state-index");
    const [stateKeyDirectory] = readdirSync(stateIndexRoot);
    if (stateKeyDirectory === undefined) throw new Error("Expected a state-index directory.");
    const pointerDirectory = join(stateIndexRoot, stateKeyDirectory);
    const [pointerName] = readdirSync(pointerDirectory);
    if (pointerName === undefined) throw new Error("Expected a state-index pointer.");
    const pointerPath = join(pointerDirectory, pointerName);
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
    writeFileSync(
      pointerPath,
      JSON.stringify({ ...pointer, observedAt: "2026-02-99T00:00:00.000Z" }),
    );

    expect(() =>
      pointerStore.stateSnapshotsForStateKeys(workspaceKey, [record.stateKey], 10),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("rejects a static symlinked parent of the configured store root", () => {
    const root = createRoot();
    const outside = createRoot();
    const symlinkedParent = join(root, "redirect");
    symlinkSync(outside, symlinkedParent);

    expect(() =>
      createFileLm1Store({ storeRoot: join(symlinkedParent, "store") }).publish(createRecord()),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
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

  it("omits a raw snapshot that lacks its mandatory state-index pointer", async () => {
    const root = createRoot();
    const record = createRecord();
    mkdirSync(join(root, "long-memory", "v1", workspaceKey, "snapshots"), { recursive: true });
    writeFileSync(recordPath(root, record.sourceDigest), JSON.stringify(record));
    const recall = createLm1RecallService({
      store: createFileLm1Store({ storeRoot: root }),
      evidenceEligibility: {
        resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: record.id, reason: "omitted_correction_chain_unavailable" }],
      },
    });
  });

  it("omits a state group when one raw snapshot loses its pointer", async () => {
    const root = createRoot();
    const predecessor = createRecord();
    const successor = createRecord({
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
      supersedesSnapshotId: predecessor.id,
    });
    const store = createFileLm1Store({ storeRoot: root });
    store.publish(predecessor);
    store.publish(successor);
    const stateIndexRoot = join(root, "long-memory", "v1", workspaceKey, "state-index");
    const [stateKeyDirectory] = readdirSync(stateIndexRoot);
    if (stateKeyDirectory === undefined) throw new Error("Expected a state-index directory.");
    const pointerDirectory = join(stateIndexRoot, stateKeyDirectory);
    const successorPointer = readdirSync(pointerDirectory).find((name) =>
      name.includes(successor.id),
    );
    if (successorPointer === undefined) throw new Error("Expected a successor pointer.");
    rmSync(join(pointerDirectory, successorPointer));
    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing status paid", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: predecessor.id, reason: "omitted_correction_chain_unavailable" }],
      },
    });
  });

  it("omits a completed branch when a competing correction stops after its closure marker", async () => {
    const root = createRoot();
    const predecessor = createRecord();
    const completed = createRecord({
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing is completed.",
      supersedesSnapshotId: predecessor.id,
    });
    const interruptedBranch = createRecord({
      observedAt: "2026-07-20T00:00:02.000Z",
      text: "Billing is pending approval.",
      supersedesSnapshotId: predecessor.id,
    });
    const store = createFileLm1Store({ storeRoot: root });
    store.publish(predecessor);
    store.publish(completed);
    writeFileSync(
      lm1ClosureMarkerPath(root, workspaceKey, predecessor.id, interruptedBranch.id),
      JSON.stringify({
        workspaceKey,
        predecessorSnapshotId: predecessor.id,
        successorSnapshotId: interruptedBranch.id,
      }),
    );
    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [expect.objectContaining({ reason: "omitted_correction_chain_unavailable" })],
      },
    });
  });

  it("accepts a legacy store adapter without state-index capabilities", () => {
    const record = createRecord();
    const legacyStore: import("../src/lm1-store.js").FileLm1Store = {
      publish: () => ({ inserted: false, record }),
      getByDigest: () => record,
      getById: () => record,
      list: () => [record],
    };

    expect(legacyStore.list(workspaceKey, 1)).toEqual([record]);
  });

  it("keeps the file-store factory declaration limited to the legacy adapter contract", () => {
    expectTypeOf<ReturnType<typeof createFileLm1Store>>().toEqualTypeOf<FileLm1Store>();
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

  it("resolves a published record id without scanning an oversized record directory", () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root });
    const records = writeLargeRecordSet(root);
    const target = createRecord({
      stateKey: "billing.status.locator",
      text: "Billing status is indexed for direct lookup.",
    });
    const corruptRecord = records[0];
    if (corruptRecord === undefined) throw new Error("Expected oversized record fixtures.");
    store.publish(target);
    expect(store.list(workspaceKey, 10_000)).toHaveLength(10_000);
    writeFileSync(recordPath(root, corruptRecord.sourceDigest), "{corrupt");

    expect(store.getById(workspaceKey, target.id)).toEqual(target);
  });

  it("returns a newer independent snapshot outside the lexical scan window", async () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root });
    writeLargeRecordSet(root, 20_000);
    const predecessor = store.list(workspaceKey, 10_000)[0];
    if (predecessor === undefined) {
      throw new Error("Expected bounded recall fixtures.");
    }
    store.publish(predecessor);
    let current: Lm1Record | undefined;
    for (let index = 0; index < 100; index += 1) {
      const candidate = createRecord({
        stateKey: predecessor.stateKey,
        text: `Independent current billing status ${index}.`,
        observedAt: "2026-07-20T00:00:01.000Z",
      });
      store.publish(candidate);
      if (!store.list(workspaceKey, 10_000).some((record) => record.id === candidate.id)) {
        current = candidate;
        break;
      }
    }
    if (current === undefined) throw new Error("Expected a current state beyond the bounded scan.");
    expect(store.list(workspaceKey, 10_000)).toContainEqual(predecessor);
    expect(store.list(workspaceKey, 10_000)).not.toContainEqual(current);

    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
    });
    const result = await recall.recall({
      workspaceKey,
      task: predecessor.text,
      tokenBudget: 100_000,
    });

    expect(result.items).toContainEqual(expect.objectContaining({ observationId: current.id }));
    expect(result.items).not.toContainEqual(
      expect.objectContaining({ observationId: predecessor.id }),
    );
  });

  it("omits a state group when an out-of-window current snapshot loses its pointer", async () => {
    const root = createRoot();
    const store = createFileLm1Store({ storeRoot: root });
    writeLargeRecordSet(root, 20_000);
    const predecessor = store.list(workspaceKey, 10_000)[0];
    if (predecessor === undefined) {
      throw new Error("Expected bounded recall fixtures.");
    }
    store.publish(predecessor);
    let current: Lm1Record | undefined;
    for (let index = 0; index < 100; index += 1) {
      const candidate = createRecord({
        stateKey: predecessor.stateKey,
        text: `Independent current billing status ${index}.`,
        observedAt: "2026-07-20T00:00:01.000Z",
      });
      store.publish(candidate);
      if (!store.list(workspaceKey, 10_000).some((record) => record.id === candidate.id)) {
        current = candidate;
        break;
      }
    }
    if (current === undefined) {
      throw new Error("Expected a current state beyond the bounded scan.");
    }
    const stateIndexRoot = join(root, "long-memory", "v1", workspaceKey, "state-index");
    const [stateKeyDirectory] = readdirSync(stateIndexRoot);
    if (stateKeyDirectory === undefined) throw new Error("Expected a state-index directory.");
    const pointerDirectory = join(stateIndexRoot, stateKeyDirectory);
    const currentPointer = readdirSync(pointerDirectory).find((name) => name.includes(current.id));
    if (currentPointer === undefined) throw new Error("Expected a current pointer.");
    rmSync(join(pointerDirectory, currentPointer));

    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) =>
          evidenceIds.map((evidenceId) => ({
            evidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
    });
    const result = await recall.recall({
      workspaceKey,
      task: predecessor.text,
      tokenBudget: 100_000,
    });

    expect(result.items).not.toContainEqual(
      expect.objectContaining({ observationId: predecessor.id }),
    );
    expect(result.receipt.omitted).toContainEqual({
      id: predecessor.id,
      reason: "omitted_correction_chain_unavailable",
    });
  });
});
