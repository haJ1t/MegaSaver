import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleBuildTaskPlan } from "../../src/tools/build-task-plan.js";
import { handleGetTaskStatus } from "../../src/tools/get-task-status.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-12T00:00:00.000Z";

function seeded(): CoreRegistry {
  const r = createInMemoryCoreRegistry();
  r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
  return r;
}
function ids(list: string[]) {
  let i = 0;
  return { now: () => TS, newId: () => list[i++] ?? `x${i}` };
}
const PLAN_ID = "d0000000-0000-4000-8000-000000000001";
const STEP_A = "d0000000-0000-4000-8000-00000000000a";
const STEP_B = "d0000000-0000-4000-8000-00000000000b";

describe("build_task_plan", () => {
  it("creates a plan with resolved dependencies", async () => {
    const r = seeded();
    const env = { registry: r, ...ids([PLAN_ID, STEP_A, STEP_B]) };
    const res = await handleBuildTaskPlan(env, {
      projectId: PROJECT_ID,
      task: "fix login",
      steps: [
        { type: "edit", title: "edit", key: "a" },
        { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
      ],
    });
    expect(res.plan.id).toBe(PLAN_ID);
    expect(res.plan.steps[1]?.dependsOn).toEqual([STEP_A]);
  });
  it("rejects an unknown project as resource_not_found", async () => {
    const env = { registry: seeded(), ...ids([PLAN_ID, STEP_A]) };
    await expect(
      handleBuildTaskPlan(env, {
        projectId: "99999999-9999-4999-8999-999999999999",
        task: "t",
        steps: [{ type: "edit", title: "x", key: "a" }],
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
  it("rejects invalid input as validation_failed", async () => {
    const env = { registry: seeded(), ...ids([PLAN_ID]) };
    await expect(
      handleBuildTaskPlan(env, { projectId: PROJECT_ID, task: "t", steps: [] }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("get_task_status", () => {
  async function withPlan() {
    const r = seeded();
    const env = { registry: r, ...ids([PLAN_ID, STEP_A, STEP_B]) };
    await handleBuildTaskPlan(env, {
      projectId: PROJECT_ID,
      task: "fix login",
      steps: [
        { type: "edit", title: "edit", key: "a" },
        { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
      ],
    });
    return r;
  }
  it("returns the plan and the ready step ids", async () => {
    const r = await withPlan();
    const res = await handleGetTaskStatus({ registry: r }, { planId: PLAN_ID });
    expect(res.plan.id).toBe(PLAN_ID);
    expect(res.ready).toEqual([STEP_A]); // b is blocked on a
  });
  it("rejects an unknown plan as resource_not_found", async () => {
    const r = seeded();
    await expect(handleGetTaskStatus({ registry: r }, { planId: PLAN_ID })).rejects.toMatchObject({
      code: "resource_not_found",
    });
  });
});
