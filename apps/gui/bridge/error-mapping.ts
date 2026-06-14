import type { ServerResponse } from "node:http";
import { ContentStoreError } from "@megasaver/content-store";
import { CorePersistenceError, CoreRegistryError } from "@megasaver/core";
import type { BridgeErrorCode } from "../src/bridge-error-code.js";
import type { SendError } from "./cors.js";

// Sentinel for BB8 setup-op failures (install/repair/uninstall IO). The
// mcp-setup routes wrap any op throw in this so handleCaughtError can map it
// to mcp_setup_failed instead of the generic fs-ErrnoException heuristic.
export class McpSetupError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "McpSetupError";
  }
}

// Map a CoreRegistryError code to a BridgeErrorCode + status. The Core enum
// includes codes that bridge does not surface (project_already_exists,
// session_already_exists, memory_entry_already_exists): these never originate
// from the bridge's request handlers because the bridge generates ids and never
// re-creates known entities. memory_entry_not_found DOES originate now — the
// memory PATCH/DELETE routes target an existing id. Unmapped codes fall through
// to internal_error.
export function mapCoreRegistryError(err: CoreRegistryError): {
  status: number;
  code: BridgeErrorCode;
} | null {
  switch (err.code) {
    case "project_not_found":
      return { status: 404, code: "project_not_found" };
    case "session_not_found":
      return { status: 404, code: "session_not_found" };
    case "session_already_ended":
      return { status: 409, code: "session_already_ended" };
    case "session_project_mismatch":
      return { status: 409, code: "session_project_mismatch" };
    case "memory_entry_not_found":
      return { status: 404, code: "memory_entry_not_found" };
    default:
      return null;
  }
}

export function handleCaughtError(
  res: ServerResponse,
  origin: string | undefined,
  err: unknown,
  sendError: SendError,
): void {
  if (err instanceof CoreRegistryError) {
    const mapped = mapCoreRegistryError(err);
    if (mapped) {
      sendError(res, mapped.status, mapped.code, err.message, origin);
      return;
    }
  }
  if (err instanceof McpSetupError) {
    sendError(res, 500, "mcp_setup_failed", err.message, origin);
    return;
  }
  if (err instanceof CorePersistenceError) {
    sendError(res, 500, "store_write_failed", err.message, origin);
    return;
  }
  // Retention ops (epic 3d) go through @megasaver/content-store. Its failure
  // modes (write_failed / store_corrupt / schema_invalid) are all store IO
  // problems → surface as store_write_failed, mirroring CorePersistenceError.
  if (err instanceof ContentStoreError) {
    sendError(res, 500, "store_write_failed", err.message, origin);
    return;
  }
  // Heuristic: mirror the Node fs ErrnoException shape (EPERM / ENOENT / etc.)
  // as store_write_failed since the handler only reaches this branch on writes.
  if (err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string") {
    const errno = (err as NodeJS.ErrnoException).code as string;
    if (errno.startsWith("E")) {
      sendError(res, 500, "store_write_failed", err.message, origin);
      return;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  sendError(res, 500, "internal_error", message, origin);
}
