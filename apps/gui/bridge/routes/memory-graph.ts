import {
  type MemoryEntry,
  type OverlayMemoryEntry,
  checkConflicts,
  readOverlayMemory,
} from "@megasaver/core";
import { listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import type {
  ChunkSetInput,
  ConflictPair,
  EvidenceInput,
  GraphInput,
  MemoryInput,
  SessionInput,
} from "@megasaver/memory-graph";
import { buildGraph } from "@megasaver/memory-graph";
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

// Map an OverlayMemoryEntry to the MemoryEntry shape required by checkConflicts.
// checkConflicts reads id/type/content/title and — load-bearing — keywords
// (negation set in contradiction) and relatedFiles (fileOverlap in supersession
// and contradiction); all are forwarded verbatim. The (projectId, sessionId) FK
// pair is NOT read by checkConflicts, so we supply placeholder values purely to
// satisfy the MemoryEntry type without affecting conflict logic.
function toConflictEntry(entry: OverlayMemoryEntry): MemoryEntry {
  return {
    id: entry.id,
    projectId: "overlay" as MemoryEntry["projectId"],
    sessionId: null,
    scope: entry.scope,
    type: entry.type,
    title: entry.title,
    content: entry.content,
    keywords: entry.keywords,
    confidence: entry.confidence,
    source: entry.source,
    approval: entry.approval,
    stale: entry.stale,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
    ...(entry.goal !== undefined ? { goal: entry.goal } : {}),
    ...(entry.evidence !== undefined ? { evidence: entry.evidence } : {}),
    ...(entry.relatedFiles !== undefined ? { relatedFiles: entry.relatedFiles } : {}),
    ...(entry.relatedSymbols !== undefined ? { relatedSymbols: entry.relatedSymbols } : {}),
    ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
  };
}

async function loadGraphInput(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string | null,
): Promise<GraphInput> {
  const overlayEntries = readOverlayMemory(storeRoot, workspaceKey);
  const evidenceRecords = await listEvidenceByWorkspace({ storeRoot, workspaceKey });

  const memories: MemoryInput[] = overlayEntries.map((entry) => ({
    id: entry.id,
    scope: entry.scope,
    sessionId: entry.liveSessionId,
    projectId: null,
    memoryType: entry.type,
    title: entry.title,
    approval: entry.approval,
    confidence: entry.confidence,
    source: entry.source,
    stale: entry.stale,
    evidenceIds: entry.evidence ?? [],
  }));

  const evidence: EvidenceInput[] = evidenceRecords.map((rec) => ({
    evidenceId: rec.evidenceId,
    sourceKind: rec.sourceKind,
    sessionId: rec.sessionRef?.id ?? null,
    chunkSetIds: [
      ...rec.returnedChunkRefs.map((r) => r.chunkSetId),
      ...(rec.redactedRawChunkSetId !== null ? [rec.redactedRawChunkSetId] : []),
    ],
    status: rec.status,
  }));

  // Collect unique chunkSetIds from evidence records.
  const chunkSetIdSet = new Set<string>();
  for (const ev of evidenceRecords) {
    for (const r of ev.returnedChunkRefs) chunkSetIdSet.add(r.chunkSetId);
    if (ev.redactedRawChunkSetId !== null) chunkSetIdSet.add(ev.redactedRawChunkSetId);
  }
  const chunkSets: ChunkSetInput[] = Array.from(chunkSetIdSet).map((csId) => ({
    chunkSetId: csId,
    label: csId.slice(0, 8),
    redacted: true,
  }));

  const sessionId = liveSessionId ?? "live";
  const sessions: SessionInput[] = [{ id: sessionId, projectId: null }];

  // Run conflict detection over approved, non-stale overlay entries only.
  const approvedActive = overlayEntries.filter((e) => e.approval === "approved" && !e.stale);
  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < approvedActive.length; i++) {
    const candidate = approvedActive[i] as OverlayMemoryEntry;
    const prior = approvedActive.slice(0, i).map(toConflictEntry);
    if (prior.length === 0) continue;
    const result = checkConflicts(toConflictEntry(candidate), prior);
    if (result.outcome === "unrelated") continue;
    const kindMap: Record<"duplicate" | "supersession" | "contradiction", ConflictPair["kind"]> = {
      duplicate: "duplicate",
      supersession: "supersede",
      contradiction: "conflict",
    };
    for (const conflictId of result.conflictIds) {
      conflicts.push({
        from: candidate.id,
        to: conflictId,
        kind: kindMap[result.outcome as "duplicate" | "supersession" | "contradiction"],
      });
    }
  }

  return {
    projects: [],
    sessions,
    memories,
    evidence,
    chunkSets,
    conflicts,
  };
}

export async function handleGetMemoryGraph(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") {
    sendSessionResolveError(ctx, resolved, dir, id);
    return;
  }
  try {
    const input = await loadGraphInput(
      ctx.storeRoot,
      resolved.workspaceKey,
      resolved.liveSessionId,
    );
    const graph = buildGraph(input);
    ctx.sendJson(ctx.res, 200, graph, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
