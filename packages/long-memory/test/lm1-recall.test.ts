import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLm1CaptureService } from "../src/lm1-capture.js";
import { Lm1Error } from "../src/lm1-errors.js";
import { type Lm1Record, lm1RecordSchema } from "../src/lm1-model.js";
import { createLm1RecallService } from "../src/lm1-recall.js";
import { type FileLm1Store, createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const firstEvidenceId = "11111111-1111-4111-8111-111111111111";
const secondEvidenceId = "22222222-2222-4222-8222-222222222222";

function createServices() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-recall-")));
  roots.push(root);
  const statuses = new Map<string, "available" | "retained_metadata_only" | "revoked">();
  statuses.set(firstEvidenceId, "available");
  statuses.set(secondEvidenceId, "available");
  const store = createFileLm1Store({ storeRoot: root });
  const evidenceEligibility = {
    resolve: async ({
      workspaceKey: requestedWorkspaceKey,
      evidenceIds,
    }: { workspaceKey: string; evidenceIds: readonly string[] }) =>
      evidenceIds.map((evidenceId) => ({
        evidenceId,
        workspaceKey: requestedWorkspaceKey,
        status: statuses.get(evidenceId) ?? "revoked",
        unresolvedHighRisk: false,
      })),
  };
  const capture = createLm1CaptureService({
    store,
    redaction: {
      version: "redaction-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
    },
    evidenceBinding: {
      verify: async ({ evidenceIds }) => ({
        evidence: evidenceIds.map((evidenceId) => ({ evidenceId, evidenceDigest: "a".repeat(64) })),
      }),
    },
    evidenceEligibility,
    clock: { now: () => "2026-07-20T00:00:03.000Z" },
  });
  return { capture, recall: createLm1RecallService({ store, evidenceEligibility }), statuses };
}

function snapshotInput(overrides?: Record<string, unknown>) {
  return {
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt: "2026-07-20T00:00:00.000Z",
    text: "Billing status is paid.",
    action: null,
    evidenceIds: [firstEvidenceId],
    stateKey: "billing.status",
    representation: "value" as const,
    supersedesSnapshotId: null,
    ...overrides,
  };
}

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;
}

function snapshotRecord(input: {
  id: string;
  stateKey: string;
  observedAt?: string;
  recordedAt?: string;
  text: string;
  evidenceIds?: readonly string[];
  supersedesSnapshotId?: string | null;
}): Extract<Lm1Record, { kind: "state_snapshot" }> {
  const evidenceIds = input.evidenceIds ?? [firstEvidenceId];
  return lm1RecordSchema.parse({
    schemaVersion: 1,
    id: input.id,
    sourceDigest: "a".repeat(64),
    canonicalCaptureDigest: "a".repeat(64),
    evidenceBindingDigest: "b".repeat(64),
    recordedAt: input.recordedAt ?? "2026-07-20T00:00:02.000Z",
    evidenceDigests: evidenceIds.map(() => "c".repeat(64)),
    status: "recorded",
    workspaceKey,
    kind: "state_snapshot",
    observedAt: input.observedAt ?? "2026-07-20T00:00:00.000Z",
    text: input.text,
    action: null,
    evidenceIds,
    stateKey: input.stateKey,
    representation: "value",
    supersedesSnapshotId: input.supersedesSnapshotId ?? null,
    redactionVersion: "redaction-v1",
  });
}

function transitionRecord(input: {
  id: string;
  text: string;
  preSnapshotId: string;
  postSnapshotId: string;
  evidenceIds: readonly string[];
}): Extract<Lm1Record, { kind: "state_transition" }> {
  return lm1RecordSchema.parse({
    schemaVersion: 1,
    id: input.id,
    sourceDigest: "d".repeat(64),
    canonicalCaptureDigest: "d".repeat(64),
    evidenceBindingDigest: "e".repeat(64),
    recordedAt: "2026-07-20T00:00:03.000Z",
    evidenceDigests: input.evidenceIds.map(() => "f".repeat(64)),
    status: "recorded",
    workspaceKey,
    kind: "state_transition",
    observedAt: "2026-07-20T00:00:02.000Z",
    text: input.text,
    action: "complete checkout",
    evidenceIds: input.evidenceIds,
    preSnapshotId: input.preSnapshotId,
    postSnapshotId: input.postSnapshotId,
    outcome: "applied",
    redactionVersion: "redaction-v1",
  });
}

