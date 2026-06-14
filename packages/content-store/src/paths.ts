import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { ContentStoreError } from "./errors.js";

export function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  ) {
    throw new ContentStoreError("write_failed", `Unsafe chunkSetId segment: ${segment}`);
  }
}

export function chunkSetPath(input: {
  storeRoot: string;
  projectId: ProjectId;
  sessionId: SessionId;
  chunkSetId: string;
}): string {
  assertSafeSegment(input.chunkSetId);
  return join(
    input.storeRoot,
    "content",
    input.projectId,
    input.sessionId,
    `${input.chunkSetId}.json`,
  );
}

export function overlayChunkSetPath(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  chunkSetId: string;
}): string {
  assertSafeSegment(input.workspaceKey);
  assertSafeSegment(input.liveSessionId);
  assertSafeSegment(input.chunkSetId);
  return join(
    input.storeRoot,
    "content",
    input.workspaceKey,
    input.liveSessionId,
    `${input.chunkSetId}.json`,
  );
}
