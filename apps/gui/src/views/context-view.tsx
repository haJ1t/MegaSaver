import type { ScoredBlock } from "@megasaver/context-pruner";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import { type ContextPreview, fetchContext } from "../lib/api-client.js";

export function ContextView({ projectId }: { projectId: string }): JSX.Element {
  const [task, setTask] = useState("");
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<BridgeError | null>(null);

  async function run(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (task.trim().length === 0) return;
    setState("loading");
    setError(null);
    try {
      setPreview(await fetchContext(projectId, { task: task.trim() }));
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }

  return (
    <section
      aria-label="Context"
      className="flex flex-col gap-4 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <h2 className="text-sm text-text-muted uppercase tracking-widest">Context pack preview</h2>

      <form onSubmit={run} className="flex items-center gap-2">
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the task to build context for…"
          aria-label="Task description"
          className="px-2 py-1 text-xs bg-surface-elevated border border-border rounded-md text-text-primary flex-1 max-w-xl focus-visible:outline-2 focus-visible:outline-offset-2"
        />
        <button
          type="submit"
          className="px-3 py-1 text-xs rounded-md bg-accent text-accent-fg cursor-pointer hover:opacity-90"
        >
          Build preview
        </button>
      </form>

      {state === "idle" && (
        <p className="text-xs text-text-muted">
          Enter a task to see which code blocks the context packer would include, and the token
          savings.
        </p>
      )}
      {state === "loading" && <LoadingState label="Building context pack…" />}
      {state === "error" && error && <ErrorState error={error} />}

      {state === "ready" && preview && !preview.indexed && (
        <EmptyState
          title="No index yet."
          description="Context preview needs a built index: mega index build <project>"
        />
      )}

      {state === "ready" && preview?.indexed && (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="tokens before" value={preview.audit.tokensBefore} />
            <Stat label="tokens after" value={preview.audit.tokensAfter} />
            <Stat label="% saved" value={Math.round(preview.audit.percentSaved)} />
            <Stat
              label="blocks"
              value={`${preview.audit.blocksIncluded}/${preview.audit.blocksConsidered}`}
            />
          </div>
          <BlockList
            title={`Included (${preview.pack.included.length})`}
            blocks={preview.pack.included}
            included
          />
          <BlockList
            title={`Excluded (${preview.pack.excluded.length})`}
            blocks={preview.pack.excluded}
            included={false}
          />
        </>
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

function BlockList({
  title,
  blocks,
  included,
}: {
  title: string;
  blocks: readonly ScoredBlock[];
  included: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs text-text-muted uppercase tracking-widest">{title}</h3>
      {blocks.length === 0 ? (
        <p className="text-xs text-text-muted">None.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {blocks.map((b) => (
            <li
              key={b.blockId}
              className={[
                "flex items-center gap-2 px-3 py-2 rounded-md border text-xs",
                included ? "border-accent/30 bg-accent/5" : "border-border bg-surface-elevated",
              ].join(" ")}
            >
              <span className="text-text-muted w-10 shrink-0">{b.score.toFixed(2)}</span>
              <span className="font-mono text-text-secondary truncate">
                {b.filePath}:{b.startLine}
              </span>
              <span className="text-text-primary truncate">{b.name ?? "—"}</span>
              <span className="text-text-muted ml-auto truncate max-w-[40%]">
                {b.reasons.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
