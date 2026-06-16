import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { EvidenceLedgerError } from "./errors.js";

export function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new EvidenceLedgerError("write_failed", `Unsafe path segment: ${segment}`);
  }
}

// Parse the workspaceKey at the IO boundary (spec §6): rejects anything that is
// not a 16-hex key, independent of TypeScript branding.
export function parseWorkspaceKey(workspaceKey: string): string {
  const result = workspaceKeySchema.safeParse(workspaceKey);
  if (!result.success) {
    throw new EvidenceLedgerError("schema_invalid", `Invalid workspaceKey: ${workspaceKey}`);
  }
  return result.data;
}

export function workspaceDir(storeRoot: string, workspaceKey: string): string {
  const key = parseWorkspaceKey(workspaceKey);
  assertSafeSegment(key);
  return join(storeRoot, "evidence", key);
}

export function recordPath(storeRoot: string, workspaceKey: string, evidenceId: string): string {
  assertSafeSegment(evidenceId);
  return join(workspaceDir(storeRoot, workspaceKey), `${evidenceId}.json`);
}
