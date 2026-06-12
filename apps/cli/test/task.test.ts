import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTaskPlan } from "../src/commands/task/plan.js";

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
