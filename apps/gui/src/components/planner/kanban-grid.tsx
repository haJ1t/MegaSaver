import type { PlannerBoard, PlannerCard, PlannerStatus } from "@megasaver/core";
import React from "react";
import { KanbanColumnComponent } from "./kanban-column.js";

export function KanbanGrid(props: {
  board: PlannerBoard;
  onSelectCard: (card: PlannerCard) => void;
  onMoveCardStatus: (cardId: string, newStatus: PlannerStatus) => void;
  onAddCard: (status: PlannerStatus) => void;
}): JSX.Element {
  const { board, onSelectCard, onMoveCardStatus, onAddCard } = props;

  return (
    <div className="flex gap-3 overflow-x-auto flex-1 min-h-0 pb-2">
      {board.columns.map((col) => (
        <KanbanColumnComponent
          key={col.key}
          column={col}
          onSelectCard={onSelectCard}
          onMoveCardStatus={onMoveCardStatus}
          onAddCard={onAddCard}
        />
      ))}
    </div>
  );
}
