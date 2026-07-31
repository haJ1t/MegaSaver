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
  const rec = event as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: required for TS4111 noUncheckedIndexedAccess
  const rawSessionId = typeof rec["liveSessionId"] === "string" ? rec["liveSessionId"] : undefined;

  return {
    ...event,
    workspaceKey,
    liveSessionId: options.liveSessionId ?? (rawSessionId as string) ?? "sess_default",
    isFreshStore: fresh,
    createdAt: new Date().toISOString(),
  };
}
