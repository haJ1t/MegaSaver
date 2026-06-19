import type { GraphInput } from "./inputs.js";
import type { Graph, GraphEdge, GraphNode } from "./model.js";

export function buildGraph(input: GraphInput): Graph {
  const nodes: GraphNode[] = [];
  const ids = new Set<string>();
  const add = (n: GraphNode): void => {
    nodes.push(n);
    ids.add(n.id);
  };

  for (const p of input.projects) add({ id: p.id, kind: "project", label: p.name, meta: {} });
  for (const s of input.sessions)
    add({ id: s.id, kind: "session", label: s.id.slice(0, 8), meta: { projectId: s.projectId } });
  for (const m of input.memories)
    add({
      id: m.id,
      kind: "memory",
      label: m.title,
      meta: {
        memoryType: m.memoryType,
        approval: m.approval,
        confidence: m.confidence,
        source: m.source,
        scope: m.scope,
        stale: m.stale,
      },
    });
  for (const e of input.evidence)
    add({
      id: e.evidenceId,
      kind: "evidence",
      label: `${e.sourceKind} ${e.evidenceId.slice(0, 6)}`,
      meta: { status: e.status },
    });
  for (const c of input.chunkSets)
    add({ id: c.chunkSetId, kind: "chunkset", label: c.label, meta: { redacted: c.redacted } });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const link = (kind: GraphEdge["kind"], from: string, to: string): void => {
    if (!ids.has(from) || !ids.has(to)) return;
    const id = `${kind}:${from}->${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind, from, to });
  };

  for (const s of input.sessions) if (s.projectId) link("contains", s.projectId, s.id);
  for (const m of input.memories) {
    if (m.scope === "session" && m.sessionId) link("scope", m.sessionId, m.id);
    else if (m.scope === "project" && m.projectId) link("project-memory", m.projectId, m.id);
    for (const evId of m.evidenceIds) link("cites", m.id, evId);
  }
  for (const e of input.evidence) {
    if (e.sessionId) link("from-session", e.evidenceId, e.sessionId);
    for (const cs of e.chunkSetIds) link("chunk-of", e.evidenceId, cs);
  }
  for (const c of input.conflicts) link(c.kind, c.from, c.to);

  return { nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length } };
}
