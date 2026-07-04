import cytoscape from "cytoscape";
import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type DecisionTraceData,
  type DecisionTraceNode,
  type DecisionTraceSessionSummary,
  fetchDecisionTraceGraph,
  fetchDecisionTraceSessions,
} from "../../lib/decision-trace-client.js";

// One color per node kind. Read a matching CSS variable first (so the graph
// tracks the light/dark theme) and fall back to the hex literals here.
const PALETTE: Record<DecisionTraceNode["kind"], { cssVar: string; fallback: string }> = {
  output: { cssVar: "--graph-output", fallback: "#2563EB" },
  chunk: { cssVar: "--graph-chunkset", fallback: "#6B7280" },
  memory: { cssVar: "--graph-memory", fallback: "#059669" },
  redaction: { cssVar: "--graph-redaction", fallback: "#DC2626" },
};

const EMPTY_COPY =
  "No decision traces for this session yet — tracing is on by default; set MEGASAVER_SEAM_TRACE=false to disable.";
const EMPTY_NOTE =
  "Traces come from the proxy/registry sessions run for this workspace, not the cockpit transcript.";

function readColor(cssVar: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value.length > 0 ? value : fallback;
}

function colorForKind(kind: DecisionTraceNode["kind"]): string {
  const entry = PALETTE[kind];
  return readColor(entry.cssVar, entry.fallback);
}

function toElements(data: DecisionTraceData): ElementDefinition[] {
  const nodes: ElementDefinition[] = data.nodes.map((node) => ({
    data: { id: node.id, label: node.label, color: colorForKind(node.kind) },
    classes: node.kind,
  }));
  const edges: ElementDefinition[] = data.edges.map((edge, i) => ({
    data: { id: `edge:${i}`, source: edge.source, target: edge.target },
    classes: edge.kind,
  }));
  return [...nodes, ...edges];
}

function buildStylesheet(): StylesheetJson {
  const textColor = readColor("--color-text-primary", "#141519");
  const structuralColor = readColor("--color-border", "#9CA3AF");
  const rankedColor = readColor("--color-text-muted", "#646b77");
  const pinnedColor = readColor("--graph-memory", "#059669");
  const redactedColor = readColor("--color-danger", "#DC2626");

  return [
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
      style: { width: 1, "line-color": structuralColor, "curve-style": "bezier" },
    },
    {
      selector: "edge.ranked",
      style: {
        width: 1.5,
        "line-color": rankedColor,
        "target-arrow-color": rankedColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    },
    {
      selector: "edge.pinned",
      style: {
        width: 1.5,
        "line-color": pinnedColor,
        "target-arrow-color": pinnedColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    },
    {
      selector: "edge.redacted",
      style: {
        width: 1.5,
        "line-color": redactedColor,
        "line-style": "dashed",
        "target-arrow-color": redactedColor,
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
      },
    },
  ];
}

function metaEntries(meta: Record<string, unknown>): [string, string][] {
  return Object.entries(meta)
    .map(([key, value]): [string, string] =>
      Array.isArray(value) ? [key, value.join(", ")] : [key, String(value)],
    )
    .filter(([, value]) => value.length > 0);
}

function sessionLabel(s: DecisionTraceSessionSummary): string {
  const count = `${s.outputs} ${s.outputs === 1 ? "output" : "outputs"}`;
  const when = s.latestCreatedAt ? ` · ${s.latestCreatedAt}` : "";
  return `${s.sessionId} — ${count}${when}`;
}

export function DecisionTracePanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [sessions, setSessions] = useState<DecisionTraceSessionSummary[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [data, setData] = useState<DecisionTraceData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [selected, setSelected] = useState<DecisionTraceNode | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const elements = useMemo(() => (data === null ? [] : toElements(data)), [data]);

  // The cockpit transcript UUID never keys a registry trace, so the panel can't
  // auto-map: it lists this workspace's registry trace sessions and lets the
  // operator pick one (newest auto-selected). Fetch the list first; the graph
  // fetch is keyed by the picked registry sessionId.
  const loadSessions = useCallback(async () => {
    setState("loading");
    setError(null);
    setSelected(null);
    setData(null);
    try {
      const { sessions: list } = await fetchDecisionTraceSessions(dir, id);
      setSessions(list);
      // Server sorts newest-first; auto-select the first so data shows at once.
      setPicked(list[0]?.sessionId ?? null);
      if (list.length === 0) setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [dir, id]);

  const loadGraph = useCallback(
    async (sessionId: string) => {
      setState("loading");
      setError(null);
      setSelected(null);
      try {
        setData(await fetchDecisionTraceGraph(dir, id, sessionId));
        setState("ready");
      } catch (err) {
        setError(err as BridgeError);
        setState("error");
      }
    },
    [dir, id],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (picked !== null) void loadGraph(picked);
  }, [picked, loadGraph]);

  useEffect(() => {
    if (state !== "ready" || data === null || data.nodes.length === 0) return;
    const container = containerRef.current;
    if (container === null) return;

    const cy = cytoscape({ container, elements, style: buildStylesheet() });
    cyRef.current = cy;

    const byId = new Map(data.nodes.map((node) => [node.id, node]));
    cy.on("tap", "node", (evt) => {
      const node = byId.get(evt.target.id());
      if (node !== undefined) setSelected(node);
    });

    cy.layout({ name: "cose", animate: false, padding: 24 }).run();

    // cytoscape sizes its canvas from the container at init, but this panel
    // mounts inside a scrolling column that fills asynchronously, so the box is
    // often 0-sized on first read — leaving the canvas blank though nodes exist.
    // Re-sync the renderer to the real box on the observer's initial delivery.
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
  }, [state, data, elements]);

  if (state === "loading") {
    return (
      <section aria-label="Decision trace" className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <LoadingState label="Loading decision trace…" />
      </section>
    );
  }

  if (state === "error" && error) {
    return (
      <section aria-label="Decision trace" className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <ErrorState error={error} onRetry={loadSessions} />
      </section>
    );
  }

  // No registry trace session maps this workspace → honest empty state; the
  // picker has nothing to select and we never fabricate a transcript↔registry map.
  if (sessions !== null && sessions.length === 0) {
    return (
      <section aria-label="Decision trace" className="flex flex-col flex-1 min-h-0 px-6 py-6">
        <h3 className="text-sm text-text-muted uppercase tracking-widest">Trace</h3>
        <p className="mt-3 text-xs text-text-muted">{EMPTY_COPY}</p>
        <p className="mt-2 text-xs text-text-muted">{EMPTY_NOTE}</p>
      </section>
    );
  }

  return (
    <section aria-label="Decision trace" className="flex flex-col flex-1 min-h-0">
      <header className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm text-text-muted uppercase tracking-widest">Trace</h3>
          {sessions && sessions.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-text-muted min-w-0">
              <span className="sr-only">Trace session</span>
              <select
                aria-label="Trace session"
                className="max-w-xs truncate bg-surface border border-border rounded px-2 py-1 text-xs text-text-primary"
                value={picked ?? ""}
                onChange={(e) => setPicked(e.target.value)}
              >
                {sessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {sessionLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {data && (
          <p className="text-xs text-text-muted shrink-0">
            {data.stats.outputs} {data.stats.outputs === 1 ? "output" : "outputs"} ·{" "}
            {data.stats.chunks} {data.stats.chunks === 1 ? "chunk" : "chunks"} ·{" "}
            {data.stats.memoriesPinned} ranked
          </p>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        <div
          ref={containerRef}
          data-testid="decision-trace-canvas"
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