function recallFromRecords(
  records: readonly Lm1Record[],
  statuses = new Map<string, "available" | "retained_metadata_only" | "revoked">(),
  closedSnapshotIds: readonly string[] = [],
) {
  const store = {
    list: () => records,
    closureSuccessorIds: () => ({
      successorIdsBySnapshotId: new Map<string, readonly string[]>(),
      incompletePredecessorSnapshotIds: new Set<string>(),
    }),
    stateSnapshotsForStateKeys: (_workspaceKey: string, stateKeys: readonly string[]) => ({
      snapshotsByStateKey: new Map(
        stateKeys.map((stateKey) => [
          stateKey,
          records.filter(
            (record): record is Extract<Lm1Record, { kind: "state_snapshot" }> =>
              record.kind === "state_snapshot" && record.stateKey === stateKey,
          ),
        ]),
      ),
      indexedStateKeys: new Set(
        stateKeys.filter(
          (stateKey) =>
            !records.some(
              (record) =>
                record.kind === "state_snapshot" &&
                record.stateKey === stateKey &&
                closedSnapshotIds.includes(record.id),
            ),
        ),
      ),
      incompleteStateKeys: new Set<string>(),
    }),
  } as FileLm1Store;
  const evidenceEligibility = {
    resolve: async ({
      workspaceKey: requestedWorkspaceKey,
      evidenceIds,
    }: { workspaceKey: string; evidenceIds: readonly string[] }) =>
      evidenceIds.map((evidenceId) => ({
        evidenceId,
        workspaceKey: requestedWorkspaceKey,
        status: statuses.get(evidenceId) ?? "available",
        unresolvedHighRisk: false,
      })),
  };
  return createLm1RecallService({ store, evidenceEligibility });
}

