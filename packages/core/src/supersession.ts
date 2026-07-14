import { cosine } from "@megasaver/embeddings";
import type { MemoryEntryId } from "@megasaver/shared";
import { checkConflicts } from "./conflict-checker.js";
import { type MemoryEntry, isRecallable } from "./memory-entry.js";
import { searchMemoryEntries } from "./memory-search.js";
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
// supersession -> contradiction). Cosine overlay only when the caller injects
// a queryVector (embedding is the caller's async boundary, mirroring
// searchMemoryEntriesSemantic): pool = BM25 top-K over the corpus, link
// target = MAX RAW COSINE over the pool — NOT the weighted BM25 #1, whose
// effectiveConfidence weighting can rank a fresher, less-similar row above
// the true stale predecessor. No BM25-only auto-link: BM25 scores are
// unnormalized; the 0.60/0.80 bands are cosine bands.
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

  const queryVector = opts?.queryVector;
  if (queryVector === undefined) return { kind: "none" };
  const memoryVectors = opts?.memoryVectors ?? new Map<string, Float32Array>();

  const pool = searchMemoryEntries(corpus, {
    text: `${candidate.title} ${candidate.content}`,
    asOf: now,
    limit: SUPERSEDE_TOP_K,
  });

  let best: { id: MemoryEntryId; score: number } | undefined;
  for (const entry of pool) {
    const vector = memoryVectors.get(entry.id);
    if (vector === undefined) continue;
    const score = cosine(queryVector, vector);
    if (best === undefined || score > best.score) best = { id: entry.id, score };
  }
  if (best === undefined) return { kind: "none" };
  if (best.score >= SUPERSEDE_COSINE_LINK) {
    return { kind: "supersede", supersededId: best.id, via: "cosine", score: best.score };
  }
  if (best.score >= SUPERSEDE_COSINE_AMBIGUOUS) {
    return { kind: "ambiguous", possibleIds: [best.id] };
  }
  return { kind: "none" };
}

// Chain oldest -> newest: ancestors via the supersedesId walk, then the entry,
// then descendants via one linear scan building a supersedesId -> first-child
// map (first child per parent by createdAt asc, stable by id). No new index,
// no back-pointer field. supersedesId is agent-controlled data, so both walks
// are cycle-guarded by a shared visited set — a forged chain must not hang
// the CLI.
export function buildLineage(entries: readonly MemoryEntry[], id: MemoryEntryId): MemoryEntry[] {
  const byId = new Map<string, MemoryEntry>(entries.map((e) => [e.id, e]));
  const self = byId.get(id);
  if (self === undefined) return [];

  const visited = new Set<string>([self.id]);

  const ancestors: MemoryEntry[] = [];
  let ancestor = self.supersedesId !== undefined ? byId.get(self.supersedesId) : undefined;
  while (ancestor !== undefined && !visited.has(ancestor.id)) {
    visited.add(ancestor.id);
    ancestors.unshift(ancestor);
    ancestor = ancestor.supersedesId !== undefined ? byId.get(ancestor.supersedesId) : undefined;
  }

  const childOf = new Map<string, MemoryEntry>();
  for (const e of entries) {
    if (e.supersedesId === undefined) continue;
    const prev = childOf.get(e.supersedesId);
    if (
      prev === undefined ||
      e.createdAt < prev.createdAt ||
      (e.createdAt === prev.createdAt && e.id < prev.id)
    ) {
      childOf.set(e.supersedesId, e);
    }
  }

  const descendants: MemoryEntry[] = [];
  let child = childOf.get(self.id);
  while (child !== undefined && !visited.has(child.id)) {
    visited.add(child.id);
    descendants.push(child);
    child = childOf.get(child.id);
  }

  return [...ancestors, self, ...descendants];
}

export type ChangedFrom = { title: string; closedAt: string; reason?: string };

// Recall enrichment: immediate predecessor only (never the chain — token
// discipline). A reopened predecessor (validTo back to null) suppresses the
// line: the row is current again, so "changed from" would be a lie.
export function changedFromFor(
  hit: Pick<MemoryEntry, "supersedesId" | "reason">,
  byId: ReadonlyMap<string, MemoryEntry>,
): ChangedFrom | undefined {
  if (hit.supersedesId === undefined) return undefined;
  const predecessor = byId.get(hit.supersedesId);
  if (predecessor === undefined || predecessor.validTo == null) return undefined;
  const reason = hit.reason ?? predecessor.reason;
  return {
    title: predecessor.title,
    closedAt: predecessor.validTo,
    ...(reason !== undefined ? { reason } : {}),
  };
}

export type SaveMemoryLineageResult = {
  entry: MemoryEntry; // written row, or the existing row when deduped
  supersession?: {
    supersededId: MemoryEntryId;
    // "explicit" = caller-supplied supersedesId (no detection ran)
    via: "supersession" | "contradiction" | "cosine" | "explicit";
    score?: number;
    closed: boolean;
  };
  deduped?: { existingId: MemoryEntryId };
};

