import type { MemoryEntryId } from "@megasaver/shared";
import type { MemoryEntry } from "./memory-entry.js";

export type ConflictOutcome = "duplicate" | "supersession" | "contradiction" | "unrelated";

export interface ConflictResult {
  outcome: ConflictOutcome;
  conflictIds: readonly MemoryEntryId[];
  reasons: readonly string[];
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function fileOverlap(a: MemoryEntry, b: MemoryEntry): boolean {
  const fa = new Set(a.relatedFiles ?? []);
  return (b.relatedFiles ?? []).some((f) => fa.has(f));
}

export function checkConflicts(
  candidate: MemoryEntry,
  approvedActive: readonly MemoryEntry[],
): ConflictResult {
  const candContent = norm(candidate.content);
  const candTitle = norm(candidate.title);

  // 1) exact duplicate: identical normalized title+content.
  const dup = approvedActive.find(
    (m) => norm(m.content) === candContent && norm(m.title) === candTitle,
  );
  if (dup) return { outcome: "duplicate", conflictIds: [dup.id], reasons: ["exact_duplicate"] };

  // 2) supersession: same type + overlapping files, different conclusion.
  const supersede = approvedActive.find(
    (m) =>
      m.type === candidate.type && fileOverlap(m, candidate) && norm(m.content) !== candContent,
  );
  if (supersede) {
    return {
      outcome: "supersession",
      conflictIds: [supersede.id],
      reasons: ["same_scope_different_conclusion"],
    };
  }

  // 3) contradiction: project_rule with overlapping files/keywords but a
  // negation-bearing keyword set divergence. Heuristic → quarantine upstream.
  const NEGATIONS = new Set(["skip", "without", "no", "never", "disable"]);
  const candNeg = candidate.keywords.some((k) => NEGATIONS.has(k.toLowerCase()));
  const contra = approvedActive.find(
    (m) =>
      (m.type === "project_rule" || candidate.type === "project_rule") &&
      fileOverlap(m, candidate) &&
      candNeg !== m.keywords.some((k) => NEGATIONS.has(k.toLowerCase())),
  );
  if (contra)
    return {
      outcome: "contradiction",
      conflictIds: [contra.id],
      reasons: ["rule_polarity_divergence"],
    };

  return { outcome: "unrelated", conflictIds: [], reasons: [] };
}
