import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("core barrel (phase 6)", () => {
  it("re-exports the task-engine surface", () => {
    expect(core.taskPlanSchema).toBeDefined();
    expect(core.taskPlanInputSchema).toBeDefined();
    expect(core.taskStepTypeSchema).toBeDefined();
    expect(core.rollUpPlanStatus).toBeDefined();
    expect(core.applyStepOutcome).toBeDefined();
    expect(core.resetFailedStep).toBeDefined();
    expect(core.readySteps).toBeDefined();
  });
});
