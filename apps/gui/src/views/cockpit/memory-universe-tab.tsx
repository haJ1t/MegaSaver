import { Suspense, lazy, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../../components/states.js";
import type { BridgeError } from "../../components/states.js";
import { type MemoryGraphData, fetchSessionMemoryGraph } from "../../lib/claude-sessions-client.js";

const MemoryUniverse3D = lazy(() =>
  import("./memory-universe-3d.js").then((m) => ({ default: m.MemoryUniverse3D })),
);

export function MemoryUniverseTab({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [data, setData] = useState<MemoryGraphData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce intentionally re-triggers the load effect
  useEffect(() => {
    let live = true;
    setState("loading");
    setError(null);
    fetchSessionMemoryGraph(dir, id)
      .then((g) => {
        if (!live) return;
        setData(g);
        setState("ready");
      })
      .catch((err) => {
        if (!live) return;
        setError(err as BridgeError);
        setState("error");
      });
    return () => {
      live = false;
    };
  }, [dir, id, refreshNonce]);

  const retry = (): void => setRefreshNonce((n) => n + 1);

  if (state === "loading") {
    return <LoadingState label="Constructing 3D Universal Memory Cosmos…" />;
  }

  if (state === "error" && error) {
    return <ErrorState error={error} onRetry={retry} />;
  }

  if (state === "ready" && data) {
    return (
      <div className="w-full flex flex-col gap-3">
        <Suspense fallback={<LoadingState label="Loading 3D view…" />}>
          <MemoryUniverse3D data={data} />
        </Suspense>
      </div>
    );
  }

  return <div />;
}
