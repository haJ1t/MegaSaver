import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { type AuditEvent, auditEventSchema } from "./audit.js";
import { AgentOfficeError } from "./errors.js";
import { auditDir, auditPath } from "./paths.js";

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseAuditFile(path: string, raw: string): AuditEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt audit file: ${path}`, { cause: error });
  }
  try {
    return auditEventSchema.parse(parsed);
  } catch (error) {
    throw new AgentOfficeError("store_corrupt", `Corrupt audit file: ${path}`, { cause: error });
  }
}

export async function appendAudit(input: {
  storeRoot: string;
  event: AuditEvent;
}): Promise<void> {
  let event: AuditEvent;
  try {
    event = auditEventSchema.parse(input.event);
  } catch (error) {
    throw new AgentOfficeError("schema_invalid", "Audit event is invalid.", { cause: error });
  }
  const path = auditPath({
    storeRoot: input.storeRoot,
    workspaceKey: event.workspaceKey,
    auditId: event.id,
  });
  atomicWriteFile(path, `${JSON.stringify(event, null, 2)}\n`);
}

export async function listAudit(input: {
  storeRoot: string;
  workspaceKey: string;
}): Promise<readonly AuditEvent[]> {
  const dir = auditDir(input.storeRoot, input.workspaceKey);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const events: AuditEvent[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, name);
    events.push(parseAuditFile(path, readFileSync(path, "utf8")));
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return events;
}
