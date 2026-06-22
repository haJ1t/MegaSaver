// Order: alphabetic (AA3 convention). Exhaustive for v1.
// New codes require this list to grow + a fresh .test-d.ts assertion update.
// Mirrored in apps/gui/bridge/server.ts (bridge side).
export const BRIDGE_ERROR_CODES = [
  "claude_session_not_found",
  "connector_write_failed",
  "event_not_found",
  "index_unavailable",
  "internal_error",
  "mcp_setup_failed",
  "memory_entry_not_found",
  "method_not_allowed",
  "office_not_configured",
  "office_not_found",
  "origin_forbidden",
  "policy_load_failed",
  "project_not_found",
  "rootpath_invalid",
  "route_not_found",
  "session_already_ended",
  "session_not_found",
  "session_project_mismatch",
  "store_write_failed",
  "validation_failed",
] as const;
export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number];

// Human-readable copy map used by ErrorState component.
// Falls back to the bridge's `error` string field for unknown codes.
export const BRIDGE_ERROR_COPY: Record<BridgeErrorCode, string> = {
  claude_session_not_found: "Claude Code session not found. It may have been removed.",
  connector_write_failed:
    "Could not write the workspace file. It may be a symlink or permission-protected.",
  event_not_found: "Event not found, or it has no stored output.",
  index_unavailable:
    "The semantic index is missing or corrupt. Rebuild it with `mega index build`.",
  internal_error: "Something went wrong. Try again.",
  mcp_setup_failed: "Agent setup failed. Check permissions and try again.",
  memory_entry_not_found: "Memory entry not found. It may have been removed.",
  method_not_allowed: "Request method not allowed.",
  office_not_configured: "Office is not configured. Server is missing office deps.",
  office_not_found: "Office resource not found. It may have been removed.",
  origin_forbidden: "Request blocked by the bridge origin policy.",
  policy_load_failed:
    "Permissions file is malformed. Fix .megasaver/permissions.yaml and try again.",
  project_not_found: "Project not found. It may have been removed.",
  rootpath_invalid: "Root path must be an existing, readable directory.",
  route_not_found: "API route not found.",
  session_already_ended: "This session has already ended.",
  session_not_found: "Session not found. It may have been removed.",
  session_project_mismatch: "Session does not belong to this project.",
  store_write_failed: "Store write failed. Check disk space and permissions.",
  validation_failed: "Invalid input. Check the highlighted fields and try again.",
};
