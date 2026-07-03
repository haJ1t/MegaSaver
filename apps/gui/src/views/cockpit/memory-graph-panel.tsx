import cytoscape from "cytoscape";
import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type MemoryGraphData,
  type MemoryGraphNode,
  fetchSessionMemoryGraph,
} from "../../lib/claude-sessions-client.js";

// Node-kind palette. Memory nodes are colored by `meta.memoryType` so that
// decisions / bugs / architecture read distinctly at a glance; everything else
// uses one color per kind. We read matching CSS variables first (so the graph
// tracks light/dark theme) and fall back to the spec hex literals here.
const DEFAULT_MEMORY = { cssVar: "--graph-memory", fallback: "#059669" };

const PALETTE: Record<string, { cssVar: string; fallback: string }> = {
  project: { cssVar: "--graph-project", fallback: "#7C3AED" },
  session: { cssVar: "--graph-session", fallback: "#2563EB" },
  memory: DEFAULT_MEMORY,
  "memory-decision": { cssVar: "--graph-memory-decision", fallback: "#0EA5E9" },
  "memory-bug": { cssVar: "--graph-memory-bug", fallback: "#DC2626" },
  "memory-architecture": { cssVar: "--graph-memory-architecture", fallback: "#0D9488" },
  evidence: { cssVar: "--graph-evidence", fallback: "#D97706" },
  chunkset: { cssVar: "--graph-chunkset", fallback: "#6B7280" },
  file: { cssVar: "--graph-file", fallback: "#475569" },
  symbol: { cssVar: "--graph-symbol", fallback: "#64748B" },
  wiki: { cssVar: "--graph-wiki", fallback: "#9333EA" },
};

const PROVENANCE_EDGES = new Set(["cites", "chunk-of", "from-session"]);
const CONFLICT_EDGES = new Set(["conflict", "supersede", "duplicate"]);
// code-link / wiki-cite: thin solid arrows pointing to file nodes (bridge)
const CODE_BRIDGE_EDGES = new Set(["code-link", "wiki-cite"]);
// wiki-link / wiki-source: violet solid — wiki-to-wiki and wiki-to-evidence structure
const WIKI_EDGES = new Set(["wiki-link", "wiki-source"]);

// Which node kinds belong to each layer toggle
const WIKI_LAYER_KINDS = new Set(["wiki"]);
// Edges dropped when the wiki layer is hidden (all edges with a wiki node as source)
const WIKI_LAYER_EDGES = new Set(["wiki-link", "wiki-source", "wiki-cite"]);
const CODE_LAYER_KINDS = new Set(["file", "symbol"]);
const CODE_LAYER_EDGES = new Set(["code-link"]);

type Layer = "wiki" | "code";

function readColor(cssVar: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value.length > 0 ? value : fallback;
}

function colorForKey(key: string): string {
  const entry = PALETTE[key] ?? DEFAULT_MEMORY;
  return readColor(entry.cssVar, entry.fallback);
}

function nodeColorKey(node: MemoryGraphNode): string {
  if (node.kind !== "memory") return node.kind;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const memoryType = node.meta["memoryType"];
  if (typeof memoryType === "string" && PALETTE[`memory-${memoryType}`] !== undefined) {
    return `memory-${memoryType}`;
  }
  return "memory";
}

function visibleNodes(data: MemoryGraphData, hiddenLayers: Set<Layer>): MemoryGraphNode[] {
  const hiddenNodeKinds = new Set<string>();
  if (hiddenLayers.has("wiki")) {
    for (const k of WIKI_LAYER_KINDS) hiddenNodeKinds.add(k);
  }
  if (hiddenLayers.has("code")) {
    for (const k of CODE_LAYER_KINDS) hiddenNodeKinds.add(k);
  }
  return data.nodes.filter((n) => !hiddenNodeKinds.has(n.kind));
}

