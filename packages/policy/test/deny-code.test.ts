import { describe, expect, it } from "vitest";
import { policyDenyCodeSchema } from "../src/deny-code.js";

describe("policyDenyCodeSchema", () => {
  it("parses each of the 7 locked members", () => {
    for (const member of [
      "command_not_allowed",
      "dangerous_pattern",
      "intent_missing",
      "path_denied",
      "policy_load_failed",
      "recursive_megasaver",
      "secret_path_read",
    ]) {
      expect(policyDenyCodeSchema.parse(member)).toBe(member);
    }
  });

  it("rejects an unknown deny-code literal", () => {
    expect(policyDenyCodeSchema.safeParse("yolo").success).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(policyDenyCodeSchema.safeParse("").success).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(policyDenyCodeSchema.safeParse(42).success).toBe(false);
  });

  it("exposes options in AA3 alphabetic order (drift guard)", () => {
    expect(policyDenyCodeSchema.options).toEqual([
      "command_not_allowed",
      "dangerous_pattern",
      "intent_missing",
      "path_denied",
      "policy_load_failed",
      "recursive_megasaver",
      "secret_path_read",
    ]);
  });
});
