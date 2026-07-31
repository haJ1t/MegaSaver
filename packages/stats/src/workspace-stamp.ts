import { existsSync } from "node:fs";
import { join } from "node:path";
import { type WorkspaceKey, encodeWorkspaceKey } from "@megasaver/shared";

export interface TelemetryOptions {
  workspacePath: string;
  storeRoot?: string;
  liveSessionId?: string;
}

export function isStoreFresh(storeRoot?: string): boolean {
  if (!storeRoot) return true;
  const statsDir = join(storeRoot, "stats");
  const contentDir = join(storeRoot, "content");
  return !existsSync(statsDir) && !existsSync(contentDir);
}

export function stampWorkspaceTelemetry<T extends Record<string, unknown>>(
  event: T,
  options: TelemetryOptions,
) {
  const workspaceKey: WorkspaceKey = encodeWorkspaceKey(options.workspacePath);
  const fresh = isStoreFresh(options.storeRoot);
  const rawSessionId =
    "liveSessionId" in event && typeof event.liveSessionId === "string"
      ? (event.liveSessionId as string)
      : undefined;

  return {
    ...event,
    workspaceKey,
    liveSessionId: options.liveSessionId ?? rawSessionId ?? "sess_default",
    isFreshStore: fresh,
    createdAt: new Date().toISOString(),
  };
}
