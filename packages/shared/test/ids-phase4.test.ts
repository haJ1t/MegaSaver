import { describe, expect, it } from "vitest";
import { failedAttemptIdSchema, projectRuleIdSchema } from "../src/ids.js";

const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("phase 4 branded ids", () => {
  it("projectRuleIdSchema accepts a lowercase uuid", () => {
    expect(projectRuleIdSchema.parse(UUID)).toBe(UUID);
  });
  it("failedAttemptIdSchema accepts a lowercase uuid", () => {
    expect(failedAttemptIdSchema.parse(UUID)).toBe(UUID);
  });
  it("rejects an uppercase uuid", () => {
    expect(() => projectRuleIdSchema.parse(UUID.toUpperCase())).toThrow();
    expect(() => failedAttemptIdSchema.parse(UUID.toUpperCase())).toThrow();
  });
});
