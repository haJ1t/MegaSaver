import type { MemoryEntryId } from "@megasaver/shared";
import { checkConflicts } from "./conflict-checker.js";
import { type MemoryEntry, isRecallable } from "./memory-entry.js";
import type { CoreRegistry } from "./registry.js";

// The bi-temporal validTo-close block, extracted verbatim from the approve
// flip (mcp-bridge approve-memory.ts). supersedesId is agent-controlled (the
// schema only checks UUID shape), so the target is validated before closing
// its validity, or an agent could (a) close a CURRENT memory in another
// project/scope it should not touch, or (b) self-reference to close its own
// validity — approved yet instantly non-current, silently vanishing from
// default recall. So close ONLY a different, same-project, same-scope,
// still-open target. Invalid targets skip silently (closed: false) exactly as
// today; the return value makes the outcome disclosable at decision surfaces.
export function applySupersession(
  registry: CoreRegistry,
  entry: MemoryEntry,
  now: () => string,
): { closed: boolean; superseded?: { id: MemoryEntryId; title: string } } {
  if (entry.supersedesId === undefined) return { closed: false };
  const superseded = registry.getMemoryEntry(entry.supersedesId);
  const targetIsValid =
    superseded !== null &&
    superseded.id !== entry.id &&
    superseded.projectId === entry.projectId &&
    superseded.scope === entry.scope &&
    superseded.validTo == null;
  if (!targetIsValid) return { closed: false };
  registry.updateMemoryEntry(superseded.id, {
    validTo: now(),
    updatedAt: now(),
  });
  return { closed: true, superseded: { id: superseded.id, title: superseded.title } };
}

// Single tunable site for all supersession knobs (spec §4.1).
export const SUPERSEDE_TOP_K = 5;
export const SUPERSEDE_COSINE_LINK = 0.8;
export const SUPERSEDE_COSINE_AMBIGUOUS = 0.6;
export const POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:";

export type SupersessionDetection =
  | { kind: "none" }
  | { kind: "duplicate"; existingId: MemoryEntryId }
  | {
      kind: "supersede";
      supersededId: MemoryEntryId;
      via: "supersession" | "contradiction" | "cosine";
      score?: number;
    }
  | { kind: "ambiguous"; possibleIds: readonly MemoryEntryId[] };

// The corpus a candidate may supersede: same project, same type, approved,
// recallable at `now` (current + non-archival), scope-compatible
// (project<->project; session<->same sessionId), never itself.
export function eligibleSupersessionCorpus(
  candidate: MemoryEntry,
  entries: readonly MemoryEntry[],
  now: string,
): MemoryEntry[] {
  return entries.filter(
    (e) =>
      e.id !== candidate.id &&
      e.projectId === candidate.projectId &&
      e.type === candidate.type &&
      e.approval === "approved" &&
      isRecallable(e, now) &&
      (candidate.scope === "session"
        ? e.scope === "session" && e.sessionId === candidate.sessionId
        : e.scope === "project"),
  );
}

// Deterministic decision ladder, first match wins. Pure given inputs: no I/O,
// no wall clock — `now` is threaded explicitly so fixtures ARE the spec.
// Lexical classes come from checkConflicts (precedence-ordered duplicate ->
// supersession -> contradiction). The cosine overlay (opts) is the only
// non-lexical rung and lands in the next commit; `now` and `opts` are part of
// the stable public signature.
export function detectSupersession(
  candidate: MemoryEntry,
  corpus: readonly MemoryEntry[],
  now: string,
  opts?: { queryVector?: Float32Array; memoryVectors?: Map<string, Float32Array> },
): SupersessionDetection {
  const conflict = checkConflicts(candidate, corpus);
  const target = conflict.conflictIds[0];
  if (target !== undefined) {
    if (conflict.outcome === "duplicate") return { kind: "duplicate", existingId: target };
    if (conflict.outcome === "supersession" || conflict.outcome === "contradiction") {
      return { kind: "supersede", supersededId: target, via: conflict.outcome };
    }
  }
  return { kind: "none" };
}
