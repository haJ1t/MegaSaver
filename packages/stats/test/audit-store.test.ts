import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/audit-event.js";
import { appendAuditEvent, readAuditEvents } from "../src/audit-store.js";
import { StatsError } from "../src/errors.js";
import type { StatsStore } from "../src/store.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-audit-"));
  store = { root };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const auditFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.audit.jsonl`);
const byteEventsFile = () => join(root, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`);

const ruleEvent = (id = "e1"): AuditEvent =>
  ({
    id,
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-06-12T12:00:00.000Z",
    kind: "rule_applied",
  }) as AuditEvent;

describe("appendAuditEvent + readAuditEvents", () => {
  it("appends a terminated JSONL line and round-trips", () => {
    appendAuditEvent({ store, event: ruleEvent("e1") });
    appendAuditEvent({ store, event: ruleEvent("e2") });
    const raw = readFileSync(auditFile(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const events = readAuditEvents(store, PROJECT_ID, SESSION_ID);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("does not touch the byte events log", () => {
    appendAuditEvent({ store, event: ruleEvent() });
    expect(existsSync(byteEventsFile())).toBe(false);
  });

  it("returns [] when the log is absent", () => {
    expect(readAuditEvents(store, PROJECT_ID, SESSION_ID)).toEqual([]);
  });

  it("drops a non-terminated trailing fragment", () => {
    appendAuditEvent({ store, event: ruleEvent("e1") });
    writeFileSync(auditFile(), `${readFileSync(auditFile(), "utf8")}{"partial":true`, {
      flag: "w",
    });
    expect(readAuditEvents(store, PROJECT_ID, SESSION_ID)).toHaveLength(1);
  });

  it("throws store_corrupt on a corrupt terminated line", () => {
    appendAuditEvent({ store, event: ruleEvent("e1") });
    writeFileSync(auditFile(), `${readFileSync(auditFile(), "utf8")}{not json}\n`, { flag: "w" });
    expect(() => readAuditEvents(store, PROJECT_ID, SESSION_ID)).toThrow(StatsError);
  });

  it("throws schema_invalid on an invalid event", () => {
    expect(() =>
      appendAuditEvent({ store, event: { ...ruleEvent(), id: "" } as AuditEvent }),
    ).toThrow(StatsError);
  });

  it("reads every session's audit log when sessionId is omitted", () => {
    const otherSession = "33333333-3333-4333-8333-333333333333" as SessionId;
    appendAuditEvent({ store, event: ruleEvent("e1") });
    appendAuditEvent({
      store,
      event: { ...ruleEvent("e2"), sessionId: otherSession } as AuditEvent,
    });
    expect(readAuditEvents(store, PROJECT_ID)).toHaveLength(2);
  });
});
