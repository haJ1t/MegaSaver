import type { ServerResponse } from "node:http";
import { BrainSyncError } from "@megasaver/brain-sync";
import { ConnectorError } from "@megasaver/connectors-shared";
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

export function mapBrainSyncError(err: BrainSyncError): {
  status: number;
  code: BridgeErrorCode;
} {
  switch (err.code) {
    case "bad_recovery_code":
      return { status: 400, code: "bad_recovery_code" };
    case "config_invalid":
      return { status: 400, code: "config_invalid" };
    case "keyfile_missing":
      return { status: 404, code: "keyfile_missing" };
    case "keyfile_invalid":
      return { status: 500, code: "keyfile_invalid" };
    case "manifest_invalid":
      return { status: 500, code: "manifest_invalid" };
    case "insecure_endpoint":
      return { status: 400, code: "insecure_endpoint" };
    case "transport_error":
      return { status: 502, code: "transport_error" };
    case "decrypt_failed":
      return { status: 500, code: "decrypt_failed" };
    case "wrong_key":
      return { status: 400, code: "wrong_key" };
    case "hash_mismatch":
      return { status: 500, code: "hash_mismatch" };
    case "object_missing":
      return { status: 404, code: "object_missing" };
    case "precondition_failed":
      return { status: 412, code: "precondition_failed" };
    case "rollback_detected":
      return { status: 409, code: "rollback_detected" };
    case "sync_conflict":
      return { status: 409, code: "sync_conflict" };
    case "conditional_writes_unsupported":
      return { status: 400, code: "conditional_writes_unsupported" };
    default:
      return { status: 500, code: "internal_error" };
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
  if (err instanceof BrainSyncError) {
    const mapped = mapBrainSyncError(err);
    sendError(res, mapped.status, mapped.code, err.message, origin);
    return;
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
  // connectors-shared file ops (CLAUDE.md upsert on the workspace token-saver
  // route): symlink refusal, tmp-write/rename failure, read failure. Caught here
  // explicitly — BEFORE the errno heuristic below — so the safety-relevant
  // symlink refusal gets a clear code, and a future ConnectorError code starting
  // with "E" can never be misrouted by that heuristic. The message carries no
  // path (it lives on the error's filePath field, not .message) and no stack.
  if (err instanceof ConnectorError) {
    sendError(res, 500, "connector_write_failed", err.message, origin);
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
