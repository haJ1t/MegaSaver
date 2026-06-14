import { taskPlanIdSchema, taskStepIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  taskPlanInputSchema,
  taskPlanSchema,
  taskStepStatusSchema,
  taskStepTypeSchema,
} from "../src/task-plan.js";

const WORKSPACE_KEY = "ws-abc123";
const S1 = "d0000000-0000-4000-8000-000000000011";
const S2 = "d0000000-0000-4000-8000-000000000012";
const TS = "2026-06-12T00:00:00.000Z";

function step(id: string, over: Record<string, unknown> = {}) {
  return { id, type: "edit", title: "do a thing", dependsOn: [], status: "pending", ...over };
}
function plan(over: Record<string, unknown> = {}) {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    workspaceKey: WORKSPACE_KEY,
    sessionId: null,
    task: "fix the login bug",
    status: "planned",
    steps: [step(S1)],
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

describe("enum declaration order", () => {
  it("taskStepTypeSchema is roadmap order", () => {
    expect(taskStepTypeSchema.options).toEqual([
      "scan",
      "retrieve_context",
      "plan",
      "edit",
      "test",
      "debug",
      "document",
      "save_memory",
    ]);
  });
  it("taskStepStatusSchema is pending|running|failed|completed", () => {
    expect(taskStepStatusSchema.options).toEqual(["pending", "running", "failed", "completed"]);
  });
});

describe("taskPlanSchema", () => {
  it("parses a minimal plan and seeds step defaults", () => {
    const parsed = taskPlanSchema.parse(plan());
    expect(parsed.steps[0]?.status).toBe("pending");
    expect(parsed.steps[0]?.startedAt).toBeNull();
  });
  it("rejects a duplicate step id", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [step(S1), step(S1)] }))).toThrow();
  });
  it("rejects a dependsOn that references an unknown step", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [step(S1, { dependsOn: [S2] })] }))).toThrow();
  });
  it("rejects a self-dependency", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [step(S1, { dependsOn: [S1] })] }))).toThrow();
  });
  it("rejects an empty steps array", () => {
    expect(() => taskPlanSchema.parse(plan({ steps: [] }))).toThrow();
  });
  it("rejects unknown top-level keys (strict)", () => {
    expect(() => taskPlanSchema.parse(plan({ extra: 1 }))).toThrow();
  });
});

describe("taskPlanInputSchema", () => {
  it("parses caller steps with local keys + dependsOnKeys", () => {
    const parsed = taskPlanInputSchema.parse({
      task: "t",
      sessionId: null,
      steps: [
        { type: "edit", title: "edit it", key: "a" },
        { type: "test", title: "test it", key: "b", dependsOnKeys: ["a"] },
      ],
    });
    expect(parsed.steps[1]?.dependsOnKeys).toEqual(["a"]);
  });
  it("rejects a duplicate key", () => {
    expect(() =>
      taskPlanInputSchema.parse({
        task: "t",
        steps: [
          { type: "edit", title: "x", key: "a" },
          { type: "test", title: "y", key: "a" },
        ],
      }),
    ).toThrow();
  });
  it("rejects dependsOnKeys referencing an unknown key", () => {
    expect(() =>
      taskPlanInputSchema.parse({
        task: "t",
        steps: [{ type: "edit", title: "x", key: "a", dependsOnKeys: ["zzz"] }],
      }),
    ).toThrow();
  });
});

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