async function captureSnapshot(
  capture: ReturnType<typeof createServices>["capture"],
  overrides?: Record<string, unknown>,
) {
  const prepared = capture.prepare(snapshotInput(overrides) as ReturnType<typeof snapshotInput>);
  return (await capture.capturePrepared({ prepared, authorization: "signed" })).record;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM1 recall", () => {
  it("normalizes hostile public recall-request getters", async () => {
    const { recall } = createServices();

    await expect(
      recall.recall(
        new Proxy(
          {},
          {
            get() {
              throw new Error("hostile recall request");
            },
          },
        ) as never,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects unexpected fields at the recall boundary", async () => {
    const { recall } = createServices();

    await expect(
      recall.recall({
        workspaceKey,
        task: "billing state",
        tokenBudget: 20,
        untrustedField: true,
      } as unknown as Parameters<typeof recall.recall>[0]),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("returns the eligible correcting state with a selected receipt", async () => {
    const { capture, recall } = createServices();
    const paid = await captureSnapshot(capture);
    const pending = await captureSnapshot(capture, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
      supersedesSnapshotId: paid.id,
    });

    await expect(
      recall.recall({ workspaceKey, task: "What is the billing status?", tokenBudget: 20 }),
    ).resolves.toMatchObject({
      items: [{ observationId: pending.id, value: "Billing status is pending." }],
      receipt: { selected: [{ id: pending.id }], scannedRecordCount: 2 },
    });
  });

  it("uses a superseded lexical snapshot to retrieve its current state", async () => {
    const { capture, recall } = createServices();
    const paid = await captureSnapshot(capture, { text: "Billing status is paid." });
    const settled = await captureSnapshot(capture, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "The account has been reconciled.",
      supersedesSnapshotId: paid.id,
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({ items: [{ observationId: settled.id }] });
  });

  it("chooses the latest independent structural leaf for one state key", async () => {
    const { capture, recall } = createServices();
    await captureSnapshot(capture);
    const latest = await captureSnapshot(capture, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
    });

    await expect(
      recall.recall({ workspaceKey, task: "What is the billing status?", tokenBudget: 20 }),
    ).resolves.toMatchObject({
      items: [{ observationId: latest.id, value: "Billing status is pending." }],
    });
  });

  it("uses an older eligible independent leaf when the newest leaf is revoked", async () => {
    const { capture, recall, statuses } = createServices();
    const paid = await captureSnapshot(capture);
    await captureSnapshot(capture, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
      evidenceIds: [secondEvidenceId],
    });
    statuses.set(secondEvidenceId, "revoked");

    await expect(
      recall.recall({ workspaceKey, task: "What is the billing status?", tokenBudget: 20 }),
    ).resolves.toMatchObject({
      items: [{ observationId: paid.id, value: "Billing status is paid." }],
    });
  });

  it("returns the current leaf when only an older independent leaf matches lexically", async () => {
    const older = snapshotRecord({
      id: uuid(1_101),
      stateKey: "billing.status",
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "Billing status is paid.",
    });
    const current = snapshotRecord({
      id: uuid(1_102),
      stateKey: "billing.status",
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "The account balance has been reconciled.",
    });
    const recall = recallFromRecords([older, current]);

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({ items: [{ observationId: current.id }] });
  });

  it("retains the current state winner when its lexical leaf is beyond the candidate cap", async () => {
    const records = Array.from({ length: 1_001 }, (_, index) =>
      snapshotRecord({
        id: uuid(index + 20_000),
        stateKey: "billing.status",
        text: "billing status is current",
        recordedAt: index === 1_000 ? "2026-07-20T00:00:03.000Z" : "2026-07-20T00:00:02.000Z",
      }),
    );
    const winner = records[1_000];
    if (winner === undefined) throw new Error("Expected a current-state winner.");
    const recall = recallFromRecords(records);

    const result = await recall.recall({
      workspaceKey,
      task: "billing status",
      tokenBudget: 100,
    });

    expect(result.receipt.candidateCount).toBe(1_000);
    expect(result.items).toEqual([expect.objectContaining({ observationId: winner.id })]);
  });

  it("does not fall back to an older state when verifying newer leaves exhausts the evidence cap", async () => {
    const records = Array.from({ length: 9 }, (_, recordIndex) =>
      snapshotRecord({
        id: uuid(recordIndex + 22_000),
        stateKey: "billing.status",
        observedAt: `2026-07-20T00:00:0${recordIndex}.000Z`,
        text: "billing status is current",
        evidenceIds: Array.from({ length: 64 }, (_, evidenceIndex) =>
          uuid(40_000 + recordIndex * 64 + evidenceIndex),
        ),
      }),
    );
    const statuses = new Map(
      records
        .slice(1)
        .flatMap((record) =>
          record.evidenceIds.map((evidenceId) => [evidenceId, "revoked"] as const),
        ),
    );
    const anchor = records[8];
    if (anchor === undefined) throw new Error("Expected a lexical state anchor.");
    const recall = recallFromRecords(records, statuses);

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        evidenceLookupCount: 512,
        omitted: [{ id: anchor.id, reason: "omitted_evidence_limit" }],
      },
    });
  });

  it("omits a scanned snapshot closed by a correction outside the scan window", async () => {
    const predecessor = snapshotRecord({
      id: uuid(1_201),
      stateKey: "billing.status",
      text: "Billing status is paid.",
    });
    const recall = recallFromRecords([predecessor], undefined, [predecessor.id]);

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: predecessor.id, reason: "omitted_correction_chain_unavailable" }],
      },
    });
  });

  it("omits a pointer-expanded branch when its next correction only has a closure marker", async () => {
    const inWindow = snapshotRecord({
      id: uuid(1_301),
      stateKey: "billing.status",
      text: "Billing status is paid.",
    });
    const expanded = snapshotRecord({
      id: uuid(1_302),
      stateKey: "billing.status",
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is completed.",
      supersedesSnapshotId: inWindow.id,
    });
    const interruptedSuccessorId = uuid(1_303);
    const store = {
      list: () => [inWindow],
      closureSuccessorIds: (_workspaceKey: string, snapshotIds: readonly string[]) =>
        snapshotIds.includes(expanded.id)
          ? {
              successorIdsBySnapshotId: new Map([[expanded.id, [interruptedSuccessorId]]]),
              incompletePredecessorSnapshotIds: new Set<string>(),
            }
          : {
              successorIdsBySnapshotId: new Map<string, readonly string[]>(),
              incompletePredecessorSnapshotIds: new Set<string>(),
            },
      stateSnapshotsForStateKeys: () => ({
        snapshotsByStateKey: new Map([[inWindow.stateKey, [inWindow, expanded]]]),
        indexedStateKeys: new Set([inWindow.stateKey]),
        incompleteStateKeys: new Set<string>(),
      }),
    } as FileLm1Store;
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
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: inWindow.id, reason: "omitted_correction_chain_unavailable" }],
      },
    });
  });

  it("omits a state group when its correction-closure read budget is exhausted", async () => {
    const record = snapshotRecord({
      id: uuid(1_304),
      stateKey: "billing.status",
      text: "Billing status is paid.",
    });
    const store = {
      list: () => [record],
      closureSuccessorIds: () => ({
        successorIdsBySnapshotId: new Map<string, readonly string[]>(),
        incompletePredecessorSnapshotIds: new Set([record.id]),
      }),
      stateSnapshotsForStateKeys: () => ({
        snapshotsByStateKey: new Map([[record.stateKey, [record]]]),
        indexedStateKeys: new Set([record.stateKey]),
        incompleteStateKeys: new Set<string>(),
      }),
    } as FileLm1Store;
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
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: record.id, reason: "omitted_correction_chain_unavailable" }],
      },
    });
  });

  it("does not reactivate a superseded state when its correction is revoked", async () => {
    const { capture, recall, statuses } = createServices();
    const paid = await captureSnapshot(capture);
    const pending = await captureSnapshot(capture, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
      supersedesSnapshotId: paid.id,
    });
    statuses.set(firstEvidenceId, "revoked");

    await expect(
      recall.recall({ workspaceKey, task: "What is the billing status?", tokenBudget: 20 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: pending.id, reason: "omitted_correction_chain_unavailable" }],
      },
    });
  });

  it("omits a matching record that cannot fit the token budget", async () => {
    const { capture, recall } = createServices();
    const oversized = await captureSnapshot(capture, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "billing ".repeat(20),
      evidenceIds: [secondEvidenceId],
      stateKey: "billing.notes",
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing", tokenBudget: 1 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: { omitted: [{ id: oversized.id, reason: "omitted_budget" }] },
    });
  });

  it("caps lexical candidates at one thousand records", async () => {
    const records = Array.from({ length: 1_001 }, (_, index) =>
      snapshotRecord({
        id: uuid(index + 10),
        stateKey: `billing.status.${index}`,
        text: "billing status is current",
      }),
    );
    const recall = recallFromRecords(records);

    const result = await recall.recall({
      workspaceKey,
      task: "billing status",
      tokenBudget: 100_000,
    });

    expect(result.receipt.candidateCount).toBe(1_000);
    expect(result.receipt.selected).toHaveLength(1_000);
  });

  it("uses LM1 timestamp and identifier ties before enforcing the candidate cap", async () => {
    const pre = snapshotRecord({
      id: uuid(6_001),
      stateKey: "workflow.status",
      text: "The workflow started.",
    });
    const post = snapshotRecord({
      id: uuid(6_002),
      stateKey: "workflow.status",
      text: "The workflow ended.",
    });
    const transitions = Array.from({ length: 1_000 }, (_, index) =>
      transitionRecord({
        id: uuid(7_000 + index),
        text: "Workflow changed state.",
        preSnapshotId: pre.id,
        postSnapshotId: post.id,
        evidenceIds: [firstEvidenceId],
      }),
    );
    const expectedWinner = transitionRecord({
      id: uuid(5),
      text: "Workflow changed state.",
      preSnapshotId: pre.id,
      postSnapshotId: post.id,
      evidenceIds: [firstEvidenceId],
    });
    const recall = recallFromRecords([pre, post, ...transitions, expectedWinner]);

    const result = await recall.recall({
      workspaceKey,
      task: "workflow changed",
      tokenBudget: 100_000,
    });

    expect(result.receipt.candidateCount).toBe(1_000);
    expect(result.items).toContainEqual(
      expect.objectContaining({ observationId: expectedWinner.id }),
    );
  });

  it("omits a matching record that would exceed the evidence lookup cap", async () => {
    const records = Array.from({ length: 9 }, (_, recordIndex) =>
      snapshotRecord({
        id: uuid(recordIndex + 2_000),
        stateKey: `billing.status.${recordIndex}`,
        text: "billing status is current",
        evidenceIds: Array.from({ length: 64 }, (_, evidenceIndex) =>
          uuid(10_000 + recordIndex * 64 + evidenceIndex),
        ),
      }),
    );
    const recall = recallFromRecords(records);

    const result = await recall.recall({
      workspaceKey,
      task: "billing status",
      tokenBudget: 100_000,
    });

    expect(result.items).toHaveLength(8);
    expect(result.receipt).toMatchObject({
      evidenceLookupCount: 512,
      omitted: [{ id: records[8]?.id, reason: "omitted_evidence_limit" }],
    });
  });

  it("requires eligible transition endpoints", async () => {
    const preEvidenceId = uuid(30_001);
    const postEvidenceId = uuid(30_002);
    const transitionEvidenceId = uuid(30_003);
    const pre = snapshotRecord({
      id: uuid(3_001),
      stateKey: "checkout.status",
      text: "The checkout was initiated.",
      evidenceIds: [preEvidenceId],
    });
    const post = snapshotRecord({
      id: uuid(3_002),
      stateKey: "checkout.status",
      text: "The checkout result was saved.",
      evidenceIds: [postEvidenceId],
    });
    const transition = transitionRecord({
      id: uuid(3_003),
      text: "Checkout completed successfully.",
      preSnapshotId: pre.id,
      postSnapshotId: post.id,
      evidenceIds: [transitionEvidenceId],
    });
    const recall = recallFromRecords(
      [pre, post, transition],
      new Map([[postEvidenceId, "revoked"]]),
    );

    await expect(
      recall.recall({ workspaceKey, task: "successfully", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [],
      receipt: {
        omitted: [{ id: transition.id, reason: "omitted_evidence_unavailable" }],
      },
    });
  });

  it("orders equal-score states by observed time and then identifier", async () => {
    const older = snapshotRecord({
      id: uuid(4_001),
      stateKey: "billing.first",
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "billing status is current",
    });
    const newer = snapshotRecord({
      id: uuid(4_002),
      stateKey: "billing.second",
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "billing status is current",
    });
    const recall = recallFromRecords([older, newer]);

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [{ observationId: newer.id }, { observationId: older.id }],
    });
  });

  it("fails closed when the evidence eligibility port throws", async () => {
    const record = snapshotRecord({
      id: uuid(9_001),
      stateKey: "billing.status",
      text: "billing status is current",
    });
    const store = {
      list: () => [record],
      closureSuccessorIds: () => ({
        successorIdsBySnapshotId: new Map<string, readonly string[]>(),
        incompletePredecessorSnapshotIds: new Set<string>(),
      }),
      stateSnapshotsForStateKeys: () => ({
        snapshotsByStateKey: new Map([[record.stateKey, [record]]]),
        indexedStateKeys: new Set([record.stateKey]),
        incompleteStateKeys: new Set<string>(),
      }),
    } as FileLm1Store;
    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async () => {
          throw new Error("public evidence adapter unavailable");
        },
      },
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("normalizes a typed evidence eligibility failure to a closed error", async () => {
    const record = snapshotRecord({
      id: uuid(9_002),
      stateKey: "billing.status",
      text: "billing status is current",
    });
    const store = {
      list: () => [record],
      closureSuccessorIds: () => ({
        successorIdsBySnapshotId: new Map<string, readonly string[]>(),
        incompletePredecessorSnapshotIds: new Set<string>(),
      }),
      stateSnapshotsForStateKeys: () => ({
        snapshotsByStateKey: new Map([[record.stateKey, [record]]]),
        indexedStateKeys: new Set([record.stateKey]),
        incompleteStateKeys: new Set<string>(),
      }),
    } as FileLm1Store;
    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async () => {
          throw new Lm1Error("invalid_transition", "adapter-controlled error");
        },
      },
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("normalizes an evidence eligibility response getter to a closed error", async () => {
    const record = snapshotRecord({
      id: uuid(9_003),
      stateKey: "billing.status",
      text: "billing status is current",
    });
    const store = {
      list: () => [record],
      closureSuccessorIds: () => ({
        successorIdsBySnapshotId: new Map<string, readonly string[]>(),
        incompletePredecessorSnapshotIds: new Set<string>(),
      }),
      stateSnapshotsForStateKeys: () => ({
        snapshotsByStateKey: new Map([[record.stateKey, [record]]]),
        indexedStateKeys: new Set([record.stateKey]),
        incompleteStateKeys: new Set<string>(),
      }),
    } as FileLm1Store;
    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async () =>
          new Proxy([], {
            get() {
              throw new Lm1Error("invalid_transition", "adapter-controlled error");
            },
          }) as never,
      },
    });

    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });
});
