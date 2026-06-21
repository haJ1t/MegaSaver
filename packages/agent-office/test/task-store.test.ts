import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officeAgentIdSchema, officeTaskIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteTask, listTasks, loadTask, saveTask } from "../src/task-store.js";
import { type OfficeTask, officeTaskSchema } from "../src/task.js";

let storeRoot: string;
const workspaceKey = "0123456789abcdef";
const agentId = officeAgentIdSchema.parse(randomUUID());
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "agent-office-tasks-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

function makeTask(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return officeTaskSchema.parse({
    id: officeTaskIdSchema.parse(randomUUID()),
    agentId,
    workspaceKey,
    instruction: "Do the thing.",
    status: "queued",
    queuedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  });
}

describe("task store", () => {
  it("round-trips a saved task", async () => {
    const task = makeTask();
    await saveTask({ storeRoot, task });
    expect(
      await loadTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id }),
    ).toEqual(task);
  });

  it("throws not_found for a missing task", async () => {
    await expect(
      loadTask({
        storeRoot,
        workspaceKey,
        officeAgentId: agentId,
        officeTaskId: officeTaskIdSchema.parse(randomUUID()),
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists tasks for one agent and returns [] when none exist", async () => {
    expect(await listTasks({ storeRoot, workspaceKey, officeAgentId: agentId })).toEqual([]);
    const a = makeTask();
    const b = makeTask({ status: "done", exitCode: 0 });
    await saveTask({ storeRoot, task: a });
    await saveTask({ storeRoot, task: b });
    const ids = (await listTasks({ storeRoot, workspaceKey, officeAgentId: agentId }))
      .map((t) => t.id)
      .sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("scopes listing to the requested agent only", async () => {
    const otherAgent = officeAgentIdSchema.parse(randomUUID());
    await saveTask({ storeRoot, task: makeTask() });
    expect(await listTasks({ storeRoot, workspaceKey, officeAgentId: otherAgent })).toEqual([]);
  });

  it("deletes a task (idempotent)", async () => {
    const task = makeTask();
    await saveTask({ storeRoot, task });
    await deleteTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id });
    await expect(
      loadTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await deleteTask({ storeRoot, workspaceKey, officeAgentId: agentId, officeTaskId: task.id });
  });
});
