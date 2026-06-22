import { useEffect, useRef, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import { type Workspace, fetchWorkspaces } from "../lib/claude-sessions-client.js";
import { type OfficeStatus, fetchOfficeStatus, openOfficeStream } from "../lib/office-client.js";
import { AgentBoard } from "./office/agent-board.js";
import { RoleManager } from "./office/role-manager.js";

function envelopeMessage(err: unknown): string {
  const e = err as BridgeError;
  return e.error ?? "Failed to load office status";
}

export function AgentOfficeView(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsState, setWsState] = useState<"loading" | "ready" | "error">("loading");
  const [wsError, setWsError] = useState<BridgeError | null>(null);

  const [selectedWk, setSelectedWk] = useState<string | null>(null);
  const [boardStatus, setBoardStatus] = useState<OfficeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Per-run ignore flag for the active workspace effect; the manual refresh
  // (onRefresh) reads this so a stale in-flight refetch can't overwrite a
  // newer workspace's board after the user switched.
  const ignoreRef = useRef(false);

  // Load workspaces once
  useEffect(() => {
    fetchWorkspaces(50, 0)
      .then((list) => {
        setWorkspaces(list);
        setWsState("ready");
        // Auto-select if only one workspace
        if (list.length === 1 && list[0] !== undefined) {
          setSelectedWk(list[0].key);
        }
      })
      .catch((err: unknown) => {
        setWsError(err as BridgeError);
        setWsState("error");
      });
  }, []);

  // Load status + open SSE stream when workspace selected. The `ignore` flag
  // gates every state write so a late wk1 response can't clobber the wk2 board.
  useEffect(() => {
    let ignore = false;
    ignoreRef.current = false;
    setBoardStatus(null);
    setStatusError(null);

    if (!selectedWk) return;

    fetchOfficeStatus(selectedWk)
      .then((s) => {
        if (!ignore) setBoardStatus(s);
      })
      .catch((e: unknown) => {
        if (!ignore) setStatusError(envelopeMessage(e));
      });

    const close = openOfficeStream(selectedWk, {
      onStatus: (s) => {
        if (!ignore) {
          setBoardStatus(s);
          // A live status push means the stream is healthy — clear any
          // transient "disconnected" banner left by an auto-reconnected blip.
          setStatusError(null);
        }
      },
      onError: () => {
        if (!ignore) setStatusError("Live stream disconnected");
      },
    });

    return () => {
      ignore = true;
      ignoreRef.current = true;
      close();
    };
  }, [selectedWk]);

  function handleRefresh(wk: string): void {
    fetchOfficeStatus(wk)
      .then((s) => {
        if (!ignoreRef.current) setBoardStatus(s);
      })
      .catch((e: unknown) => {
        if (!ignoreRef.current) setStatusError(envelopeMessage(e));
      });
  }

  if (wsState === "loading") return <LoadingState label="Loading workspaces…" />;
  if (wsState === "error" && wsError) return <ErrorState error={wsError} />;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* Workspace selector */}
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Workspace
        </span>
        <select
          value={selectedWk ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedWk(val || null);
          }}
          aria-label="Select workspace"
          className="text-xs px-2 py-1 border border-border rounded bg-surface text-text-primary flex-1 max-w-xs"
        >
          <option value="">— select —</option>
          {workspaces.map((ws) => (
            <option key={ws.key} value={ws.key}>
              {ws.label}
            </option>
          ))}
        </select>
      </div>

      {/* Roles — always shown (global) */}
      <RoleManager />

      {/* Agent board — shown when workspace selected */}
      {selectedWk && (
        <>
          {statusError && (
            <p role="alert" className="px-4 py-2 text-xs text-danger">
              {statusError}
            </p>
          )}
          <AgentBoard
            wk={selectedWk}
            status={boardStatus}
            onRefresh={() => handleRefresh(selectedWk)}
          />
        </>
      )}

      {!selectedWk && workspaces.length > 0 && (
        <p className="px-4 py-4 text-xs text-text-muted">
          Select a workspace to view and manage agents.
        </p>
      )}

      {!selectedWk && workspaces.length === 0 && (
        <p className="px-4 py-4 text-xs text-text-muted">
          No workspaces found. Start a Claude Code session to create one.
        </p>
      )}
    </div>
  );
}
