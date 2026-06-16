import { z } from "zod";

export const sourceKindSchema = z.enum([
  "file",
  "command",
  "grep",
  "fetch",
  "hook",
  "manual",
  "agent_request",
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const retentionClassSchema = z.enum(["transient", "session", "pinned", "manual_hold"]);
export type RetentionClass = z.infer<typeof retentionClassSchema>;

export const evidenceStatusSchema = z.enum(["available", "retained_metadata_only", "revoked"]);
export type EvidenceStatus = z.infer<typeof evidenceStatusSchema>;

// Revoked-only. GC produces `retained_metadata_only` WITHOUT a revocationReason,
// so `retention_gc` is intentionally NOT a member (spec §3 invariant).
export const revocationReasonSchema = z.enum([
  "secret_false_negative",
  "user_requested_purge",
  "policy_change",
]);
export type RevocationReason = z.infer<typeof revocationReasonSchema>;

export const transitionKindSchema = z.enum(["created", "pinned", "unpinned", "revoked", "raw_gc"]);
export type TransitionKind = z.infer<typeof transitionKindSchema>;
