import { useEffect, useState } from "react";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { DecisionTraceTab } from "./cockpit/decision-trace-tab.js";
import { LivingBrainTab } from "./cockpit/living-brain-tab.js";
import { MemoryUniverseTab } from "./cockpit/memory-universe-tab.js";

export type MemorySubTab = "living-brain" | "graph" | "trace";

const TAB_PARAM_TO_TAB: Record<string, MemorySubTab> = {
  brain: "living-brain",
  graph: "graph",
  trace: "trace",
};

const TAB_TO_PARAM: Record<MemorySubTab, string> = {
  "living-brain": "brain",
  graph: "graph",
  trace: "trace",
};

function tabFromUrl(): MemorySubTab | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("tab");
  if (raw !== null && raw in TAB_PARAM_TO_TAB) return TAB_PARAM_TO_TAB[raw] as MemorySubTab;
  return null;
}

function syncTabToUrl(tab: MemorySubTab): void {
  if (typeof window === "undefined" || typeof window.history.replaceState !== "function") return;
  const params = new URLSearchParams(window.location.search);
  params.set("tab", TAB_TO_PARAM[tab]);
  const qs = params.toString();
  const next = `${window.location.pathname}${qs.length > 0 ? `?${qs}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

export function MemoryPage({
  options,
  activeKey,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
}): JSX.Element {
  const [activeTab, setActiveTab] = useState<MemorySubTab>(() => tabFromUrl() ?? "living-brain");

  // Keep URL ?tab= in sync with local tab state. Other query params are preserved.
  // Invalid values fall back to living-brain (see tabFromUrl). replaceState avoids
  // polluting history on every tab switch.
  useEffect(() => {
    syncTabToUrl(activeTab);
  }, [activeTab]);
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;

  const TAB_ORDER: MemorySubTab[] = ["living-brain", "graph", "trace"];
  const tabIds: Record<MemorySubTab, string> = {
    "living-brain": "tab-living-brain",
    graph: "tab-graph",
    trace: "tab-trace",
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const idx = TAB_ORDER.indexOf(activeTab);
    let next: MemorySubTab | null = null;
    if (e.key === "ArrowRight") next = TAB_ORDER[(idx + 1) % TAB_ORDER.length] as MemorySubTab;
    else if (e.key === "ArrowLeft")
      next = TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length] as MemorySubTab;
    else if (e.key === "Home") next = TAB_ORDER[0] as MemorySubTab;
    else if (e.key === "End") next = TAB_ORDER[TAB_ORDER.length - 1] as MemorySubTab;
    if (next) {
      e.preventDefault();
      setActiveTab(next);
      document.getElementById(tabIds[next])?.focus();
    }
  };

  return (
    <div className="max-w-[1280px] w-full flex flex-col gap-5 px-5 py-7 font-sans">
      {/* Top Header & Context Description */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-text-primary">Memory</h1>
          <p className="mt-1 mb-0 text-text-secondary text-sm">
            What the agent remembers
            {active ? (
              <>
                {" "}
                about <span className="font-mono text-sm text-text-primary">{active.label}</span>
              </>
            ) : null}
            , and how it got there.
          </p>
        </div>

        {/* 3 Top-Level Tabs */}
        {active && (
          <div
            role="tablist"
            aria-label="Memory Subtabs"
            onKeyDown={handleTabKeyDown}
            className="flex items-center gap-1 p-1 rounded-xl bg-surface border border-border self-start sm:self-auto shadow-sm"
          >
            <button
              type="button"
              id={tabIds["living-brain"]}
              role="tab"
              aria-selected={activeTab === "living-brain"}
              aria-controls="memory-tab-panel"
              aria-label="Tab: Living Brain"
              onClick={() => setActiveTab("living-brain")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "living-brain"
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-elevated"
              }`}
            >
              <span>⚡</span>
              <span>Living Brain</span>
            </button>

            <button
              type="button"
              id={tabIds.graph}
              role="tab"
              aria-selected={activeTab === "graph"}
              aria-controls="memory-tab-panel"
              aria-label="Tab: Memory Graph"
              onClick={() => setActiveTab("graph")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "graph"
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-elevated"
              }`}
            >
              <span>🪐</span>
              <span>Memory Graph (3D)</span>
            </button>

            <button
              type="button"
              id={tabIds.trace}
              role="tab"
              aria-selected={activeTab === "trace"}
              aria-controls="memory-tab-panel"
              aria-label="Tab: Decision Trace"
              onClick={() => setActiveTab("trace")}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === "trace"
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-elevated"
              }`}
            >
              <span>🌿</span>
              <span>Decision Trace</span>
            </button>
          </div>
        )}
      </div>

      {/* Main View Area */}
      {active === null ? (
        <div className="p-8 rounded-xl border border-border bg-surface text-center text-sm text-text-muted">
          Select a workspace to view its memory.
        </div>
      ) : (
        <div
          id="memory-tab-panel"
          role="tabpanel"
          aria-labelledby={tabIds[activeTab]}
          data-testid="memory-tab-content"
          className="w-full"
        >
          {activeTab === "living-brain" && (
            <LivingBrainTab dir={active.rep.dir} id={active.rep.id} />
          )}
          {activeTab === "graph" && <MemoryUniverseTab dir={active.rep.dir} id={active.rep.id} />}
          {activeTab === "trace" && <DecisionTraceTab dir={active.rep.dir} id={active.rep.id} />}
        </div>
      )}
    </div>
  );
}