function withEvidenceNotes(entry: MemoryEntry, notes: readonly string[]): MemoryEntry {
  return { ...entry, evidence: [...(entry.evidence ?? []), ...notes] };
}

// The single write path for lineage-aware memory saves (spec §4.2). All entry
// mutation (supersedesId, evidence) happens BEFORE createMemoryEntry — both
// fields are create-time-immutable afterwards. The close ladder (architect
// #3): a weak lexical heuristic must never close at save time — suggested
// rows carry the link and close at approval; born-approved rows close at save
// only when `opts.allowImmediateClose` is set. That flag is the trust gate:
// approval alone is NOT proof of a human decision because save_memory lets an
// agent forge `approval:"approved"` (spec §9.1). Only physically human-typed
// surfaces (CLI `memory create`, `task status --save-summary`) pass it; agent
// saves never immediately close — the link is still written and the close
// defers to the human `approve_memory` gate (safe degradation, lineage kept).
export function saveMemoryWithLineage(
  registry: CoreRegistry,
  entry: MemoryEntry,
  opts: {
    now: () => string;
    detect?: boolean; // default true
    queryVector?: Float32Array;
    memoryVectors?: Map<string, Float32Array>;
    allowImmediateClose?: boolean; // default false — see the trust-gate note above
  },
): SaveMemoryLineageResult {
  // Explicit supersedesId beats detection: the caller declared the target, so
  // detection must not second-guess (or dedupe away) the write. Born-approved
  // closes immediately only when the caller is a trusted human surface;
  // otherwise the link is written and the close defers (close fires at approval).
  if (entry.supersedesId !== undefined) {
    const created = registry.createMemoryEntry(entry);
    if (created.approval !== "approved" || opts.allowImmediateClose !== true) {
      return { entry: created };
    }
    const applied = applySupersession(registry, created, opts.now);
    return {
      entry: created,
      supersession: {
        supersededId: entry.supersedesId,
        via: "explicit",
        closed: applied.closed,
      },
    };
  }
  if (opts.detect === false) return { entry: registry.createMemoryEntry(entry) };

  let detection: SupersessionDetection;
  try {
    const now = opts.now();
    const corpus = eligibleSupersessionCorpus(
      entry,
      registry.listMemoryEntries(entry.projectId),
      now,
    );
    detection = detectSupersession(entry, corpus, now, {
      ...(opts.queryVector !== undefined ? { queryVector: opts.queryVector } : {}),
      ...(opts.memoryVectors !== undefined ? { memoryVectors: opts.memoryVectors } : {}),
    });
  } catch {
    // Fail-open (spec §7): detection must never block a save.
    return { entry: registry.createMemoryEntry(entry) };
  }

  if (detection.kind === "duplicate") {
    const existing = registry.getMemoryEntry(detection.existingId);
    // Detection ids come from this registry's live corpus; null means a
    // racing delete — fail open with a plain create rather than lose the write.
    if (existing === null) return { entry: registry.createMemoryEntry(entry) };
    return { entry: existing, deduped: { existingId: detection.existingId } };
  }

  if (detection.kind === "supersede") {
    const { supersededId, via } = detection;
    if (entry.approval !== "approved") {
      const created = registry.createMemoryEntry({ ...entry, supersedesId: supersededId });
      return {
        entry: created,
        supersession: {
          supersededId,
          via,
          ...(detection.score !== undefined ? { score: detection.score } : {}),
          closed: false,
        },
      };
    }
    if (via === "supersession") {
      // Born-approved + weak lexical class (mere file overlap + different
      // content): downgraded to the ambiguous treatment — evidence note only,
      // no link, no close (architect #3).
      const created = registry.createMemoryEntry(
        withEvidenceNotes(entry, [`${POSSIBLE_SUPERSEDES_PREFIX}${supersededId}`]),
      );
      return { entry: created };
    }
    const created = registry.createMemoryEntry({ ...entry, supersedesId: supersededId });
    // Trust gate (spec §9.1): a born-approved detected close fires only from a
    // human surface. An agent's forged approval keeps the link but defers the
    // close — the row degrades to suggested behavior (link + closed:false).
    const applied =
      opts.allowImmediateClose === true
        ? applySupersession(registry, created, opts.now)
        : { closed: false as const };
    return {
      entry: created,
      supersession: {
        supersededId,
        via,
        ...(detection.score !== undefined ? { score: detection.score } : {}),
        closed: applied.closed,
      },
    };
  }

  if (detection.kind === "ambiguous") {
    const created = registry.createMemoryEntry(
      withEvidenceNotes(
        entry,
        detection.possibleIds.map((id) => `${POSSIBLE_SUPERSEDES_PREFIX}${id}`),
      ),
    );
    return { entry: created };
  }

  return { entry: registry.createMemoryEntry(entry) };
}
