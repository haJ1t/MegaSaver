import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTaskPlan } from "../src/commands/task/plan.js";
import { runTaskRetry } from "../src/commands/task/retry.js";
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
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    let i = 0;
    const ids = [PLAN_ID, "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"];
    const plan = r.createTaskPlan(
      PROJECT_ID,
      {
        task: "fix login",
        sessionId: null,
        steps: [
          { type: "edit", title: "edit", key: "a" },
          { type: "debug", title: "debug", key: "b", dependsOnKeys: ["a"] },
        ],
      },
      { now: () => TS, newId: () => ids[i++] ?? `x${i}` },
    );
    stepA = plan.steps[0]!.id;
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
    expect(createJsonDirectoryCoreRegistry({ rootDir: root }).listFailedAttempts(PROJECT_ID)).toHaveLength(1);

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
    const ids = [PLAN_ID, "d0000000-0000-4000-8000-00000000000a", "d0000000-0000-4000-8000-00000000000b"];
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
