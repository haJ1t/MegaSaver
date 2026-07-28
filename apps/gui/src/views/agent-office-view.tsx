import { useEffect, useRef, useState } from "react";
import type { BridgeError } from "../components/states.js";
import { ErrorState, LoadingState } from "../components/states.js";
import { type Workspace, fetchWorkspaces } from "../lib/claude-sessions-client.js";
import { type OfficeStatus, fetchOfficeStatus, openOfficeStream } from "../lib/office-client.js";
import { AgentBoard } from "./office/agent-board.js";
import { OfficeFloor } from "./office/office-floor.js";
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
  const [officeView, setOfficeView] = useState<"floor" | "list">("floor");
  const [floorSelection, setFloorSelection] = useState<string | null>(null);

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
    // Selection is per-workspace; carrying it across would filter the board to
    // an agent that isn't on this floor.
    setFloorSelection(null);

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

  // A selection only counts while its agent is still on the roster — an agent
  // removed by another client would otherwise filter the board to empty.
  const liveSelection =
    floorSelection !== null && boardStatus?.agents.some((e) => e.agent.id === floorSelection)
      ? floorSelection
      : null;

  return (
    <div className="max-w-[1280px] flex flex-col gap-4 px-5 py-7">
      <div className="flex items-end gap-3.5">
        <div className="flex-1 min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Agent office</h1>
          <p className="mt-1 mb-0 text-text-secondary">
            Background agents working in this workspace.
          </p>
        </div>
        <div className="inline-flex gap-1 p-1 rounded-lg border border-border bg-surface">
          {(["floor", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setOfficeView(v)}
              aria-pressed={officeView === v}
              className={[
                "px-3 py-1.5 rounded-md text-xs capitalize cursor-pointer transition-colors",
                officeView === v
                  ? "bg-accent-soft text-accent font-semibold"
                  : "bg-transparent text-text-secondary hover:text-text-primary",
              ].join(" ")}
            >
              {v}
            </button>
          ))}
        </div>
        {/* Office agents are keyed by workspace at the bridge, so this page
            keeps its own selector rather than following the global switcher. */}
        <select
          value={selectedWk ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedWk(val || null);
          }}
          aria-label="Select workspace"
          className="px-2.5 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary max-w-xs"
        >
          <option value="">— select —</option>
          {workspaces.map((ws) => (
            <option key={ws.key} value={ws.key}>
              {ws.label}
            </option>
          ))}
        </select>
      </div>

      {/* Agent board — shown when workspace selected */}
      {selectedWk && (
        <>
          {statusError && (
            <p role="alert" className="px-4 py-2 text-xs text-danger">
              {statusError}
            </p>
          )}
          {officeView === "floor" ? (
            boardStatus === null ? (
              <LoadingState label="Loading agents…" />
            ) : (
              <OfficeFloor
                entries={boardStatus.agents}
                selectedId={liveSelection}
                onSelect={(id) => setFloorSelection((prev) => (prev === id ? null : id))}
                onHire={() => setOfficeView("list")}
              />
            )
          ) : null}
          {/* Floor and list are exclusive views of one roster. In floor view the
              board is narrowed to the selected desk, so a name never renders
              twice. `liveSelection` is used, not `floorSelection`: an agent that
              left the roster must not filter the board down to nothing. */}
          {officeView === "list" || liveSelection !== null ? (
            <AgentBoard
              wk={selectedWk}
              workdir={workspaces.find((w) => w.key === selectedWk)?.label ?? ""}
              status={
                officeView === "floor" && liveSelection !== null && boardStatus !== null
                  ? { agents: boardStatus.agents.filter((e) => e.agent.id === liveSelection) }
                  : boardStatus
              }
              onRefresh={() => handleRefresh(selectedWk)}
            />
          ) : null}
        </>
      )}

      {/* Roles — global, not workspace-scoped */}
      <section className="px-5 py-4 rounded-xl border border-border bg-surface">
        <RoleManager />
      </section>

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
