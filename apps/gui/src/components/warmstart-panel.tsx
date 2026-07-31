import { useEffect, useState } from "react";
import { type WarmupResponse, fetchWarmup } from "../lib/claude-sessions-client.js";

export function WarmStartPanel({ dir, id }: { dir: string; id: string }): JSX.Element {
  const [warmup, setWarmup] = useState<WarmupResponse | null>(null);

  useEffect(() => {
    fetchWarmup(dir, id)
      .then((res) => setWarmup(res))
      .catch(() => setWarmup(null));
  }, [dir, id]);

  if (!warmup) return <></>;

  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-lg border border-border bg-surface text-xs">
      <div className="flex items-center justify-between font-semibold text-text-primary">
        <span>Warm Start Brief</span>
        <span className="text-[10px] text-accent font-mono">Rapid Onboarding</span>
      </div>
      <p className="text-[11px] text-text-muted m-0">{warmup.brief}</p>
    </div>
  );
}
