import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAllTaskPlans,
  readTaskPlansForProject,
  resolveStorePaths,
  writeTaskPlansForProject,
} from "../src/json-directory-store.js";
import type { TaskPlan } from "../src/task-plan.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";

const plan: TaskPlan = {
  id: "d0000000-0000-4000-8000-000000000001" as TaskPlan["id"],
  projectId: PROJECT_ID,
  sessionId: null,
  task: "fix login",
  status: "planned",
  steps: [
    {
      id: "d0000000-0000-4000-8000-00000000000a" as TaskPlan["steps"][number]["id"],
      type: "edit",
      title: "edit",
      dependsOn: [],
      status: "pending",
      startedAt: null,
      completedAt: null,
    },
  ],
  createdAt: TS,
  updatedAt: TS,
};

describe("task-plans store", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "task-store-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("round-trips plans per project and reads all", () => {
    const paths = resolveStorePaths(root);
    writeTaskPlansForProject(paths, PROJECT_ID, [plan]);
    expect(readTaskPlansForProject(paths, PROJECT_ID).map((p) => p.id)).toEqual([plan.id]);
    expect(readAllTaskPlans(paths).map((p) => p.id)).toEqual([plan.id]);
  });

  it("removes the file when the set is empty", () => {
    const paths = resolveStorePaths(root);
    writeTaskPlansForProject(paths, PROJECT_ID, [plan]);
    writeTaskPlansForProject(paths, PROJECT_ID, []);
    expect(readTaskPlansForProject(paths, PROJECT_ID)).toEqual([]);
  });
});
