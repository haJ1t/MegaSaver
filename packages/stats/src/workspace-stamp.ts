import { existsSync } from "node:fs";
import { join } from "node:path";
import { type WorkspaceKey, encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { TelemetryValidationError } from "./errors.js";

export const telemetryOptionsSchema = z.object({
  workspacePath: z.string().trim().min(1, "workspacePath must be non-empty"),
  storeRoot: z.string().trim().min(1, "storeRoot must be non-empty"),
  liveSessionId: z.string().trim().min(1, "liveSessionId must be non-empty").optional(),
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
 * Validates boundary options using telemetryOptionsSchema.safeParse and throws typed TelemetryValidationError on invalid fields.
 */
export function stampWorkspaceTelemetry<T extends Record<string, unknown>>(
  event: T,
  options: TelemetryOptions,
) {
  const parsed = telemetryOptionsSchema.safeParse(options);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const pathName = firstIssue?.path[0];
    if (pathName === "workspacePath") {
      throw new TelemetryValidationError(
        "missing_workspace_path",
        firstIssue?.message ?? "stampWorkspaceTelemetry requires a non-empty workspacePath",
      );
    }
    if (pathName === "storeRoot") {
      throw new TelemetryValidationError(
        "missing_store_root",
        firstIssue?.message ?? "stampWorkspaceTelemetry requires a non-empty storeRoot",
      );
    }
    if (pathName === "liveSessionId") {
      throw new TelemetryValidationError(
        "missing_session_id",
        firstIssue?.message ?? "stampWorkspaceTelemetry requires a non-empty liveSessionId",
      );
    }
    throw new TelemetryValidationError(
      "schema_invalid",
      firstIssue?.message ?? "stampWorkspaceTelemetry options schema invalid",
    );
  }

  const validOptions = parsed.data;
  const rec = event as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: required for TS4111 noUncheckedIndexedAccess
  const rawSessionId = typeof rec["liveSessionId"] === "string" ? rec["liveSessionId"] : undefined;
  const effectiveSessionId = validOptions.liveSessionId ?? rawSessionId;

  if (!effectiveSessionId || typeof effectiveSessionId !== "string" || effectiveSessionId.trim() === "") {
    throw new TelemetryValidationError(
      "missing_session_id",
      "stampWorkspaceTelemetry requires a valid liveSessionId (dummy fallbacks forbidden)",
    );
  }

  const workspaceKey: WorkspaceKey = encodeWorkspaceKey(validOptions.workspacePath);
  const fresh = isStoreFresh(validOptions.storeRoot);

  return {
    ...event,
    workspaceKey,
    liveSessionId: effectiveSessionId,
    isFreshStore: fresh,
    createdAt: new Date().toISOString(),
  };
}
