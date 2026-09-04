import { useCallback, useEffect, useState } from "react";
import {
  type BrainSyncStatusResponse,
  autoInitBrainSync,
  fetchBrainSyncStatus,
  triggerBrainSync,
} from "../lib/claude-sessions-client.js";

type Props = { dir?: string; id?: string };

export function BrainSyncCard({ dir, id }: Props): JSX.Element {
  const [syncState, setSyncState] = useState<BrainSyncStatusResponse | null>(null);
  const [syncing, setSyncing] = useState<"" | "push" | "pull" | "activating">("");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchBrainSyncStatus(dir, id)
      .then((res) => setSyncState(res))
      .catch(() => setSyncState({ configured: false, status: "idle", lastSyncedAt: null }));
  }, [dir, id]);

  useEffect(() => {
    load();
  }, [load]);

  const onActivate = async () => {
    setSyncing("activating");
    setError(null);
    try {
      const res = await autoInitBrainSync(dir, id);
      if (res.recoveryCode) {
        setRecoveryCode(res.recoveryCode);
      }
      const refreshed = await fetchBrainSyncStatus(dir, id);
      setSyncState(refreshed);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : ((err as { error?: string })?.error ?? String(err));
      const code = (err as { code?: string })?.code;
      setError(code ? `${code}: ${msg}` : msg);
    } finally {
      setSyncing("");
    }
  };

  const onAction = async (action: "push" | "pull") => {
    setSyncing(action);
    setError(null);
    try {
      await triggerBrainSync(dir, id, action);
      const refreshed = await fetchBrainSyncStatus(dir, id);
      setSyncState(refreshed);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : ((err as { error?: string })?.error ?? String(err));
      const code = (err as { code?: string })?.code;
      setError(code ? `${code}: ${msg}` : msg);
    } finally {
      setSyncing("");
    }
  };

  const isConfigured = syncState?.configured === true;
  const statusLabel = isConfigured
    ? syncState?.status === "ok"
      ? "Active"
      : (syncState?.status ?? "Active")
    : "Not Activated";
  const generation =
    syncState && "generation" in syncState
      ? (syncState as { generation?: number }).generation
      : undefined;
  const upToDate =
    syncState && "upToDate" in syncState
      ? (syncState as { upToDate?: boolean }).upToDate
      : undefined;
  const updatedAt =
    syncState && "updatedAt" in syncState
      ? (syncState as { updatedAt?: string | null }).updatedAt
      : (syncState?.lastSyncedAt ?? null);

  return (
    <div className="flex flex-col gap-2 px-4 py-3 rounded-lg border border-border bg-surface text-xs mb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-text-primary">Living Brain Sync</span>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${isConfigured ? "bg-accent-soft text-accent" : "bg-surface-elevated text-text-muted border border-border"}`}
          >
            {statusLabel}
          </span>
          {isConfigured && generation !== undefined && (
            <span className="text-[11px] text-text-muted font-mono">
              gen {generation}
              {upToDate !== undefined ? (upToDate ? " · up to date" : " · behind") : ""}
            </span>
          )}
          {updatedAt && <span className="text-[11px] text-text-muted font-mono">{updatedAt}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!isConfigured ? (
            <button
              type="button"
              onClick={onActivate}
              disabled={syncing !== ""}
              className="px-3 py-1.5 rounded-md bg-accent text-accent-fg text-xs font-medium cursor-pointer hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {syncing === "activating" ? "Activating…" : "Activate Living Brain (1-Click)"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onAction("pull")}
                disabled={syncing !== ""}
                className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80 disabled:opacity-50"
                title="Merge remote into this workspace"
              >
                {syncing === "pull" ? "Pulling…" : "Pull"}
              </button>
              <button
                type="button"
                onClick={() => onAction("push")}
                disabled={syncing !== ""}
                className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80 disabled:opacity-50"
                title="Merge remote first, then publish this workspace"
              >
                {syncing === "push" ? "Pushing…" : "Push"}
              </button>
            </>
          )}
        </div>
      </div>
      {!isConfigured && (
        <p className="text-[11px] text-text-muted m-0">
          Sync living memory across agent sessions and machines with 1-click automatic encryption.
        </p>
      )}
      {recoveryCode && (
        <div className="flex items-center justify-between p-2 rounded bg-surface-elevated border border-border text-[11px] font-mono text-text-secondary mt-1">
          <span>Recovery Code: {recoveryCode}</span>
          <span className="text-[10px] text-accent">✓ Saved to brain-sync.key</span>
        </div>
      )}
      {error && <p className="text-[11px] text-red-400 font-mono break-all m-0">{error}</p>}
    </div>
  );
}
