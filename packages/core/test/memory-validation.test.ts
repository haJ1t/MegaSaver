import { describe, expect, it } from "vitest";
import { memoryValidationSchema } from "../src/memory-validation.js";

const ENTRY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TS = "2026-06-17T00:00:00.000Z";

describe("memoryValidationSchema", () => {
  it("round-trips a minimal valid record (system validatedBy)", () => {
    const v = memoryValidationSchema.parse({
      memoryEntryId: ENTRY_ID,
      validationStatus: "valid",
      reasons: [],
      conflictIds: [],
      validatedAt: TS,
      validatedBy: "system",
      policyVersion: "1",
    });
    expect(v.memoryEntryId).toBe(ENTRY_ID);
    expect(v.validationStatus).toBe("valid");
    expect(v.conflictIds).toEqual([]);
  });

  it("round-trips a quarantined record with conflictIds and reasons", () => {
    const CONFLICT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const v = memoryValidationSchema.parse({
      memoryEntryId: ENTRY_ID,
      validationStatus: "quarantined",
      reasons: ["missing_evidence"],
      conflictIds: [CONFLICT_ID],
      validatedAt: TS,
      validatedBy: "system",
      policyVersion: "1",
    });
    expect(v.reasons).toEqual(["missing_evidence"]);
    expect(v.conflictIds).toEqual([CONFLICT_ID]);
  });

  it("rejects extra fields (.strict())", () => {
    expect(
      memoryValidationSchema.safeParse({
        memoryEntryId: ENTRY_ID,
        validationStatus: "valid",
        reasons: [],
        conflictIds: [],
        validatedAt: TS,
        validatedBy: "system",
        policyVersion: "1",
        extraField: true,
      }).success,
    ).toBe(false);
  });

  it("rejects invalid validationStatus", () => {
    expect(
      memoryValidationSchema.safeParse({
        memoryEntryId: ENTRY_ID,
        validationStatus: "approved", // approval lifecycle value, not a ValidationStatus
        reasons: [],
        conflictIds: [],
        validatedAt: TS,
        validatedBy: "system",
        policyVersion: "1",
      }).success,
    ).toBe(false);
  });
});
