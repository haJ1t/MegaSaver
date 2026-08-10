import type { PlannerCard, PlannerColumn, PlannerStatus } from "@megasaver/core";
import React from "react";
import { KanbanCard } from "./kanban-card.js";

const COLUMN_INDICATORS: Record<PlannerStatus, string> = {
  backlog: "bg-zinc-500",
  todo: "bg-sky-500",
  "in-progress": "bg-amber-500",
  review: "bg-indigo-500",
  done: "bg-emerald-500",
};

export function KanbanColumnComponent(props: {
  column: PlannerColumn;
  onSelectCard: (card: PlannerCard) => void;
  onMoveCardStatus: (cardId: string, newStatus: PlannerStatus) => void;
  onAddCard: (status: PlannerStatus) => void;
}): JSX.Element {
  const { column, onSelectCard, onMoveCardStatus, onAddCard } = props;
  const dotColor = COLUMN_INDICATORS[column.key] ?? "bg-zinc-500";

  return (
    <div className="flex flex-col flex-1 min-w-[240px] max-w-[320px] bg-surface/50 border border-border-subtle rounded-xl p-3">
      <div className="flex items-center justify-between pb-3 mb-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
          <span className="font-semibold text-sm text-text-primary">{column.title}</span>
          <span className="px-1.5 py-0.5 text-2xs font-medium rounded-full bg-surface-subtle text-text-muted">
            {column.count}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onAddCard(column.key)}
          className="p-1 rounded hover:bg-surface-elevated text-text-muted hover:text-text-primary transition-colors text-sm leading-none"
          title={`Add task to ${column.title}`}
        >
          +
        </button>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-0.5">
        {column.cards.length === 0 ? (
          <div className="py-8 text-center text-2xs text-text-muted border border-dashed border-border-subtle rounded-lg">
            No cards in {column.title.toLowerCase()}
          </div>
        ) : (
          column.cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              onClick={() => onSelectCard(card)}
              onMoveStatus={(newStatus) => onMoveCardStatus(card.id, newStatus)}
            />
          ))
        )}
      </div>
    </div>
  );
}
