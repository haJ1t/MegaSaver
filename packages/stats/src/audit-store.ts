import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { type AuditEvent, auditEventSchema } from "./audit-event.js";
import { StatsError } from "./errors.js";
import type { StatsStore } from "./store.js";

export type AppendAuditEventInput = { store: StatsStore; event: AuditEvent };

function projectDir(store: StatsStore, projectId: ProjectId): string {
  return join(store.root, "stats", projectId);
}

function auditPath(store: StatsStore, projectId: ProjectId, sessionId: SessionId): string {
  return join(projectDir(store, projectId), `${sessionId}.audit.jsonl`);
}

function parseLog(path: string): AuditEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  // Committed events are exactly the segments preceding a "\n"; a partial,
  // non-terminated trailing fragment (a crash mid-append) is dropped.
  const lines = raw.split("\n").slice(0, -1);
  const events: AuditEvent[] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new StatsError("store_corrupt");
    }
    const parsed = auditEventSchema.safeParse(json);
    if (!parsed.success) {
      throw new StatsError("store_corrupt");
    }
    events.push(parsed.data);
  }
  return events;
}

export function appendAuditEvent(input: AppendAuditEventInput): void {
  const parsed = auditEventSchema.safeParse(input.event);
  if (!parsed.success) {
    throw new StatsError("schema_invalid");
  }
  const event = parsed.data;
  const path = auditPath(input.store, event.projectId, event.sessionId);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

export function readAuditEvents(
  store: StatsStore,
  projectId: ProjectId,
  sessionId?: SessionId,
): AuditEvent[] {
  if (sessionId !== undefined) {
    return parseLog(auditPath(store, projectId, sessionId));
  }
  const dir = projectDir(store, projectId);
  if (!existsSync(dir)) return [];
  const out: AuditEvent[] = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".audit.jsonl")) {
      out.push(...parseLog(join(dir, name)));
    }
  }
  return out;
}
