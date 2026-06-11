import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 4 registry error codes", () => {
  it("includes the rule + failed-attempt codes", () => {
    for (const code of [
      "project_rule_already_exists",
      "project_rule_not_found",
      "failed_attempt_already_exists",
      "failed_attempt_not_found",
    ]) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
