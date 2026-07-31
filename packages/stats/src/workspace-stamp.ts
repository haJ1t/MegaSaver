import { existsSync } from "node:fs";
import { join } from "node:path";
import { type WorkspaceKey, encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { TelemetryValidationError } from "./errors.js";

export const telemetryOptionsSchema = z.object({
  workspacePath: z.string().trim().min(1, "workspacePath must be non-empty"),
  storeRoot: z.string().trim().min(1, "storeRoot must be non-empty"),
  liveSessionId: z.string().trim().min(1, "liveSessionId must be non-empty"),
});

export type TelemetryOptions = z.infer<typeof telemetryOptionsSchema>;

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
 * Validates options using telemetryOptionsSchema and throws TelemetryValidationError on missing boundary fields.
 */
export function stampWorkspaceTelemetry<T extends Record<string, unknown>>(
  event: T,
  options: TelemetryOptions,
) {
  if (!options || typeof options !== "object") {
    throw new TelemetryValidationError("schema_invalid", "options object required");
  }

  if (
    !options.workspacePath ||
    typeof options.workspacePath !== "string" ||
    options.workspacePath.trim() === ""
  ) {
    throw new TelemetryValidationError(
      "missing_workspace_path",
      "stampWorkspaceTelemetry requires a non-empty workspacePath",
    );
  }

  if (
    !options.storeRoot ||
    typeof options.storeRoot !== "string" ||
    options.storeRoot.trim() === ""
  ) {
    throw new TelemetryValidationError(
      "missing_store_root",
      "stampWorkspaceTelemetry requires a non-empty storeRoot",
    );
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
    throw new TelemetryValidationError(
      "missing_session_id",
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
