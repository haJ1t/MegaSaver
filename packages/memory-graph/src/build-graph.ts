import type { GraphInput } from "./inputs.js";
import type { Graph, GraphEdge, GraphNode } from "./model.js";

// File-node ids must agree across both referrers. Wiki fileCites arrive already
// './'-stripped from parseWikiPage, but memory relatedFiles are pre-validated
// data the leaf passes through verbatim — so strip './' here, the one choke
// point both paths cross, to keep './x' and 'x' a single shared file node.
const canonFilePath = (p: string): string => (p.startsWith("./") ? p.slice(2) : p);

// file/symbol/wiki ids derive from free-form strings (paths, symbol names, wiki
// page paths) that can collide across kinds — a bare module name 'foo' as both a
// path and a symbol. Kind-prefix their node ids so the three id spaces stay
// disjoint; without it two distinct nodes silently merge and one of their edges,
// sharing an id, is dropped by the seen guard.
const fileId = (path: string): string => `file:${canonFilePath(path)}`;
const symbolId = (symbol: string): string => `symbol:${symbol}`;
const wikiId = (path: string): string => `wiki:${path}`;

// Entity ids share the symbol/file string spaces but are a SEPARATE node kind
// (aggregation across memories), so they get their own kind-prefix to stay
// disjoint from the code-link file:/symbol: nodes. Mirrors the prefixing above.
const symbolEntityId = (symbol: string): string => `entity:symbol:${symbol}`;
const fileEntityId = (path: string): string => `entity:file:${canonFilePath(path)}`;

export function buildGraph(input: GraphInput): Graph {
  const nodes: GraphNode[] = [];
  const ids = new Set<string>();
  // A .md path cited as a file and a wiki page at that same path produce two
  // nodes (file:<path> and wiki:<path>) — distinct kinds, distinct ids. Within
  // one kind, repeats are deduped first-writer-wins.
  const add = (n: GraphNode): void => {
    if (ids.has(n.id)) return;
    nodes.push(n);
    ids.add(n.id);
  };

  for (const p of input.projects) add({ id: p.id, kind: "project", label: p.name, meta: {} });
  for (const s of input.sessions)
    add({ id: s.id, kind: "session", label: s.id.slice(0, 8), meta: { projectId: s.projectId } });
  for (const m of input.memories) {
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
    // Deterministic entity extraction (NO LLM): each relatedSymbol/relatedFile is
    // an entity a memory mentions. Dedup is first-writer-wins via `add`, so an
    // entity shared by N memories is one node aggregating N entity-mention edges.
    for (const sym of m.relatedSymbols)
      add({ id: symbolEntityId(sym), kind: "entity", label: sym, meta: { entityKind: "symbol" } });
    for (const fp of m.relatedFiles)
      add({
        id: fileEntityId(fp),
        kind: "entity",
        label: canonFilePath(fp),
        meta: { entityKind: "file" },
      });
  }
  for (const e of input.evidence)
    add({
      id: e.evidenceId,
      kind: "evidence",
      label: `${e.sourceKind} ${e.evidenceId.slice(0, 6)}`,
      meta: { status: e.status },
    });
  for (const c of input.chunkSets)
    add({ id: c.chunkSetId, kind: "chunkset", label: c.label, meta: { redacted: c.redacted } });
  for (const w of input.wikiPages)
    add({
      id: wikiId(w.path),
      kind: "wiki",
      label: w.title,
      meta: { tags: w.tags, status: w.status },
    });
  for (const f of input.files) {
    const path = canonFilePath(f.path);
    add({ id: fileId(f.path), kind: "file", label: path.split("/").pop() ?? path, meta: { path } });
  }
  for (const sym of input.symbols)
    add({ id: symbolId(sym.symbol), kind: "symbol", label: sym.symbol, meta: {} });

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
    for (const fp of m.relatedFiles) link("code-link", m.id, fileId(fp));
    for (const sym of m.relatedSymbols) link("code-link", m.id, symbolId(sym));
    for (const sym of m.relatedSymbols) link("entity-mention", m.id, symbolEntityId(sym));
    for (const fp of m.relatedFiles) link("entity-mention", m.id, fileEntityId(fp));
  }
  for (const e of input.evidence) {
    if (e.sessionId) link("from-session", e.evidenceId, e.sessionId);
    for (const cs of e.chunkSetIds) link("chunk-of", e.evidenceId, cs);
  }
  for (const c of input.conflicts) link(c.kind, c.from, c.to);
  for (const w of input.wikiPages) {
    for (const lnk of w.links) {
      const resolved = resolveWiki(lnk);
      if (resolved) link("wiki-link", wikiId(w.path), wikiId(resolved));
    }
    for (const src of w.sources) {
      const resolved = resolveWiki(src);
      if (resolved) link("wiki-source", wikiId(w.path), wikiId(resolved));
    }
    for (const cite of w.fileCites) link("wiki-cite", wikiId(w.path), fileId(cite));
  }

  return { nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length } };
}
