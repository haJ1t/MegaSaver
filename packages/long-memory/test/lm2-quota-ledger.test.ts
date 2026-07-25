import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LM2_PENDING_SIDECAR_RESERVATION_BYTES,
  lm2QuotaLedgerSchema,
  recordIdentityDigest,
  serializeLm2QuotaLedger,
} from "../src/lm2-quota-ledger.js";

const workspaceKey = "0123456789abcdef";
const epoch = "a".repeat(64);
const operationId = "11111111-1111-4111-8111-111111111111";
const modelFingerprint = "b".repeat(64);

function identity(index: number): string {
  return recordIdentityDigest({
    workspaceKey,
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    kind: "state_snapshot",
    sourceDigest: "c".repeat(64),
    embeddingInputDigest: "d".repeat(64),
    modelFingerprint,
  });
}

function pendingEntry(allocationSequence: number) {
  const recordId = `00000000-0000-4000-8000-${allocationSequence.toString(16).padStart(12, "0")}`;
  return {
    allocationSequence,
    modelFingerprint,
    recordId,
    recordIdentityDigest: identity(allocationSequence),
    reservedBytes: LM2_PENDING_SIDECAR_RESERVATION_BYTES,
    expectedSidecarDigest: null,
    serializedBytes: null,
    temporaryName: `.lm2-${operationId}-${allocationSequence}.pending`,
    finalName: `${recordId}.json`,
    phase: "reserved" as const,
  };
}

function validLedger() {
  return {
    schemaVersion: 1 as const,
    workspaceKey,
    epoch,
    lockIdentity: { device: 10, inode: 20 },
    lockToken: "e".repeat(64),
    generation: 7,
    namespaces: [{ modelFingerprint, sidecarCount: 3, serializedBytes: 4_096 }],
    committedThroughAllocation: 3,
    nextAllocationSequence: 4,
    activeOperation: {
      operationId,
      expectedGeneration: 7,
      lockIdentity: { device: 10, inode: 20 },
      lockToken: "e".repeat(64),
    },
    pending: {
      operationId,
      expectedGeneration: 7,
      firstAllocationSequence: 4,
      lastAllocationSequence: 5,
      entries: [pendingEntry(4), pendingEntry(5)],
    },
  };
}

