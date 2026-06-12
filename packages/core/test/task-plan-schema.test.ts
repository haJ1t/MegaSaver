import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";

describe("task ids", () => {
  it("brands a lowercase uuid as TaskPlanId / TaskStepId", () => {
    const planId = taskPlanIdSchema.parse("d0000000-0000-4000-8000-000000000001");
    const stepId = taskStepIdSchema.parse("d0000000-0000-4000-8000-000000000002");
    expect(planId).toBe("d0000000-0000-4000-8000-000000000001");
    expect(stepId).toBe("d0000000-0000-4000-8000-000000000002");
  });
  it("rejects an uppercase uuid", () => {
    expect(() => taskPlanIdSchema.parse("D0000000-0000-4000-8000-000000000001")).toThrow();
  });
});
