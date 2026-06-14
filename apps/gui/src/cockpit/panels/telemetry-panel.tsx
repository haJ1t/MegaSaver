import { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "../../components/states.js";
import {
  type SessionTelemetry,
  fetchClaudeSessionTelemetry,
} from "../../lib/claude-sessions-client.js";
import type { CockpitPanelProps } from "../panel.js";

function shortModel(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function durationLabel(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TelemetryPanel({ dir, id }: CockpitPanelProps): JSX.Element {
  const [telemetry, setTelemetry] = useState<SessionTelemetry | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let live = true;
    setState("loading");
    setTelemetry(null);
    fetchClaudeSessionTelemetry(dir, id)
      .then((t) => {
        if (!live) return;
        setTelemetry(t);
        setState("ready");
      })
      .catch(() => {
        if (!live) return;
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [dir, id]);

  if (state === "loading") return <LoadingState label="Loading session telemetry…" />;
  if (state === "error" || !telemetry)
    return (
      <EmptyState
        title="Telemetry unavailable."
        description="No telemetry could be read for this session yet."
      />
    );

  return (
    <section
      aria-label="Session telemetry"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">
        Session telemetry (LLM context tokens)
      </h2>
      <div className="flex flex-wrap gap-3">
        <Stat label="input tokens" value={telemetry.totals.inputTokens} />
        <Stat label="output tokens" value={telemetry.totals.outputTokens} />
        <Stat label="cache-create tokens" value={telemetry.totals.cacheCreationInputTokens} />
        <Stat label="cache-read tokens" value={telemetry.totals.cacheReadInputTokens} />
        <Stat label="turns" value={telemetry.turnCount} />
        <Stat label="assistant turns" value={telemetry.assistantTurns} />
        <Stat label="tool calls" value={telemetry.toolCallCount} />
        <Stat label="duration" value={durationLabel(telemetry.durationMs)} />
        {telemetry.gitBranch && <Stat label="git branch" value={telemetry.gitBranch} />}
      </div>
      {telemetry.models.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs text-text-muted uppercase tracking-widest">Model mix</h3>
          <ul className="flex flex-col gap-1">
            {telemetry.models.map((mu) => (
              <li
                key={mu.model}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface-elevated text-xs"
              >
                <span className="font-mono text-text-secondary truncate">
                  {shortModel(mu.model)}
                </span>
                <span className="text-text-muted ml-auto tabular-nums">
                  {mu.turns} turns · {mu.inputTokens} in / {mu.outputTokens} out
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }): JSX.Element {
  return (
    <div className="flex flex-col items-start px-3 py-2 rounded-md border border-border bg-surface-elevated min-w-[6rem]">
      <span className="text-sm text-text-primary font-medium tabular-nums">{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  );
}
