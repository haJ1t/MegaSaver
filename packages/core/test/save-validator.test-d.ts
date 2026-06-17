import { describe, expectTypeOf, it } from "vitest";
import * as core from "../src/index.js";
import type { ConflictResult, ValidateSaveResult, ValidationStatus } from "../src/index.js";

describe("reliable-save public type surface", () => {
  it("validateSave is a function", () => {
    expectTypeOf(core.validateSave).toBeFunction();
  });
  it("checkConflicts is a function", () => {
    expectTypeOf(core.checkConflicts).toBeFunction();
  });
  it("validationStatusSchema is exported", () => {
    expectTypeOf(core.validationStatusSchema).not.toBeNever();
  });
  it("ValidateSaveResult has status", () => {
    expectTypeOf<ValidateSaveResult>().toHaveProperty("status");
  });
  it("ConflictResult has outcome", () => {
    expectTypeOf<ConflictResult>().toHaveProperty("outcome");
  });
  it("ValidationStatus union is correct", () => {
    expectTypeOf<ValidationStatus>().toEqualTypeOf<"unvalidated" | "valid" | "needs_approval" | "quarantined" | "rejected">();
  });
});
