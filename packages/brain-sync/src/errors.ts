export type BrainSyncErrorCode =
  | "wrong_key"
  | "rollback_detected"
  | "hash_mismatch"
  | "object_missing"
  | "decrypt_failed"
  | "precondition_failed"
  | "sync_conflict"
  | "conditional_writes_unsupported"
  | "bad_recovery_code"
  | "keyfile_missing"
  | "keyfile_invalid"
  | "config_invalid"
  | "manifest_invalid"
  | "insecure_endpoint"
  | "transport_error";

export class BrainSyncError extends Error {
  readonly code: BrainSyncErrorCode;

  constructor(code: BrainSyncErrorCode, message: string) {
    super(message);
    this.name = "BrainSyncError";
    this.code = code;
  }
}