function toElements(data: MemoryGraphData, hiddenLayers: Set<Layer>): ElementDefinition[] {
  const hiddenEdgeKinds = new Set<string>();
  if (hiddenLayers.has("wiki")) {
    for (const k of WIKI_LAYER_EDGES) hiddenEdgeKinds.add(k);
  }
  if (hiddenLayers.has("code")) {
    for (const k of CODE_LAYER_EDGES) hiddenEdgeKinds.add(k);
  }

  const nodesVisible = visibleNodes(data, hiddenLayers);
  const visibleNodeIds = new Set(nodesVisible.map((n) => n.id));

  const nodes: ElementDefinition[] = nodesVisible.map((node) => ({
    data: { id: node.id, label: node.label, color: colorForKey(nodeColorKey(node)) },
    classes: node.kind,
  }));

  // Drop an edge if its kind is explicitly hidden OR if either endpoint is a hidden node.
  // This ensures wiki-cite drops when Code layer is off (file node vanishes).
  const edges: ElementDefinition[] = data.edges
    .filter(
      (e) => !hiddenEdgeKinds.has(e.kind) && visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
    )
    .map((edge) => ({
      data: { id: edge.id, source: edge.from, target: edge.to },
      classes: edge.kind,
    }));

  return [...nodes, ...edges];
}

