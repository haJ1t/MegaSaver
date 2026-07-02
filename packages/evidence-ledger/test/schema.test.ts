import { randomUUID } from "node:crypto";
import { memoryEntryIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type EvidenceRecord, evidenceRecordSchema } from "../src/schema.js";
import {
  isScrubbedSourceRef,
  redactionReportSchema,
  returnedChunkRefSchema,
  scrubSourceRef,
  sessionRefSchema,
  sourceRefSchema,
  transitionSchema,
} from "../src/sub-schemas.js";

function validRecord(over: Partial<EvidenceRecord> = {}): unknown {
  return {
    evidenceId: randomUUID(),
    workspaceKey: "0123456789abcdef",
    sessionRef: { kind: "durable", id: "s-1" },
    sourceKind: "command",
    sourceRef: { command: "git", args: ["log", "-p"] },
    classification: "generic_shell",
    redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
    rawDigest: "a".repeat(64),
    returnedDigest: "b".repeat(64),
    redactedRawChunkSetId: "cs-1",
    returnedChunkRefs: [{ chunkSetId: "cs-1", chunkId: "0" }],
    createdAt: "2026-06-16T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    pinnedByMemoryIds: [],
    status: "available",
    revokedAt: null,
    revocationReason: null,
    policyVersion: "1",
    pipelineVersion: "1",
    transitions: [{ at: "2026-06-16T12:00:00.000Z", kind: "created", actor: "system" }],
    ...over,
  };
}

describe("evidence-ledger sub-schemas", () => {
  it("sourceRef accepts a partial structured label and rejects unknown keys", () => {
    expect(sourceRefSchema.safeParse({ path: "src/a.ts" }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ command: "git", args: ["log"] }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ hookTool: "Bash" }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("scrubSourceRef emits a fixed constant carrying only a non-reversible label", () => {
    const scrubbed = scrubSourceRef();
    expect(scrubbed).toEqual({ label: "redacted" });
    expect(isScrubbedSourceRef(scrubbed)).toBe(true);
  });

  it("isScrubbedSourceRef rejects a ref that still carries secret-bearing fields", () => {
    expect(isScrubbedSourceRef({ command: "git log" })).toBe(false);
    expect(isScrubbedSourceRef({ url: "https://x" })).toBe(false);
    expect(isScrubbedSourceRef({ label: "ok" })).toBe(true);
    expect(isScrubbedSourceRef({})).toBe(true);
  });

  it("sessionRef is a kind+id pair or null", () => {
    expect(sessionRefSchema.safeParse(null).success).toBe(true);
    expect(sessionRefSchema.safeParse({ kind: "durable", id: "s-1" }).success).toBe(true);
    expect(sessionRefSchema.safeParse({ kind: "other", id: "x" }).success).toBe(false);
    expect(sessionRefSchema.safeParse({ kind: "live", id: "" }).success).toBe(false);
  });

  it("redactionReport tracks unresolved high-risk findings", () => {
    expect(
      redactionReportSchema.safeParse({
        redacted: true,
        highRiskFindings: 0,
        unresolvedHighRisk: false,
      }).success,
    ).toBe(true);
    expect(
      redactionReportSchema.safeParse({
        redacted: true,
        highRiskFindings: -1,
        unresolvedHighRisk: false,
      }).success,
    ).toBe(false);
  });

  it("returnedChunkRef requires both ids", () => {
    expect(returnedChunkRefSchema.safeParse({ chunkSetId: "cs-1", chunkId: "0" }).success).toBe(
      true,
    );
    expect(returnedChunkRefSchema.safeParse({ chunkSetId: "cs-1" }).success).toBe(false);
  });

  it("transition records an auditable event with an optional memoryId", () => {
    expect(
      transitionSchema.safeParse({
        at: "2026-06-16T12:00:00.000Z",
        kind: "created",
        actor: "system",
      }).success,
    ).toBe(true);
    expect(
      transitionSchema.safeParse({
        at: "2026-06-16T12:00:00.000Z",
        kind: "pinned",
        actor: "system",
        memoryId: "00000000-0000-4000-8000-0000000000a1",
      }).success,
    ).toBe(true);
    expect(transitionSchema.safeParse({ at: "not-a-date", kind: "created" }).success).toBe(false);
  });
});

describe("evidenceRecordSchema", () => {
  it("parses a well-formed available record", () => {
    expect(() => evidenceRecordSchema.parse(validRecord())).not.toThrow();
  });

  it("rejects unknown keys (.strict)", () => {
    expect(evidenceRecordSchema.safeParse({ ...(validRecord() as object), x: 1 }).success).toBe(
      false,
    );
  });

  it("rejects an uppercase evidenceId (lowercase-uuid contract)", () => {
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ evidenceId: randomUUID().toUpperCase() as never }),
      ).success,
    ).toBe(false);
  });

  it("rejects a non-hex rawDigest", () => {
    expect(evidenceRecordSchema.safeParse(validRecord({ rawDigest: "xyz" as never })).success).toBe(
      false,
    );
  });

  it("INVARIANT available => redactedRawChunkSetId present + digests present", () => {
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ status: "available", redactedRawChunkSetId: null }),
      ).success,
    ).toBe(false);
    expect(
      evidenceRecordSchema.safeParse(validRecord({ status: "available", rawDigest: null as never }))
        .success,
    ).toBe(false);
  });

  it("INVARIANT retained_metadata_only => no raw chunk", () => {
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ status: "retained_metadata_only", redactedRawChunkSetId: null }),
      ).success,
    ).toBe(true);
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ status: "retained_metadata_only", redactedRawChunkSetId: "cs-1" }),
      ).success,
    ).toBe(false);
  });

  it("INVARIANT revoked => revokedAt + reason set, digests null, chunk null, sourceRef scrubbed, no pins", () => {
    const revoked = validRecord({
      status: "revoked",
      revokedAt: "2026-06-16T13:00:00.000Z",
      revocationReason: "secret_false_negative",
      rawDigest: null as never,
      returnedDigest: null as never,
      redactedRawChunkSetId: null,
      sourceRef: { label: "redacted" },
      pinnedByMemoryIds: [],
      retentionClass: "session",
    });
    expect(evidenceRecordSchema.safeParse(revoked).success).toBe(true);
    // revoked but sourceRef still carries a command → reject
    expect(
      evidenceRecordSchema.safeParse({
        ...(revoked as object),
        sourceRef: { command: "git log" },
      }).success,
    ).toBe(false);
    // revoked but rawDigest not nulled → reject
    expect(
      evidenceRecordSchema.safeParse({ ...(revoked as object), rawDigest: "a".repeat(64) }).success,
    ).toBe(false);
    // non-revoked but revocationReason set → reject
    expect(
      evidenceRecordSchema.safeParse(validRecord({ revocationReason: "policy_change" as never }))
        .success,
    ).toBe(false);
  });

  it("INVARIANT pinned => status available AND pinnedByMemoryIds non-empty", () => {
    const MEM = memoryEntryIdSchema.parse("00000000-0000-4000-8000-0000000000a1");
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ retentionClass: "pinned", pinnedByMemoryIds: [MEM] }),
      ).success,
    ).toBe(true);
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({ retentionClass: "pinned", pinnedByMemoryIds: [] }),
      ).success,
    ).toBe(false);
    expect(
      evidenceRecordSchema.safeParse(
        validRecord({
          retentionClass: "pinned",
          pinnedByMemoryIds: [MEM],
          status: "retained_metadata_only",
          redactedRawChunkSetId: null,
        }),
      ).success,
    ).toBe(false);
  });
});
