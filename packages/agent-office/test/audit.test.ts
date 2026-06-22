import { randomUUID } from "node:crypto";
import {
  officeAgentIdSchema,
  officeTaskIdSchema,
  projectIdSchema,
  sessionIdSchema,
  workspaceKeySchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { auditEventSchema, auditEventTypeSchema } from "../src/audit.js";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    ts: "2026-06-22T12:00:00.000Z",
    type: "spawn",
    workspaceKey: workspaceKeySchema.parse("0123456789abcdef"),
    officeAgentId: officeAgentIdSchema.parse(randomUUID()),
    taskId: officeTaskIdSchema.parse(randomUUID()),
    kind: "claude-code",
    permissionMode: "plan",
    workdir: "/repo",
    coreSessionId: sessionIdSchema.parse(randomUUID()),
    claudeSessionId: "claude-sess-001",
    ...overrides,
  };
}

describe("auditEventTypeSchema", () => {
  it("enumerates spawn, task_done, task_failed", () => {
    expect(auditEventTypeSchema.options).toEqual(["spawn", "task_done", "task_failed"]);
  });
});

describe("auditEventSchema", () => {
  it("accepts a valid spawn event", () => {
    expect(auditEventSchema.parse(makeEvent())).toMatchObject({ type: "spawn" });
  });

  it("accepts a task_done event with exitCode 0", () => {
    expect(auditEventSchema.parse(makeEvent({ type: "task_done", exitCode: 0 }))).toMatchObject({
      type: "task_done",
      exitCode: 0,
    });
  });

  it("accepts a task_failed event with exitCode null", () => {
    expect(
      auditEventSchema.parse(makeEvent({ type: "task_failed", exitCode: null })),
    ).toMatchObject({ exitCode: null });
  });

  it("rejects an unknown type", () => {
    expect(() => auditEventSchema.parse(makeEvent({ type: "unknown" }))).toThrow();
  });

  it("rejects extra keys (strict)", () => {
    expect(() => auditEventSchema.parse({ ...makeEvent(), extra: true })).toThrow();
  });

  it("rejects a non-ISO ts", () => {
    expect(() => auditEventSchema.parse(makeEvent({ ts: "not-a-date" }))).toThrow();
  });
});
