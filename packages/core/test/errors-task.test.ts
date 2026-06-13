import { describe, expect, it } from "vitest";
import { coreRegistryErrorCodeSchema } from "../src/errors.js";

describe("phase 6 registry error codes", () => {
  it("includes the six task codes", () => {
    for (const code of [
      "task_plan_already_exists",
      "task_plan_not_found",
      "task_step_not_found",
      "task_step_not_failed",
      "task_step_transition_invalid",
      "task_step_dependency_unmet",
    ] as const) {
      expect(coreRegistryErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
