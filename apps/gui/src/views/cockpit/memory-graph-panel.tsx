import cytoscape from "cytoscape";
import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import { useCallback, useEffect, useRef, useState } from "react";
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
  "memory-decision": { cssVar: "--graph-memory-decision", fallback: "#059669" },
  "memory-bug": { cssVar: "--graph-memory-bug", fallback: "#DC2626" },
  "memory-architecture": { cssVar: "--graph-memory-architecture", fallback: "#0D9488" },
  evidence: { cssVar: "--graph-evidence", fallback: "#D97706" },
  chunkset: { cssVar: "--graph-chunkset", fallback: "#6B7280" },
};

const PROVENANCE_EDGES = new Set(["cites", "chunk-of", "from-session"]);
const CONFLICT_EDGES = new Set(["conflict", "supersede", "duplicate"]);

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

function toElements(data: MemoryGraphData): ElementDefinition[] {
  const nodes: ElementDefinition[] = data.nodes.map((node) => ({
    data: { id: node.id, label: node.label, color: colorForKey(nodeColorKey(node)) },
    classes: node.kind,
  }));
  const edges: ElementDefinition[] = data.edges.map((edge) => ({
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

  return sheet;
}

function metaEntries(meta: Record<string, unknown>): [string, string][] {
  return Object.entries(meta).map(([key, value]) => [key, String(value)]);
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

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

    const cy = cytoscape({
      container,
      elements: toElements(data),
      style: buildStylesheet(),
    });
    cyRef.current = cy;

    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    cy.on("tap", "node", (evt) => {
      const node = byId.get(evt.target.id());
      if (node !== undefined) setSelected(node);
    });

    cy.layout({ name: "cose", animate: false, padding: 24 }).run();

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [state, data]);

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
        <h2 className="text-sm text-text-muted uppercase tracking-widest">Memory graph</h2>
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
        <h2 className="text-sm text-text-muted uppercase tracking-widest">Memory graph</h2>
        {data && (
          <p className="text-xs text-text-muted">
            {data.stats.nodeCount} {data.stats.nodeCount === 1 ? "node" : "nodes"} ·{" "}
            {data.stats.edgeCount} {data.stats.edgeCount === 1 ? "edge" : "edges"}
          </p>
        )}
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
