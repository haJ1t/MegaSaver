import type { TaskStepId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  TaskTransitionError,
  applyStepOutcome,
  readySteps,
  resetFailedStep,
  rollUpPlanStatus,
} from "../src/task-plan-transitions.js";
import type { TaskStep } from "../src/task-plan.js";

const A = "d0000000-0000-4000-8000-00000000000a" as TaskStepId;
const B = "d0000000-0000-4000-8000-00000000000b" as TaskStepId;
const C = "d0000000-0000-4000-8000-00000000000c" as TaskStepId;
const TS = "2026-06-12T01:00:00.000Z";

function s(id: TaskStepId, over: Partial<TaskStep> = {}): TaskStep {
  return {
    id,
    type: "edit",
    title: "t",
    dependsOn: [],
    status: "pending",
    startedAt: null,
    completedAt: null,
    ...over,
  } as TaskStep;
}

describe("rollUpPlanStatus", () => {
  it("failed wins", () => {
    expect(rollUpPlanStatus([s(A, { status: "completed" }), s(B, { status: "failed" })])).toBe(
      "failed",
    );
  });
  it("running when no failure", () => {
    expect(rollUpPlanStatus([s(A, { status: "completed" }), s(B, { status: "running" })])).toBe(
      "running",
    );
  });
  it("completed when all completed", () => {
    expect(rollUpPlanStatus([s(A, { status: "completed" })])).toBe("completed");
  });
  it("planned otherwise", () => {
    expect(rollUpPlanStatus([s(A, { status: "pending" })])).toBe("planned");
  });
});

describe("applyStepOutcome", () => {
  it("pending -> running sets startedAt when deps met", () => {
    const out = applyStepOutcome([s(A)], A, { status: "running" }, TS);
    expect(out[0]?.status).toBe("running");
    expect(out[0]?.startedAt).toBe(TS);
  });
  it("running -> completed sets completedAt + output, clears error", () => {
    const out = applyStepOutcome(
      [s(A, { status: "running", error: "old" })],
      A,
      { status: "completed", output: "done" },
      TS,
    );
    expect(out[0]?.status).toBe("completed");
    expect(out[0]?.completedAt).toBe(TS);
    expect(out[0]?.output).toBe("done");
    expect(out[0]?.error).toBeUndefined();
  });
  it("running -> failed sets error + completedAt, clears output", () => {
    const out = applyStepOutcome(
      [s(A, { status: "running", output: "old" })],
      A,
      { status: "failed", error: "boom" },
      TS,
    );
    expect(out[0]?.status).toBe("failed");
    expect(out[0]?.error).toBe("boom");
    expect(out[0]?.output).toBeUndefined();
  });
  it("rejects running before deps completed", () => {
    const steps = [s(A, { status: "running" }), s(B, { dependsOn: [A] })];
    expect(() => applyStepOutcome(steps, B, { status: "running" }, TS)).toThrowError(
      TaskTransitionError,
    );
    expect(() => applyStepOutcome(steps, B, { status: "running" }, TS)).toThrowError(
      /task_step_dependency_unmet/,
    );
  });
  it("rejects completed -> running", () => {
    expect(() =>
      applyStepOutcome([s(A, { status: "completed" })], A, { status: "running" }, TS),
    ).toThrowError(/task_step_transition_invalid/);
  });
  it("is an idempotent no-op for same terminal status", () => {
    const steps = [s(A, { status: "completed", completedAt: TS })];
    expect(applyStepOutcome(steps, A, { status: "completed" }, "2026-06-12T09:00:00.000Z")).toEqual(
      steps,
    );
  });
  it("throws task_step_not_found for an unknown step", () => {
    expect(() => applyStepOutcome([s(A)], B, { status: "running" }, TS)).toThrowError(
      /task_step_not_found/,
    );
  });
});

describe("resetFailedStep", () => {
  it("resets only the failed step when nothing depends on it", () => {
    const steps = [s(A, { status: "completed" }), s(B, { status: "failed", error: "x" })];
    const out = resetFailedStep(steps, B);
    expect(out.find((x) => x.id === A)?.status).toBe("completed");
    const reset = out.find((x) => x.id === B);
    expect(reset?.status).toBe("pending");
    expect(reset?.error).toBeUndefined();
    expect(reset?.startedAt).toBeNull();
  });
  it("resets the failed step AND its transitive dependents (incl. a debug step)", () => {
    const steps = [
      s(A, { status: "failed", error: "x", type: "edit" }),
      s(B, { status: "completed", dependsOn: [A], type: "debug" }),
      s(C, { status: "completed", dependsOn: [B], type: "test" }),
    ];
    const out = resetFailedStep(steps, A);
    expect(out.map((x) => x.status)).toEqual(["pending", "pending", "pending"]);
  });
  it("leaves a completed sibling that does not depend on the target untouched", () => {
    const steps = [s(A, { status: "failed", error: "x" }), s(B, { status: "completed" })];
    const out = resetFailedStep(steps, A);
    expect(out.find((x) => x.id === B)?.status).toBe("completed");
  });
  it("throws task_step_not_failed when the step is not failed", () => {
    expect(() => resetFailedStep([s(A, { status: "completed" })], A)).toThrowError(
      /task_step_not_failed/,
    );
  });
  it("throws task_step_not_found for an unknown step", () => {
    expect(() => resetFailedStep([s(A, { status: "failed" })], B)).toThrowError(
      /task_step_not_found/,
    );
  });
});

describe("readySteps", () => {
  it("returns pending steps whose deps are all completed", () => {
    const steps = [
      s(A, { status: "completed" }),
      s(B, { status: "pending", dependsOn: [A] }),
      s(C, { status: "pending", dependsOn: [B] }),
    ];
    expect(readySteps(steps)).toEqual([B]);
  });
});
