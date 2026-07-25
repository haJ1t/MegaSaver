import type { MemoryEntry } from "./memory-entry.js";

export type VerificationBadge = "verified" | "contradicted-by-code" | "unanchored";

// FREE badge from STORED state only (spec §8.6): the anchor decides
// anchored/unanchored; a stored contradiction wins over everything else. An
// anchored row with no stored contradiction reads "verified" — the badge
// claims "anchored, no known contradiction", never a live check.
export function verificationBadgeFor(entry: MemoryEntry): VerificationBadge {
  if (entry.anchor === undefined) return "unanchored";
  if (entry.lastVerified?.result === "contradicted") return "contradicted-by-code";
  return "verified";
}
