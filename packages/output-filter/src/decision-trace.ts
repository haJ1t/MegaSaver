import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { backfillEvidenceRecord, evidenceRecordSchema } from "@megasaver/evidence-ledger";
import type { EngineScore } from "./rank.js";
import { readReplayTraces } from "./replay-trace.js";

export type RankedChunkView = {
  startLine: number;
  endLine: number;
  score: number;
  engine: EngineScore;
};

export type DecisionOutput = {
  chunkSetId: string | null;
  toolName: string;
  createdAt: string;
  classification: { category: string; confidence: number };
  decision: string;
  selected: RankedChunkView[];
  omitted: RankedChunkView[];
  memory: { pinnedByMemoryIds: string[] } | null;
  redaction: { redacted: boolean; highRiskFindings: number } | null;
  evidencePresent: boolean;
};

export type SessionDecisionTrace = {
  projectId: string;
  sessionId: string;
  outputs: DecisionOutput[];
};

type JoinedEvidence = {
  pinnedByMemoryIds: string[];
  redaction: { redacted: boolean; highRiskFindings: number };
};

// Index the workspace's evidence records by every chunkSetId they reference —
// both `redactedRawChunkSetId` and each `returnedChunkRefs[].chunkSetId` — so a
// trace's `chunkSetId` joins regardless of which the writer stamped. Synchronous
// (the caller contract is sync) and best-effort: a missing dir, unreadable file,
// or schema-drifted record is skipped, never thrown — evidence is observability,
// so a bad record must degrade to evidencePresent:false, not fail the trace.
function indexEvidenceByChunkSet(
  storeRoot: string,
  workspaceKey: string,
): Map<string, JoinedEvidence> {
  const index = new Map<string, JoinedEvidence>();
  const dir = join(storeRoot, "evidence", workspaceKey);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return index;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = backfillEvidenceRecord(JSON.parse(readFileSync(join(dir, name), "utf8")));
    } catch {
      continue;
    }
    const result = evidenceRecordSchema.safeParse(parsed);
    if (!result.success) continue;
    const rec = result.data;
    const joined: JoinedEvidence = {
      pinnedByMemoryIds: [...rec.pinnedByMemoryIds],
      redaction: {
        redacted: rec.redactionReport.redacted,
        highRiskFindings: rec.redactionReport.highRiskFindings,
      },
    };
    const chunkSetIds = new Set<string>(rec.returnedChunkRefs.map((r) => r.chunkSetId));
    if (rec.redactedRawChunkSetId !== null) chunkSetIds.add(rec.redactedRawChunkSetId);
    for (const cs of chunkSetIds) index.set(cs, joined);
  }
  return index;
}

function toView(c: {
  startLine: number;
  endLine: number;
  score: number;
  engine?: EngineScore | undefined;
}): RankedChunkView {
  return {
    startLine: c.startLine,
    endLine: c.endLine,
    score: c.score,
    engine: c.engine ?? {
      baseRelevance: 0,
      memoryBoost: 0,
      failureHistoryBoost: 0,
      finalScore: c.score,
    },
  };
}

export function readSessionDecisionTrace(
  store: { root: string },
  key: { projectId: string; sessionId: string; workspaceKey: string },
): SessionDecisionTrace {
  const tracePath = join(
    store.root,
    "stats",
    key.projectId,
    `${key.sessionId}-traces`,
    "replay-traces.jsonl",
  );
  const traces = readReplayTraces(tracePath);
  const evidenceByChunkSet = indexEvidenceByChunkSet(store.root, key.workspaceKey);

  const outputs: DecisionOutput[] = traces.map((t) => {
    const ev = t.chunkSetId !== undefined ? evidenceByChunkSet.get(t.chunkSetId) : undefined;
    // Prefer the redaction stamped inline on the registry trace (the seam that
    // actually has it); fall back to the evidence join for overlay-only traces.
    // secretsRedacted maps to highRiskFindings (spec addendum decision 2).
    const redaction = t.redaction
      ? { redacted: t.redaction.redacted, highRiskFindings: t.redaction.secretsRedacted }
      : ev
        ? ev.redaction
        : null;
    return {
      chunkSetId: t.chunkSetId ?? null,
      toolName: t.toolName,
      createdAt: t.createdAt,
      classification: t.ranking.classification,
      decision: t.ranking.decision,
      selected: t.ranking.selected.map(toView),
      omitted: t.ranking.omitted.map(toView),
      memory: ev ? { pinnedByMemoryIds: ev.pinnedByMemoryIds } : null,
      redaction,
      evidencePresent: ev !== undefined || t.redaction !== undefined,
    };
  });

  return { projectId: key.projectId, sessionId: key.sessionId, outputs };
}
