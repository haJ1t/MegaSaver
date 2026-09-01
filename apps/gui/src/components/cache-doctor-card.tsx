import { useEffect, useState } from "react";
import {
  type CacheStatusResponse,
  fetchCacheStatus,
  postCacheClear,
} from "../lib/claude-sessions-client.js";

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

export function CacheDoctorCard(): JSX.Element {
  const [cache, setCache] = useState<CacheStatusResponse | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    fetchCacheStatus()
      .then((res) => setCache(res))
      .catch(() => setCache(null));
  }, []);

  const onClear = async () => {
    try {
      await postCacheClear();
      const updated = await fetchCacheStatus();
      setCache(updated);
      setCleared(true);
      setTimeout(() => setCleared(false), 3000);
    } catch {
      // Ignore
    }
  };

  if (!cache) return <></>;

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface text-xs">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">Claude Code Prompt Cache Doctor</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent-soft text-accent font-semibold">
            Hit Ratio: {(cache.cacheHitRatio * 100).toFixed(0)}%
          </span>
        </div>
        <span className="text-[11px] text-text-muted">
          Read: {formatTokens(cache.cacheReadInputTokens)} | Created:{" "}
          {formatTokens(cache.cacheCreationInputTokens)} tokens
        </span>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80"
      >
        {cleared ? "Cache Cleared" : "Clear Cache Churn"}
      </button>
    </div>
  );
}
