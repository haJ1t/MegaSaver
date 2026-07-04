import type {
  DecisionTraceData,
  DecisionTraceEdge,
  DecisionTraceNode,
  SessionDecisionTrace,
} from "./decision-trace-client.js";

// Project a SessionDecisionTrace into a Cytoscape-ready graph. Per output:
//   output node (tool + decision) — chunk node per selected chunk —
//   memory node per pinned memory (deduped across outputs) —
//   redaction node iff the joined evidence was redacted.
// Edges: output→chunk (ranked), memory→output (pinned), output→redaction (redacted).
export function toDecisionGraph(trace: SessionDecisionTrace): DecisionTraceData {
  const nodes: DecisionTraceNode[] = [];
  const edges: DecisionTraceEdge[] = [];
  // A memory can pin several outputs; it must resolve to ONE node. The set both
  // dedupes the node and is the authoritative memoriesPinned count.
  const memoryIds = new Set<string>();
  let chunkCount = 0;

  trace.outputs.forEach((output, outputIndex) => {
    const outputId = `output:${outputIndex}`;
    nodes.push({
      id: outputId,
      kind: "output",
      label: `${output.toolName} → ${output.decision}`,
      meta: {
        toolName: output.toolName,
        decision: output.decision,
        category: output.classification.category,
        ...(output.chunkSetId !== null ? { chunkSetId: output.chunkSetId } : {}),
      },
    });

    output.selected.forEach((chunk, chunkIndex) => {
      const chunkId = `chunk:${outputIndex}:${chunkIndex}`;
      nodes.push({
        id: chunkId,
        kind: "chunk",
        label: `lines ${chunk.startLine}-${chunk.endLine}`,
        meta: {
          score: chunk.score,
          baseRelevance: chunk.engine.baseRelevance,
          memoryBoost: chunk.engine.memoryBoost,
          failureHistoryBoost: chunk.engine.failureHistoryBoost,
          finalScore: chunk.engine.finalScore,
        },
      });
      edges.push({ source: outputId, target: chunkId, kind: "ranked" });
      chunkCount += 1;
    });

    for (const memoryId of output.memory?.rankedByMemoryIds ?? []) {
      if (!memoryIds.has(memoryId)) {
        memoryIds.add(memoryId);
        nodes.push({ id: memoryId, kind: "memory", label: memoryId, meta: {} });
      }
      edges.push({ source: memoryId, target: outputId, kind: "pinned" });
    }

    if (output.redaction?.redacted === true) {
      const redactionId = `redaction:${outputIndex}`;
      nodes.push({
        id: redactionId,
        kind: "redaction",
        label: `${output.redaction.highRiskFindings} high-risk`,
        meta: { highRiskFindings: output.redaction.highRiskFindings },
      });
      edges.push({ source: outputId, target: redactionId, kind: "redacted" });
    }
  });

  return {
    nodes,
    edges,
    stats: {
      outputs: trace.outputs.length,
      chunks: chunkCount,
      memoriesPinned: memoryIds.size,
    },
  };
}
