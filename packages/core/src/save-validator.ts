import type { MemoryEntry } from "./memory-entry.js";
import type { ValidationStatus } from "./validation-status.js";

const MAX_CONTENT = 8000;

export interface ValidateSaveInput {
  candidate: MemoryEntry;
  evidenceIds: readonly string[];
  unresolvedSecret: boolean;
}

export interface ValidateSaveResult {
  status: ValidationStatus;
  reasons: readonly string[];
}

function isSafeProjectRelative(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return false;
  if (path.split(/[\\/]/).includes("..")) return false;
  return true;
}

export function validateSave(input: ValidateSaveInput): ValidateSaveResult {
  const { candidate, evidenceIds, unresolvedSecret } = input;
  const reasons: string[] = [];
  const isHuman = candidate.source === "manual";

  // Secret gate first — fail closed, hardest stop.
  if (unresolvedSecret) reasons.push("unresolved_secret");

  // Non-human candidates need at least one evidence reference.
  if (!isHuman && evidenceIds.length === 0) reasons.push("missing_evidence");

  for (const file of candidate.relatedFiles ?? []) {
    if (!isSafeProjectRelative(file)) {
      reasons.push("unsafe_related_file");
      break;
    }
  }

  if (candidate.content.length > MAX_CONTENT) reasons.push("content_too_long");

  // Hard failures first (unchanged): rejected / quarantined short-circuit.
  if (reasons.includes("unresolved_secret") || reasons.includes("unsafe_related_file") || reasons.includes("content_too_long")) {
    return { status: "rejected", reasons };
  }
  if (reasons.includes("missing_evidence")) {
    return { status: "quarantined", reasons };
  }

  // Advisory heuristics — deterministic, downgrade to needs_approval only.
  const advisory: string[] = [];
  if (candidate.confidence === "high" && evidenceIds.length === 0) {
    advisory.push("confidence_exceeds_evidence");
  }
  if (looksLikeTranscriptFragment(candidate.content)) {
    advisory.push("looks_like_transcript_fragment");
  }
  if (advisory.length > 0) {
    return { status: "needs_approval", reasons: advisory };
  }
  return { status: "valid", reasons };
}

// Heuristic: diff/hunk markers or an unbalanced code-symbol density suggest a
// raw transcript fragment rather than a self-contained claim. Deterministic; it
// only routes to human review, never blocks outright (spec §7).
function looksLikeTranscriptFragment(content: string): boolean {
  if (/^@@ -\d/m.test(content)) return true;
  if (/^[+-]\S/m.test(content) && /\n/.test(content)) return true;
  return false;
}
