import type { Session } from "@megasaver/core";
import type { RefObject } from "react";
import { AgentBadge, RiskBadge, StatusBadge } from "../components/badges.js";
import { SavingsBadge } from "../components/savings-badge.js";
import { shortId } from "../lib/short-id.js";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SessionsListProps = {
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  listRef: RefObject<HTMLDivElement>;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

export function SessionsList({
  sessions,
  selectedId,
  onSelect,
  listRef,
  onKeyDown,
}: SessionsListProps): JSX.Element {
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Sessions list"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex flex-col overflow-y-auto flex-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
    >
      {sessions.map((session) => {
        const isSelected = session.id === selectedId;
        const status: "open" | "ended" = session.endedAt === null ? "open" : "ended";
        return (
          <div
            key={session.id}
            role="option"
            aria-selected={isSelected}
            tabIndex={-1}
            onClick={() => onSelect(session.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(session.id);
              }
            }}
            className={[
              "flex flex-col gap-1 px-4 py-3 cursor-pointer",
              "border-b border-border",
              "transition-colors duration-100",
              isSelected ? "bg-accent/10 border-b-accent/20" : "hover:bg-surface-elevated",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted font-mono">{shortId(session.id)}…</span>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-text-primary truncate">
              {session.title ?? <span className="text-text-muted italic">untitled</span>}
            </p>
            <div className="flex items-center gap-2">
              <AgentBadge agentId={session.agentId} />
              <RiskBadge level={session.riskLevel} />
              <SavingsBadge tokenSaver={session.tokenSaver} />
              <span className="text-xs text-text-muted ml-auto">
                {formatDate(session.startedAt)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