describe("LM2 quota ledger contract", () => {
  it("accepts one canonical pending allocation range", () => {
    expect(lm2QuotaLedgerSchema.parse(validLedger())).toEqual(validLedger());
  });

  it("rejects a sequence hole, a third namespace, or unsafe counters", () => {
    const withGap = validLedger();
    withGap.pending.entries[1] = pendingEntry(6);
    const withThirdNamespace = validLedger();
    withThirdNamespace.namespaces = [
      ...withThirdNamespace.namespaces,
      { modelFingerprint: "c".repeat(64), sidecarCount: 1, serializedBytes: 1 },
      { modelFingerprint: "d".repeat(64), sidecarCount: 1, serializedBytes: 1 },
    ];

    expect(() => lm2QuotaLedgerSchema.parse(withGap)).toThrow();
    expect(() => lm2QuotaLedgerSchema.parse(withThirdNamespace)).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({ ...validLedger(), generation: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() => lm2QuotaLedgerSchema.parse({ ...validLedger(), generation: -0 })).toThrow();
  });

  it("omits empty namespaces and requires fingerprint sorting", () => {
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...validLedger(),
        namespaces: [{ modelFingerprint, sidecarCount: 0, serializedBytes: 0 }],
      }),
    ).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...validLedger(),
        namespaces: [
          { modelFingerprint: "c".repeat(64), sidecarCount: 1, serializedBytes: 1 },
          { modelFingerprint: "b".repeat(64), sidecarCount: 1, serializedBytes: 1 },
        ],
      }),
    ).toThrow();
  });

  it("requires the exact pending range and active operation fence", () => {
    const ledger = validLedger();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: { ...ledger.pending, firstAllocationSequence: 5 },
      }),
    ).toThrow();
    expect(() => lm2QuotaLedgerSchema.parse({ ...ledger, activeOperation: null })).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        activeOperation: { ...ledger.activeOperation, expectedGeneration: 6 },
      }),
    ).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: null,
        activeOperation: { ...ledger.activeOperation, expectedGeneration: 6 },
      }),
    ).toThrow();
  });

  it("persists one permanent lock fence across inactive generations", () => {
    const inactive = { ...validLedger(), activeOperation: null, pending: null };
    expect(lm2QuotaLedgerSchema.parse(inactive)).toEqual(inactive);
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...validLedger(),
        activeOperation: {
          ...validLedger().activeOperation,
          lockIdentity: { device: 10, inode: 21 },
        },
      }),
    ).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...validLedger(),
        activeOperation: { ...validLedger().activeOperation, lockToken: "f".repeat(64) },
      }),
    ).toThrow();
  });

  it("requires paired materialization fields and unique pending identities", () => {
    const ledger = validLedger();
    const duplicate = pendingEntry(5);
    duplicate.recordIdentityDigest = ledger.pending.entries[0]?.recordIdentityDigest ?? "";
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: { ...ledger.pending, entries: [pendingEntry(4), duplicate] },
      }),
    ).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: {
          ...ledger.pending,
          entries: [
            {
              ...pendingEntry(4),
              expectedSidecarDigest: "f".repeat(64),
              serializedBytes: null,
            },
            pendingEntry(5),
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: {
          ...ledger.pending,
          entries: [
            pendingEntry(4),
            {
              ...pendingEntry(5),
              recordId: pendingEntry(4).recordId,
              recordIdentityDigest: "f".repeat(64),
              finalName: pendingEntry(4).finalName,
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("requires the next sequence to be the contiguous committed successor", () => {
    const withoutPending = { ...validLedger(), activeOperation: null, pending: null };
    expect(lm2QuotaLedgerSchema.parse(withoutPending)).toEqual(withoutPending);
    expect(() =>
      lm2QuotaLedgerSchema.parse({ ...withoutPending, nextAllocationSequence: 5 }),
    ).toThrow();
  });

  it("ties the committed watermark to exact allocated namespace counts", () => {
    const ledger = validLedger();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        committedThroughAllocation: 4,
        nextAllocationSequence: 5,
        activeOperation: { ...ledger.activeOperation, expectedGeneration: 7 },
        pending: null,
      }),
    ).toThrow();
  });

  it("rejects aggregate workspace bytes over quota without a pending transaction", () => {
    const ledger = validLedger();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        namespaces: [
          {
            modelFingerprint: "a".repeat(64),
            sidecarCount: 1,
            serializedBytes: 64 * 1024 * 1024 + 1,
          },
          {
            modelFingerprint: "b".repeat(64),
            sidecarCount: 1,
            serializedBytes: 64 * 1024 * 1024 + 1,
          },
        ],
        committedThroughAllocation: 2,
        nextAllocationSequence: 3,
        activeOperation: null,
        pending: null,
      }),
    ).toThrow();
  });

  it("rejects unsafe and reused pending temporary names", () => {
    const ledger = validLedger();
    for (const temporaryName of [".", "..", pendingEntry(4).finalName]) {
      expect(() =>
        lm2QuotaLedgerSchema.parse({
          ...ledger,
          pending: {
            ...ledger.pending,
            entries: [{ ...pendingEntry(4), temporaryName }, pendingEntry(5)],
          },
        }),
      ).toThrow();
    }
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: {
          ...ledger.pending,
          entries: [
            pendingEntry(4),
            { ...pendingEntry(5), temporaryName: pendingEntry(4).temporaryName },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: {
          ...ledger.pending,
          entries: [
            pendingEntry(4),
            { ...pendingEntry(5), temporaryName: pendingEntry(4).finalName },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects a pending temporary name aimed at a committed sidecar", () => {
    const ledger = validLedger();
    expect(() =>
      lm2QuotaLedgerSchema.parse({
        ...ledger,
        pending: {
          ...ledger.pending,
          entries: [
            { ...pendingEntry(4), temporaryName: pendingEntry(3).finalName },
            pendingEntry(5),
          ],
        },
      }),
    ).toThrow();
  });

  it("serializes fields in canonical order", () => {
    const serialized = serializeLm2QuotaLedger(validLedger());
    expect(Object.keys(JSON.parse(serialized))).toEqual([
      "schemaVersion",
      "workspaceKey",
      "epoch",
      "lockIdentity",
      "lockToken",
      "generation",
      "namespaces",
      "committedThroughAllocation",
      "nextAllocationSequence",
      "activeOperation",
      "pending",
    ]);
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("uses a domain-separated canonical record identity", () => {
    const input = {
      workspaceKey,
      id: "00000000-0000-4000-8000-000000000001",
      kind: "state_snapshot" as const,
      sourceDigest: "c".repeat(64),
      embeddingInputDigest: "d".repeat(64),
      modelFingerprint,
    };
    const expected = createHash("sha256")
      .update(`megasaver.long-memory.lm2.record-identity.v1\0${JSON.stringify(input)}`, "utf8")
      .digest("hex");

    expect(recordIdentityDigest(input)).toBe(expected);
    expect(recordIdentityDigest(input)).not.toBe(
      createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex"),
    );
    expect(recordIdentityDigest({ ...input, kind: "state_transition" })).not.toBe(expected);
  });
});
