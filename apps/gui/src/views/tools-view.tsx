import type { ToolDefinition } from "@megasaver/core";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { type ToolsRouteResponse, fetchToolsRoute } from "../lib/api-client.js";

export function ToolsView({ projectId }: { projectId: string }): JSX.Element {
  const [data, setData] = useState<ToolsRouteResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [task, setTask] = useState("");
  const [appliedTask, setAppliedTask] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      setData(await fetchToolsRoute(projectId, appliedTask.trim() ? { task: appliedTask } : {}));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [projectId, appliedTask]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-label="Tools"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm text-text-muted uppercase tracking-widest">Tool router</h2>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedTask(task);
          }}
        >
          <input
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Route for a task…"
            aria-label="Task to route tools for"
            className="px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text-primary w-56 focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          <button
            type="submit"
            className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90"
          >
            Apply
          </button>
        </form>
      </div>

      {state === "loading" && <LoadingState label="Loading tools…" />}
      {state === "error" && error && <ErrorState error={error} onRetry={load} />}
      {state === "ready" && data && data.tools.length === 0 && (
        <EmptyState
          title="No tools registered."
          description="Register tools from the terminal: mega tools add <project> --name … --category … --risk …"
        />
      )}
      {state === "ready" && data && data.tools.length > 0 && (
        <>
          <p className="text-xs text-text-muted">{data.route.reason}</p>
          <ToolColumn
            title={`Allowed (${data.route.allowedTools.length})`}
            tools={data.route.allowedTools}
            allowed
          />
          <ToolColumn
            title={`Blocked (${data.route.blockedTools.length})`}
            tools={data.route.blockedTools}
            allowed={false}
          />
        </>
      )}
    </section>
  );
}

function ToolColumn({
  title,
  tools,
  allowed,
}: {
  title: string;
  tools: readonly ToolDefinition[];
  allowed: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs text-text-muted uppercase tracking-widest">{title}</h3>
      {tools.length === 0 ? (
        <p className="text-xs text-text-muted">None.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {tools.map((tool) => (
            <li
              key={tool.id}
              className={[
                "flex items-center gap-2 px-3 py-2 rounded-md border text-xs",
                allowed ? "border-ok/30 bg-ok/5" : "border-danger/30 bg-danger/5",
              ].join(" ")}
            >
              <span className="text-text-primary font-medium">{tool.name}</span>
              <span className="text-text-muted">{tool.category}</span>
              <span className="ml-auto text-text-muted">risk: {tool.risk}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