function buildStylesheet(): StylesheetJson {
  const textColor = readColor("--color-text-primary", "#141519");
  const conflictColor = readColor("--color-danger", "#DC2626");
  const structuralColor = readColor("--color-border", "#9CA3AF");
  const provenanceColor = readColor("--color-text-muted", "#646b77");
  const wikiColor = readColor("--graph-wiki", "#9333EA");

  const sheet: StylesheetJson = [
    {
      selector: "node",
      style: {
        "background-color": "data(color)",
        label: "data(label)",
        color: textColor,
        "font-size": 9,
        "text-wrap": "ellipsis",
        "text-max-width": "120px",
        "text-valign": "bottom",
        "text-margin-y": 4,
        width: 22,
        height: 22,
        "border-width": 1,
        "border-color": structuralColor,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": structuralColor,
        "curve-style": "bezier",
      },
    },
  ];

  for (const kind of PROVENANCE_EDGES) {
    sheet.push({
      selector: `edge.${kind}`,
      style: {
        width: 1.5,
        "line-color": provenanceColor,
        "target-arrow-color": provenanceColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    });
  }

  for (const kind of CONFLICT_EDGES) {
    sheet.push({
      selector: `edge.${kind}`,
      style: {
        width: 1.5,
        "line-color": conflictColor,
        "line-style": "dashed",
        "target-arrow-color": conflictColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    });
  }

  for (const kind of CODE_BRIDGE_EDGES) {
    sheet.push({
      selector: `edge.${kind}`,
      style: {
        width: 1,
        "line-color": structuralColor,
        "target-arrow-color": structuralColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    });
  }

  for (const kind of WIKI_EDGES) {
    sheet.push({
      selector: `edge.${kind}`,
      style: {
        width: 1.5,
        "line-color": wikiColor,
        "target-arrow-color": wikiColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    });
  }

  return sheet;
}

function metaEntries(meta: Record<string, unknown>): [string, string][] {
  return Object.entries(meta)
    .map(([key, value]): [string, string] =>
      Array.isArray(value) ? [key, value.join(", ")] : [key, String(value)],
    )
    .filter(([, value]) => value.length > 0);
}

export function MemoryGraphPanel({
  dir,
  id,
}: {
  dir: string;
  id: string;
  cwd?: string;
}): JSX.Element {
  const [data, setData] = useState<MemoryGraphData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [selected, setSelected] = useState<MemoryGraphNode | null>(null);
  const [hiddenLayers, setHiddenLayers] = useState<Set<Layer>>(new Set());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const elements = useMemo(
    () => (data === null ? [] : toElements(data, hiddenLayers)),
    [data, hiddenLayers],
  );
  const visibleNodeIds = useMemo(
    () => new Set(data === null ? [] : visibleNodes(data, hiddenLayers).map((n) => n.id)),
    [data, hiddenLayers],
  );
  // Edge elements carry data.source; node elements do not. Count from the
  // rendered set so the header tracks layer toggles, not the unfiltered totals.
  const visibleNodeCount = elements.filter((el) => el.data.source === undefined).length;
  const visibleEdges = elements.length - visibleNodeCount;

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    setSelected(null);
    try {
      setData(await fetchSessionMemoryGraph(dir, id));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [dir, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state !== "ready" || data === null || data.nodes.length === 0) return;
    const container = containerRef.current;
    if (container === null) return;

    // Toggling a layer hides its nodes; drop a stale selection so the detail
    // panel never describes a node that is no longer on the canvas.
    setSelected((prev) => (prev !== null && visibleNodeIds.has(prev.id) ? prev : null));

    const cy = cytoscape({
      container,
      elements,
      style: buildStylesheet(),
    });
    cyRef.current = cy;

    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    cy.on("tap", "node", (evt) => {
      const node = byId.get(evt.target.id());
      if (node !== undefined) setSelected(node);
    });

    cy.layout({ name: "cose", animate: false, padding: 24 }).run();

    // cytoscape sizes its canvas from the container at init, but this panel
    // mounts on a tab switch and fills asynchronously, so the container is often
    // 0-sized or stale on that first read — leaving the canvas blank though nodes
    // exist. Re-sync the renderer to the real box: the observer's initial
    // delivery fixes first paint; later ones handle tab-show and window resize.
    const observer = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 24);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [state, data, elements, visibleNodeIds]);

  function toggleLayer(layer: Layer) {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  }

  if (state === "loading") {
    return (
      <section aria-label="Memory graph" className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <LoadingState label="Loading memory graph…" />
      </section>
    );
  }

  if (state === "error" && error) {
    return (
      <section aria-label="Memory graph" className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <ErrorState error={error} onRetry={load} />
      </section>
    );
  }

  if (data && data.nodes.length === 0) {
    return (
      <section aria-label="Memory graph" className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <h3 className="text-sm text-text-muted uppercase tracking-widest">Memory graph</h3>
        <p className="mt-3 text-xs text-text-muted">
          No graph yet. Memory entries, evidence, and chunk sets appear here as nodes once this
          session accumulates context.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Memory graph" className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border">
        <h3 className="text-sm text-text-muted uppercase tracking-widest">Memory graph</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => toggleLayer("wiki")}
              aria-pressed={!hiddenLayers.has("wiki")}
              className={`text-xs px-2 py-0.5 rounded border ${
                hiddenLayers.has("wiki")
                  ? "border-border text-text-muted"
                  : "border-[var(--graph-wiki)] text-[var(--graph-wiki)]"
              }`}
            >
              Wiki
            </button>
            <button
              type="button"
              onClick={() => toggleLayer("code")}
              aria-pressed={!hiddenLayers.has("code")}
              className={`text-xs px-2 py-0.5 rounded border ${
                hiddenLayers.has("code")
                  ? "border-border text-text-muted"
                  : "border-[var(--graph-file)] text-[var(--graph-file)]"
              }`}
            >
              Code
            </button>
          </div>
          {data && (
            <p className="text-xs text-text-muted">
              {visibleNodeCount} {visibleNodeCount === 1 ? "node" : "nodes"} · {visibleEdges}{" "}
              {visibleEdges === 1 ? "edge" : "edges"}
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div
          ref={containerRef}
          data-testid="memory-graph-canvas"
          className="flex-1 min-h-0 min-w-0 bg-surface"
        />

        <aside className="w-64 shrink-0 border-l border-border overflow-y-auto px-4 py-4">
          {selected ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-text-muted uppercase tracking-widest">
                {selected.kind}
              </span>
              <p className="text-sm text-text-primary break-words">{selected.label}</p>
              {metaEntries(selected.meta).length > 0 && (
                <dl className="mt-2 flex flex-col gap-1">
                  {metaEntries(selected.meta).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2 text-xs">
                      <dt className="text-text-muted">{key}</dt>
                      <dd className="text-text-secondary break-words text-right">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ) : (
            <p className="text-xs text-text-muted">Select a node to inspect its details.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
