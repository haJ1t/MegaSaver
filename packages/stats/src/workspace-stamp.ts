import { existsSync } from "node:fs";
import { join } from "node:path";
import { type WorkspaceKey, encodeWorkspaceKey } from "@megasaver/shared";

export interface TelemetryOptions {
  workspacePath: string;
  storeRoot?: string;
  liveSessionId?: string;
}

/**
 * Evaluates M7 store freshness for telemetry inspection.
 * FAIL-CLOSED: Returns false if storeRoot is missing, invalid, or non-existent.
 */
export function isStoreFresh(storeRoot?: string): boolean {
  if (!storeRoot || typeof storeRoot !== "string" || storeRoot.trim() === "") {
    return false;
  }
  if (!existsSync(storeRoot)) {
    return false;
  }
  const statsDir = join(storeRoot, "stats");
  const contentDir = join(storeRoot, "content");
  return !existsSync(statsDir) && !existsSync(contentDir);
}

/**
 * Stamps a telemetry event with a deterministic workspaceKey, session ID, and freshness state.
 * Throws an Error if workspacePath or liveSessionId is missing (no dummy "sess_default" fallbacks).
 */
export function stampWorkspaceTelemetry<T extends Record<string, unknown>>(
  event: T,
  options: TelemetryOptions,
) {
  if (
    !options.workspacePath ||
    typeof options.workspacePath !== "string" ||
    options.workspacePath.trim() === ""
  ) {
    throw new Error("stampWorkspaceTelemetry requires a non-empty workspacePath");
  }

  const rec = event as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: required for TS4111 noUncheckedIndexedAccess
  const rawSessionId = typeof rec["liveSessionId"] === "string" ? rec["liveSessionId"] : undefined;
  const effectiveSessionId = options.liveSessionId ?? rawSessionId;

  if (
    !effectiveSessionId ||
    typeof effectiveSessionId !== "string" ||
    effectiveSessionId.trim() === ""
  ) {
    throw new Error(
      "stampWorkspaceTelemetry requires a valid liveSessionId (dummy fallbacks forbidden)",
    );
  }

  const workspaceKey: WorkspaceKey = encodeWorkspaceKey(options.workspacePath);
  const fresh = isStoreFresh(options.storeRoot);

  return {
    ...event,
    workspaceKey,
    liveSessionId: effectiveSessionId,
    isFreshStore: fresh,
    createdAt: new Date().toISOString(),
  };
}
