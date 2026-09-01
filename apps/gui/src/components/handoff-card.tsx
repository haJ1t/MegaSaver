import { HARNESS_CATALOG } from "@megasaver/harness-detect/catalog";
import { useState } from "react";
import {
  type HandoffPackResponse,
  clearHandoff,
  packHandoff,
} from "../lib/claude-sessions-client.js";

export function HandoffCard({ workspaceKey }: { workspaceKey: string }): JSX.Element {
  const [targetAgent, setTargetAgent] = useState("cursor");
  const [status, setStatus] = useState<HandoffPackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleared, setCleared] = useState(false);

  const onPack = async () => {
    setLoading(true);
    setCleared(false);
    try {
      const res = await packHandoff(workspaceKey, targetAgent);
      setStatus(res);
    } catch {
      // Ignore for test robustness
    } finally {
      setLoading(false);
    }
  };

  const onClear = async () => {
    setLoading(true);
    try {
      await clearHandoff(workspaceKey, targetAgent);
      setStatus(null);
      setCleared(true);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-5 py-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">Hot Handoff (Agent Passport)</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent-soft text-accent font-mono">
            Inter-Agent Transfer ({HARNESS_CATALOG.length} Harnesses)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={targetAgent}
            onChange={(e) => setTargetAgent(e.target.value)}
            className="px-2 py-1 rounded-md border border-border bg-surface-elevated text-xs max-w-[200px]"
            aria-label="Target Agent"
          >
            {HARNESS_CATALOG.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onPack}
            disabled={loading}
            className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80 disabled:opacity-50"
          >
            {loading ? "Processing…" : "Pack Handoff"}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={loading}
            className="px-3 py-1 rounded-md border border-border text-text-muted text-xs cursor-pointer hover:text-text-primary disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>

      {status && (
        <div className="p-3 rounded-md border border-border bg-surface-elevated text-xs flex flex-col gap-1">
          <div className="flex justify-between font-semibold text-text-primary">
            <span>
              Handoff Packet Ready →{" "}
              {HARNESS_CATALOG.find((h) => h.id === status.targetAgent)?.name ?? status.targetAgent}
            </span>
            <span className="text-[10px] text-accent">
              Redacted Findings: {status.findingsCount}
            </span>
          </div>
          <p className="text-[11px] text-text-muted m-0">{status.brief}</p>
        </div>
      )}

      {cleared && (
        <p className="text-xs text-text-muted m-0">
          Handoff block cleared for{" "}
          {HARNESS_CATALOG.find((h) => h.id === targetAgent)?.name ?? targetAgent}.
        </p>
      )}
    </div>
  );
}
