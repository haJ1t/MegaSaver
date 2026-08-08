import type { PlannerCard, PlannerPriority, PlannerStatus } from "@megasaver/core";
import React from "react";

// Keyed by PlannerPriority rather than string: a total record over the union has
// no index signature, so `card.priority` indexes it without tripping TS's
// noPropertyAccessFromIndexSignature (which would force bracket access) or
// Biome's useLiteralKeys (which forbids it) — the two rules that deadlock here.
// Being total also means the lookup cannot miss, so no fallback is needed; a new
// priority becomes a compile error instead of a silent colour drop.
const PRIORITY_COLORS: Record<PlannerPriority, string> = {
  critical: "bg-red-950/40 text-red-400 border-red-800/50",
  high: "bg-amber-950/40 text-amber-400 border-amber-800/50",
  medium: "bg-sky-950/40 text-sky-400 border-sky-800/50",
  low: "bg-zinc-800/60 text-zinc-400 border-zinc-700/50",
};

export function KanbanCard(props: {
  card: PlannerCard;
  onClick: () => void;
  onMoveStatus: (newStatus: PlannerStatus) => void;
}): JSX.Element {
  const { card, onClick, onMoveStatus } = props;
  const pColor = PRIORITY_COLORS[card.priority];

  const STATUS_FLOW: PlannerStatus[] = ["backlog", "todo", "in-progress", "review", "done"];
  const currIdx = STATUS_FLOW.indexOf(card.status);
  const canMoveLeft = currIdx > 0;
  const canMoveRight = currIdx < STATUS_FLOW.length - 1;

  return (
    // biome-ignore lint/a11y/useSemanticElements: card container with sub-buttons
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className="group relative flex flex-col gap-2 p-3 bg-surface-elevated hover:bg-surface-elevated/80 border border-border-subtle hover:border-border-hover rounded-lg cursor-pointer transition-all duration-150 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider rounded border ${pColor}`}
        >
          {card.priority}
        </span>
        {card.assignedAgent ? (
          <span className="text-3xs px-1.5 py-0.5 rounded bg-accent-soft text-accent font-medium">
            @{card.assignedAgent}
          </span>
        ) : null}
      </div>

      <div className="font-medium text-sm text-text-primary group-hover:text-accent transition-colors line-clamp-2">
        {card.title}
      </div>

      {card.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {card.tags.map((t) => (
            <span
              key={t}
              className="text-3xs px-1.5 py-0.5 rounded bg-surface-subtle text-text-muted border border-border-subtle"
            >
              #{t}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between mt-1 pt-2 border-t border-border-subtle/50 text-2xs text-text-muted">
        <div>
          {card.checklist.total > 0 ? (
            <span
              className={
                card.checklist.completed === card.checklist.total
                  ? "text-emerald-400 font-medium"
                  : "text-text-muted"
              }
            >
              ✓ {card.checklist.completed}/{card.checklist.total}
            </span>
          ) : (
            <span className="text-3xs opacity-60">{card.id}</span>
          )}
        </div>

        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {canMoveLeft ? (
            <button
              type="button"
              title="Move left"
              onClick={() => onMoveStatus(STATUS_FLOW[currIdx - 1] as PlannerStatus)}
              className="px-1.5 py-0.5 rounded bg-surface-subtle hover:bg-surface text-text-secondary hover:text-text-primary text-2xs"
            >
              ←
            </button>
          ) : null}
          {canMoveRight ? (
            <button
              type="button"
              title="Move right"
              onClick={() => onMoveStatus(STATUS_FLOW[currIdx + 1] as PlannerStatus)}
              className="px-1.5 py-0.5 rounded bg-surface-subtle hover:bg-surface text-text-secondary hover:text-text-primary text-2xs"
            >
              →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
