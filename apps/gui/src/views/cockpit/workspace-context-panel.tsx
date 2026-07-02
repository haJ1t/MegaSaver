import { useEffect, useRef, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import {
  type WorkspaceContextResponse,
  fetchWorkspaceContext,
} from "../../lib/workspaces-client.js";

export function WorkspaceContextPanel({ workspaceKey }: { workspaceKey: string }): JSX.Element {
  const [task, setTask] = useState("");
  const [data, setData] = useState<WorkspaceContextResponse | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<BridgeError | null>(null);
  const latestId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (task.trim().length === 0) return;
    const requestId = ++latestId.current;
    setState("loading");
    setError(null);
    try {
      const result = await fetchWorkspaceContext(workspaceKey, task.trim());
      if (requestId !== latestId.current || !mounted.current) return;
      setData(result);
      setState("ready");
    } catch (err) {
      if (requestId !== latestId.current || !mounted.current) return;
      setError(err as BridgeError);
      setState("error");
    }
  }

  return (
    <section aria-label="Workspace context" className="flex flex-col gap-3 p-4">
      <h3 className="text-sm text-text-muted uppercase tracking-widest">Context</h3>
      <form onSubmit={run} className="flex items-center gap-2">
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the task…"
          aria-label="Context task"
          className="px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text-primary w-72"
        />
        <button
          type="submit"
          className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90"
        >
          Preview
        </button>
      </form>
      {state === "loading" && <LoadingState label="Building context pack…" />}
      {state === "error" && error && <ErrorState error={error} />}
      {state === "ready" && data && !data.indexed && (
        <p className="text-xs text-text-muted">No index yet. Build it: mega index build</p>
      )}
      {state === "ready" && data?.indexed && (
        <p className="text-xs text-text-secondary">
          Pack built ({data.pack?.blocks.length ?? 0} block(s)).
        </p>
      )}
    </section>
  );
}
