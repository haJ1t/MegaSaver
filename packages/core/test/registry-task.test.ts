import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, taskPlanIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";
const project = {
  id: PROJECT_ID,
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: TS,
  updatedAt: TS,
} as const;

// Deterministic id source: plan id first, then step ids in array order.
function clockFrom(ids: string[]) {
  let i = 0;
  return { now: () => TS, newId: () => ids[i++] ?? `x${i}` };
}
const PLAN_ID = "d0000000-0000-4000-8000-000000000001";
const STEP_A = "d0000000-0000-4000-8000-00000000000a";
const STEP_B = "d0000000-0000-4000-8000-00000000000b";

const input = {
  task: "fix login bug",
  sessionId: null,
  steps: [
    { type: "edit", title: "edit auth", key: "a" },
    { type: "debug", title: "debug auth", key: "b", dependsOnKeys: ["a"] },
  ],
} as const;

function suite(name: string, make: () => CoreRegistry) {
  describe(`${name}: task registry`, () => {
    it("createTaskPlan mints ids, resolves keys -> dependsOn, seeds pending/planned", () => {
      const r = make();
      r.createProject(project);
      const plan = r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      expect(plan.id).toBe(PLAN_ID);
      expect(plan.status).toBe("planned");
      expect(plan.steps.map((s) => s.id)).toEqual([STEP_A, STEP_B]);
      expect(plan.steps[1]?.dependsOn).toEqual([STEP_A]);
      expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
    });

    it("createTaskPlan throws on unknown project", () => {
      const r = make();
      expect(() =>
        r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B])),
      ).toThrowError(/project_not_found|does not exist/);
    });

    it("getTaskPlan / listTaskPlans are project-scoped", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      expect(r.getTaskPlan(taskPlanIdSchema.parse(PLAN_ID))?.id).toBe(PLAN_ID);
      expect(r.listTaskPlans(PROJECT_ID).map((p) => p.id)).toEqual([PLAN_ID]);
    });

    it("recordTaskStep advances a step and rolls up plan status", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      const planId = taskPlanIdSchema.parse(PLAN_ID);
      const running = r.recordTaskStep(
        planId,
        STEP_A as never,
        { status: "running" },
        { now: () => TS },
      );
      expect(running.status).toBe("running");
      const failed = r.recordTaskStep(
        planId,
        STEP_A as never,
        { status: "failed", error: "401" },
        { now: () => TS },
      );
      expect(failed.status).toBe("failed");
      expect(failed.steps[0]?.error).toBe("401");
    });

    it("recordTaskStep throws task_plan_not_found for an unknown plan", () => {
      const r = make();
      r.createProject(project);
      expect(() =>
        r.recordTaskStep(
          taskPlanIdSchema.parse(PLAN_ID),
          STEP_A as never,
          { status: "running" },
          { now: () => TS },
        ),
      ).toThrowError(/task_plan_not_found|does not exist/);
    });

    it("retryTaskStep resets the failed step + dependents, not the whole plan", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      const planId = taskPlanIdSchema.parse(PLAN_ID);
      r.recordTaskStep(
        planId,
        STEP_A as never,
        { status: "failed", error: "x" },
        { now: () => TS },
      );
      const retried = r.retryTaskStep(planId, STEP_A as never);
      expect(retried.steps[0]?.status).toBe("pending");
      expect(retried.steps[1]?.status).toBe("pending");
      expect(retried.status).toBe("planned");
    });

    it("retryTaskStep throws task_step_not_failed when the step is not failed", () => {
      const r = make();
      r.createProject(project);
      r.createTaskPlan(PROJECT_ID, input, clockFrom([PLAN_ID, STEP_A, STEP_B]));
      expect(() => r.retryTaskStep(taskPlanIdSchema.parse(PLAN_ID), STEP_A as never)).toThrowError(
        /task_step_not_failed|not failed/,
      );
    });
  });
}

suite("in-memory", () => createInMemoryCoreRegistry());

describe("json-directory", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reg-p6-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  suite("json", () => createJsonDirectoryCoreRegistry({ rootDir: root }));
});
