import { randomUUID } from "node:crypto";
import { officeAgentIdSchema, officeTaskIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type OfficeTask, officeTaskSchema, taskStatusSchema } from "../src/task.js";

function makeTask(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return {
    id: officeTaskIdSchema.parse(randomUUID()),
    agentId: officeAgentIdSchema.parse(randomUUID()),
    workspaceKey: "0123456789abcdef",
    instruction: "Refactor the auth module.",
    status: "queued",
    queuedAt: "2026-06-22T12:00:00.000Z",
    ...overrides,
  } as OfficeTask;
}

describe("officeTaskSchema", () => {
  it("accepts a queued task with no run timestamps", () => {
    expect(officeTaskSchema.parse(makeTask())).toMatchObject({ status: "queued" });
  });

  it("accepts a finished task with timestamps + exit code", () => {
    const parsed = officeTaskSchema.parse(
      makeTask({
        status: "done",
        startedAt: "2026-06-22T12:01:00.000Z",
        finishedAt: "2026-06-22T12:05:00.000Z",
        exitCode: 0,
      }),
    );
    expect(parsed.exitCode).toBe(0);
  });

  it("enumerates statuses alphabetically", () => {
    expect(taskStatusSchema.options).toEqual(["canceled", "done", "failed", "queued", "running"]);
  });

  it("rejects an empty instruction", () => {
    expect(() => officeTaskSchema.parse(makeTask({ instruction: "" }))).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => officeTaskSchema.parse({ ...makeTask(), extra: 1 })).toThrow();
  });

  it("rejects an invalid workspaceKey (uppercase)", () => {
    expect(() => officeTaskSchema.parse({ ...makeTask(), workspaceKey: "WK" })).toThrow();
  });

  it("rejects an invalid workspaceKey (wrong length)", () => {
    expect(() => officeTaskSchema.parse({ ...makeTask(), workspaceKey: "0123456789ab" })).toThrow();
  });
});
