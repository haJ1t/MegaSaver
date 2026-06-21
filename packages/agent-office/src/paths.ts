import { join } from "node:path";
import { AgentOfficeError } from "./errors.js";

export function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0")
  ) {
    throw new AgentOfficeError("write_failed", `Unsafe path segment: ${segment}`);
  }
}

export function rolesDir(storeRoot: string): string {
  return join(storeRoot, "office", "roles");
}

export function rolePath(input: { storeRoot: string; roleId: string }): string {
  assertSafeSegment(input.roleId);
  return join(rolesDir(input.storeRoot), `${input.roleId}.json`);
}

export function agentsDir(storeRoot: string, workspaceKey: string): string {
  assertSafeSegment(workspaceKey);
  return join(storeRoot, "office", workspaceKey, "agents");
}

export function agentPath(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
}): string {
  assertSafeSegment(input.officeAgentId);
  return join(agentsDir(input.storeRoot, input.workspaceKey), `${input.officeAgentId}.json`);
}

export function tasksDir(storeRoot: string, workspaceKey: string, officeAgentId: string): string {
  assertSafeSegment(workspaceKey);
  assertSafeSegment(officeAgentId);
  return join(storeRoot, "office", workspaceKey, "tasks", officeAgentId);
}

export function taskPath(input: {
  storeRoot: string;
  workspaceKey: string;
  officeAgentId: string;
  officeTaskId: string;
}): string {
  assertSafeSegment(input.officeTaskId);
  return join(
    tasksDir(input.storeRoot, input.workspaceKey, input.officeAgentId),
    `${input.officeTaskId}.json`,
  );
}
