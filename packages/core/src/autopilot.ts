import type { MemoryConfidence } from "./memory-entry.js";
import type { ExtractedCandidate } from "./session-memory.js";

export type ScoreSignals = { priorSessionHit: boolean };

// Deterministic rule table (spec §5.1) — no LLM, no clock, no I/O.
// priorSessionHit (computed by the caller): this candidate's contentHash also
// appeared among candidates extracted from a DIFFERENT session's failures.
// M2 dampener: `occurrences` (within-session repetition) is deliberately NOT
// an input — a retry storm inside one session must never auto-approve.
// The applied rule id is recorded in provenance evidence by runAutopilot.
export function scoreCandidate(
  candidate: ExtractedCandidate,
  signals: ScoreSignals,
): MemoryConfidence {
  const failureDerived = candidate.type === "bug" || candidate.type === "test_behavior";
  if (failureDerived && signals.priorSessionHit) return "high";
  // "high" is the auto-approval score and this rule table is its only gate, so
  // the non-recurring branch clamps it away: the guarantee must hold here
  // structurally, not depend on the extractor hardcoding `confidence: "low"`.
  return candidate.confidence === "high" ? "medium" : candidate.confidence;
}
