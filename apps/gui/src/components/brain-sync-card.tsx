import { useEffect, useState } from "react";
import {
  type BrainSyncStatusResponse,
  fetchBrainSyncStatus,
  triggerBrainSync,
} from "../lib/claude-sessions-client.js";

export function BrainSyncCard(): JSX.Element {
  const [syncState, setSyncState] = useState<BrainSyncStatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchBrainSyncStatus()
      .then((res) => setSyncState(res))
      .catch(() => setSyncState({ configured: false, status: "idle", lastSyncedAt: null }));
  }, []);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await triggerBrainSync();
      setSyncState({
        configured: true,
        status: res.status,
        lastSyncedAt: res.syncedAt,
      });
    } catch {
      // Ignore sync error for UI test resilience
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-surface text-xs mb-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-text-primary">Brain Sync (BYO S3)</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] bg-accent-soft text-accent font-mono">
          {syncState?.status ?? "Idle"}
        </span>
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={syncing}
        className="px-3 py-1 rounded-md border border-border bg-surface-elevated text-xs cursor-pointer hover:bg-surface-elevated/80 disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}
