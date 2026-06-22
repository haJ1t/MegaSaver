import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  officeAgentIdSchema,
  officeTaskIdSchema,
  sessionIdSchema,
  workspaceKeySchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { appendAudit, listAudit } from "../src/audit-store.js";
import type { AuditEvent } from "../src/audit.js";
import { AgentOfficeError } from "../src/errors.js";
import { auditDir } from "../src/paths.js";

const WK = workspaceKeySchema.parse("0123456789abcdef");

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: randomUUID(),
    ts: "2026-06-22T12:00:00.000Z",
    type: "spawn",
    workspaceKey: WK,
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

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "agent-office-audit-test-"));
}

describe("appendAudit / listAudit", () => {
  it("round-trips a single event", async () => {
    const storeRoot = makeTmp();
    const event = makeEvent();
    await appendAudit({ storeRoot, event });
    const events = await listAudit({ storeRoot, workspaceKey: WK });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: event.id, type: "spawn" });
  });

  it("returns empty array when no events exist", async () => {
    const storeRoot = makeTmp();
    const events = await listAudit({ storeRoot, workspaceKey: WK });
    expect(events).toEqual([]);
  });

  it("sorts events by ts ascending", async () => {
    const storeRoot = makeTmp();
    const e1 = makeEvent({ id: randomUUID(), ts: "2026-06-22T12:02:00.000Z", type: "task_done" });
    const e2 = makeEvent({ id: randomUUID(), ts: "2026-06-22T12:01:00.000Z", type: "spawn" });
    const e3 = makeEvent({
      id: randomUUID(),
      ts: "2026-06-22T12:03:00.000Z",
      type: "task_failed",
    });
    await appendAudit({ storeRoot, event: e1 });
    await appendAudit({ storeRoot, event: e2 });
    await appendAudit({ storeRoot, event: e3 });
    const events = await listAudit({ storeRoot, workspaceKey: WK });
    expect(events.map((e) => e.type)).toEqual(["spawn", "task_done", "task_failed"]);
  });

  it("throws store_corrupt on bad-json file", async () => {
    const storeRoot = makeTmp();
    const dir = auditDir(storeRoot, WK);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${randomUUID()}.json`), "not-json");
    await expect(listAudit({ storeRoot, workspaceKey: WK })).rejects.toThrow(AgentOfficeError);
    try {
      await listAudit({ storeRoot, workspaceKey: WK });
    } catch (err) {
      expect((err as AgentOfficeError).code).toBe("store_corrupt");
    }
  });

  it("rejects an unsafe workspaceKey segment in appendAudit", async () => {
    const storeRoot = makeTmp();
    const event = makeEvent({ workspaceKey: WK });
    // Bypass the type system to test path safety
    await expect(appendAudit({ storeRoot, event: { ...event, id: "../evil" } })).rejects.toThrow(
      AgentOfficeError,
    );
  });
});
