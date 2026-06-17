import { describe, expect, it } from "vitest";
import { validationStatusSchema } from "../src/validation-status.js";

describe("validationStatusSchema", () => {
  it("has the five lifecycle states", () => {
    for (const s of ["unvalidated", "valid", "needs_approval", "quarantined", "rejected"]) {
      expect(validationStatusSchema.safeParse(s).success).toBe(true);
    }
  });
  it("rejects approval-lifecycle values (validation status is distinct)", () => {
    expect(validationStatusSchema.safeParse("approved").success).toBe(false);
    expect(validationStatusSchema.safeParse("suggested").success).toBe(false);
  });
  it("preserves declaration order (AA3: order is a contract)", () => {
    expect(validationStatusSchema.options).toEqual([
      "unvalidated",
      "valid",
      "needs_approval",
      "quarantined",
      "rejected",
    ]);
  });
});
