import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTaskExplain } from "../src/commands/task/explain.js";
import { runTaskPlan } from "../src/commands/task/plan.js";
import { runTaskRetry } from "../src/commands/task/retry.js";
import { runTaskStatus } from "../src/commands/task/status.js";
import { runTaskStep } from "../src/commands/task/step.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";
const PLAN_ID = "d0000000-0000-4000-8000-000000000001";

function base(root: string, out: string[], err: string[]) {
  return {
    projectName: "demo",
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    now: () => TS,
  };
}

describe("mega task step + retry", () => {
  let root: string;
  let stepA: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-task2-"));
    await initStore(root);
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    r.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    let i = 0;
    const ids = [
      PLAN_ID,
      "d0000000-0000-4000-8000-00000000000a",
      "d0000000-0000-4000-8000-00000000000b",
    ];
    const plan = r.createTaskPlan(
      PROJECT_ID,
      {
        task: "fix login",
        sessionId: null,
        steps: [
          { type: "edit", title: "edit", key: "a", dependsOnKeys: [] },
          { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
        ],
      },
      { now: () => TS, newId: () => ids[i++] ?? `x${i}` },
    );
    stepA = plan.steps[0]?.id ?? "";
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("marks a step failed (with --record-failure) then retry resets it", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const stepCode = await runTaskStep({
      ...base(root, out, err),
      planIdFlag: PLAN_ID,
      stepIdFlag: stepA,
      statusFlag: "failed",
      errorFlag: "401",
      recordFailure: true,
    });
    expect(stepCode).toBe(0);
    expect(
      createJsonDirectoryCoreRegistry({ rootDir: root }).listFailedAttempts(PROJECT_ID),
    ).toHaveLength(1);

    const retryOut: string[] = [];
    const retryErr: string[] = [];
    const retryCode = await runTaskRetry({
      ...base(root, retryOut, retryErr),
      planIdFlag: PLAN_ID,
      stepIdFlag: stepA,
    });
    expect(retryCode).toBe(0);
    expect(retryOut.join("\n").toLowerCase()).toContain("planned");
  });

  it("retry of a non-failed step exits 1", async () => {
    const err: string[] = [];
    const code = await runTaskRetry({
      ...base(root, [], err),
      planIdFlag: PLAN_ID,
      stepIdFlag: stepA,
    });
    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("not failed");
  });
});

describe("mega task plan", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-task-"));
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("creates a linear plan and prints the plan id", async () => {
    const out: string[] = [];
    const err: string[] = [];
    let i = 0;
    const ids = [
      PLAN_ID,
      "d0000000-0000-4000-8000-00000000000a",
      "d0000000-0000-4000-8000-00000000000b",
    ];
    const code = await runTaskPlan({
      ...base(root, out, err),
      taskFlag: "fix login",
      stepFlags: ["edit:edit auth", "test:run tests"],
      newId: () => ids[i++] ?? `x${i}`,
    });
    expect(code).toBe(0);
    expect(out[0]).toBe(PLAN_ID);
  });
});

describe("mega task status + explain", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-task3-"));
    await initStore(root);
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    r.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    let i = 0;
    const ids = [
      PLAN_ID,
      "d0000000-0000-4000-8000-00000000000a",
      "d0000000-0000-4000-8000-00000000000b",
    ];
    r.createTaskPlan(
      PROJECT_ID,
      {
        task: "fix login",
        sessionId: null,
        steps: [
          { type: "edit", title: "edit", key: "a", dependsOnKeys: [] },
          { type: "test", title: "test", key: "b", dependsOnKeys: ["a"] },
        ],
      },
      { now: () => TS, newId: () => ids[i++] ?? `x${i}` },
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("status prints plan status + ready steps", async () => {
    const out: string[] = [];
    const code = await runTaskStatus({ ...base(root, out, []), planIdFlag: PLAN_ID });
    expect(code).toBe(0);
    const joined = out.join("\n");
    expect(joined).toContain("status  planned");
    expect(joined).toContain("ready");
  });

  it("status --save-summary refuses when the plan is not completed", async () => {
    const err: string[] = [];
    const code = await runTaskStatus({
      ...base(root, [], err),
      planIdFlag: PLAN_ID,
      saveSummaryFlag: "all done",
    });
    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("not completed");
  });

  it("status --save-summary writes a memory once the plan is completed", async () => {
    const stepA = "d0000000-0000-4000-8000-00000000000a";
    const stepB = "d0000000-0000-4000-8000-00000000000b";
    for (const stepId of [stepA, stepB]) {
      const code = await runTaskStep({
        ...base(root, [], []),
        planIdFlag: PLAN_ID,
        stepIdFlag: stepId,
        statusFlag: "completed",
      });
      expect(code).toBe(0);
    }

    const out: string[] = [];
    const code = await runTaskStatus({
      ...base(root, out, []),
      planIdFlag: PLAN_ID,
      saveSummaryFlag: "all done",
      newId: () => "d0000000-0000-4000-8000-0000000000c1",
    });
    expect(code).toBe(0);
    expect(
      createJsonDirectoryCoreRegistry({ rootDir: root }).listMemoryEntries(PROJECT_ID),
    ).toHaveLength(1);
  });

  it("explain renders a blocked-reason line for a dependent step", async () => {
    const out: string[] = [];
    const code = await runTaskExplain({ ...base(root, out, []), planIdFlag: PLAN_ID });
    expect(code).toBe(0);
    const joined = out.join("\n");
    expect(joined).toContain("ready"); // step a is ready
    expect(joined.toLowerCase()).toContain("blocked: waiting on"); // step b blocked on a
  });
});
