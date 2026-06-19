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
  for (const f of input.files)
    add({
      id: f.path,
      kind: "file",
      label: f.path.split("/").pop() ?? f.path,
      meta: { path: f.path },
    });
  for (const sym of input.symbols)
    add({ id: sym.symbol, kind: "symbol", label: sym.symbol, meta: {} });
  for (const w of input.wikiPages)
    add({ id: w.path, kind: "wiki", label: w.title, meta: { tags: w.tags, status: w.status } });

  // [[link]] strings can match by full path, path-without-.md, basename, or
  // title. The path keys are unique per page so they always resolve; basename
  // and title can collide across pages, so a shared one resolves to nothing —
  // a missing edge is acceptable, a wrong edge is not.
  const wikiResolve = new Map<string, string>();
  const ambiguous = new Set<string>();
  const addKey = (key: string, path: string, allowAmbiguous: boolean): void => {
    const lo = key.toLowerCase();
    if (
      allowAmbiguous &&
      (ambiguous.has(lo) || (wikiResolve.has(lo) && wikiResolve.get(lo) !== path))
    ) {
      ambiguous.add(lo);
      wikiResolve.delete(lo);
      return;
    }
    if (!ambiguous.has(lo)) wikiResolve.set(lo, path);
  };
  for (const w of input.wikiPages) {
    const p = w.path;
    const withoutMd = p.endsWith(".md") ? p.slice(0, -3) : p;
    addKey(p, p, false);
    addKey(withoutMd, p, false);
    addKey(withoutMd.split("/").pop() ?? withoutMd, p, true);
    addKey(w.title, p, true);
  }
  const resolveWiki = (raw: string): string | undefined => {
    const lo = raw.toLowerCase();
    return wikiResolve.get(lo) ?? wikiResolve.get(`${lo}.md`);
  };

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  // conflict/duplicate are undirected; canonicalize to a sorted pair so a loader
  // emitting both a->b and b->a collapses to one edge. supersede stays directed.
  const undirected = new Set<GraphEdge["kind"]>(["conflict", "duplicate"]);
  const link = (kind: GraphEdge["kind"], from: string, to: string): void => {
    if (!ids.has(from) || !ids.has(to)) return;
    const [a, b] = undirected.has(kind) && from > to ? [to, from] : [from, to];
    const id = `${kind}:${a}->${b}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind, from: a, to: b });
  };

  for (const s of input.sessions) if (s.projectId) link("contains", s.projectId, s.id);
  for (const m of input.memories) {
    if (m.scope === "session" && m.sessionId) link("scope", m.sessionId, m.id);
    else if (m.scope === "project" && m.projectId) link("project-memory", m.projectId, m.id);
    for (const evId of m.evidenceIds) link("cites", m.id, evId);
    for (const fp of m.relatedFiles) link("code-link", m.id, fp);
    for (const sym of m.relatedSymbols) link("code-link", m.id, sym);
  }
  for (const e of input.evidence) {
    if (e.sessionId) link("from-session", e.evidenceId, e.sessionId);
    for (const cs of e.chunkSetIds) link("chunk-of", e.evidenceId, cs);
  }
  for (const c of input.conflicts) link(c.kind, c.from, c.to);
  for (const w of input.wikiPages) {
    for (const lnk of w.links) {
      const resolved = resolveWiki(lnk);
      if (resolved) link("wiki-link", w.path, resolved);
    }
    for (const src of w.sources) {
      const resolved = resolveWiki(src);
      if (resolved) link("wiki-source", w.path, resolved);
    }
    for (const cite of w.fileCites) link("wiki-cite", w.path, cite);
  }

  return { nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length } };
}
