import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { backfillEvidenceRecord } from "../src/backfill.js";
import { evidenceRecordSchema } from "../src/schema.js";

function preLifecycleRow(): Record<string, unknown> {
  return {
    evidenceId: randomUUID(),
    workspaceKey: "0123456789abcdef",
    sessionRef: null,
    sourceKind: "file",
    sourceRef: { path: "src/a.ts" },
    classification: "file",
    redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
    rawDigest: "a".repeat(64),
    returnedDigest: "b".repeat(64),
    redactedRawChunkSetId: "cs-1",
    returnedChunkRefs: [],
    createdAt: "2026-06-16T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    policyVersion: "1",
    pipelineVersion: "1",
  };
}

describe("backfillEvidenceRecord", () => {
  it("defaults lifecycle fields so a pre-lifecycle row loads as available", () => {
    const upgraded = evidenceRecordSchema.parse(backfillEvidenceRecord(preLifecycleRow()));
    expect(upgraded).toMatchObject({
      status: "available",
      revokedAt: null,
      revocationReason: null,
      pinnedByMemoryIds: [],
    });
    expect(upgraded.transitions[0]).toMatchObject({ kind: "created", actor: "system" });
  });

  it("is idempotent for an already-complete record", () => {
    const full = backfillEvidenceRecord(preLifecycleRow());
    expect(backfillEvidenceRecord(full)).toEqual(full);
  });

  it("passes non-objects through unchanged", () => {
    expect(backfillEvidenceRecord(null)).toBe(null);
    expect(backfillEvidenceRecord(42)).toBe(42);
  });
});
