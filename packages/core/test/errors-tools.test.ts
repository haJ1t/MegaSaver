import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 7 registry error codes", () => {
  it("includes the two tool-definition codes", () => {
    for (const code of ["tool_definition_already_exists", "tool_definition_not_found"] as const) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
