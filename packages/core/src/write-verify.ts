import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { type ConflictCandidate, checkConflicts } from "./conflict-checker.js";
import type { MemoryApproval, MemoryConfidence } from "./memory-entry.js";

export type { ConflictCandidate } from "./conflict-checker.js";

export const POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:";
const CHUNK_SET_POINTER = /^cs-[0-9a-f]{32}$/;
const CONFIDENCE_RANK: Record<MemoryConfidence, number> = { low: 0, medium: 1, high: 2 };

export const writeVerifyOutcomeSchema = z.enum(["verified", "partial", "unverified"]);
export type WriteVerifyOutcome = z.infer<typeof writeVerifyOutcomeSchema>;

export type EvidencePointerKind = "lineage_note" | "chunk_set" | "ledger";

export type PointerResolution = {
  pointer: string;
  kind: Exclude<EvidencePointerKind, "lineage_note">;
  resolved: boolean;
  reason?: string;
};

export type WriteResolution = {
  resolutions: readonly PointerResolution[];
  unresolvedSecret: boolean;
  hasRevoked: boolean;
  hasCrossWorkspace: boolean;
  resolverUnavailable: boolean;
};

export type WriteVerifyInput = {
  candidate: ConflictCandidate;
  callerConfidence: MemoryConfidence;
  callerApproval: MemoryApproval;
  approvedActive: readonly ConflictCandidate[];
  resolution: WriteResolution;
  droppedCitedFiles: readonly string[];
};

export type WriteVerifyVerdict = {
  outcome: WriteVerifyOutcome;
  reasons: readonly string[];
  confidence: MemoryConfidence;
  approval: MemoryApproval;
  validationStatus: "valid" | "needs_approval" | "quarantined";
  conflictIds: readonly MemoryEntryId[];
};

export const WRITE_VERIFY_CONFIDENCE_CAP: Record<WriteVerifyOutcome, MemoryConfidence> = {
  verified: "high",
  partial: "medium",
  unverified: "low",
};

const SIDECAR_STATUS = {
  verified: "valid",
  partial: "needs_approval",
  unverified: "quarantined",
} as const;

export function minConfidence(a: MemoryConfidence, b: MemoryConfidence): MemoryConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function classifyEvidencePointer(evidence: string): EvidencePointerKind {
  if (evidence.startsWith(POSSIBLE_SUPERSEDES_PREFIX)) return "lineage_note";
  if (CHUNK_SET_POINTER.test(evidence)) return "chunk_set";
  return "ledger";
}

export function verifyMemoryWrite(input: WriteVerifyInput): WriteVerifyVerdict {
  const conflict = checkConflicts(input.candidate, input.approvedActive);
  const r = input.resolution;
  const reasons: string[] = [];
  if (r.unresolvedSecret) reasons.push("unresolved_secret");
  if (r.hasRevoked) reasons.push("revoked_evidence");
  if (r.hasCrossWorkspace) reasons.push("cross_workspace_evidence");
  if (conflict.outcome === "contradiction") {
    reasons.push("conflict_contradiction", ...conflict.reasons);
  }
  const hardFlagged = reasons.length > 0 || r.resolverUnavailable;
  if (r.resolverUnavailable) reasons.push("resolver_unavailable");
  for (const p of r.resolutions) {
    if (!p.resolved) reasons.push(p.reason ?? `unresolved:${p.pointer}`);
  }
  for (const f of input.droppedCitedFiles) reasons.push(`anchor_dropped:${f}`);
  if (r.resolutions.length === 0) reasons.push("zero_evidence_pointers");

  const resolvedCount = r.resolutions.filter((p) => p.resolved).length;
  const outcome: WriteVerifyOutcome = hardFlagged
    ? "unverified"
    : r.resolutions.length > 0 &&
        resolvedCount === r.resolutions.length &&
        input.droppedCitedFiles.length === 0
      ? "verified"
      : resolvedCount >= 1
        ? "partial"
        : "unverified";
  return {
    outcome,
    reasons,
    confidence: minConfidence(input.callerConfidence, WRITE_VERIFY_CONFIDENCE_CAP[outcome]),
    approval: outcome === "verified" ? input.callerApproval : "suggested",
    validationStatus: SIDECAR_STATUS[outcome],
    conflictIds: conflict.outcome === "contradiction" ? conflict.conflictIds : [],
  };
}

export const WRITE_VERIFY_DEFAULT_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
export function defaultWriteExpiresAt(createdAt: string): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at))
    throw new TypeError(`defaultWriteExpiresAt: invalid createdAt: ${createdAt}`);
  return new Date(at + WRITE_VERIFY_DEFAULT_TTL_DAYS * DAY_MS).toISOString();
}

export const ruleVerificationSchema = z
  .object({
    outcome: writeVerifyOutcomeSchema,
    reasons: z.array(z.string()),
    verifiedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RuleVerification = z.infer<typeof ruleVerificationSchema>;
