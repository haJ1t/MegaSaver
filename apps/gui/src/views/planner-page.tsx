import type { PlannerBoard, PlannerCard, PlannerPriority, PlannerStatus } from "@megasaver/core";
import React, { useCallback, useEffect, useState } from "react";
import { CardDrawer } from "../components/planner/card-drawer.js";
import { KanbanGrid } from "../components/planner/kanban-grid.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";

export function PlannerPage(props: {
  options: WorkspaceOption[];
  activeKey: string | null;
}): JSX.Element {
  const { options, activeKey } = props;
  const activeWorkspace = options.find((w) => w.key === activeKey);
  const cwd = activeWorkspace?.rootPath ?? "";

  const [board, setBoard] = useState<PlannerBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [activeCard, setActiveCard] = useState<PlannerCard | null>(null);

  const activeCardId = activeCard?.id;

  const loadBoard = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/planner?cwd=${encodeURIComponent(cwd)}`);
      if (res.ok) {
        const data = (await res.json()) as { board: PlannerBoard };
        setBoard(data.board);
        if (activeCardId) {
          const fresh = data.board.columns
            .flatMap((col) => col.cards)
            .find((c) => c.id === activeCardId);
          if (fresh) setActiveCard(fresh);
        }
      }
    } catch {
      // safe fallback
    } finally {
      setLoading(false);
    }
  }, [cwd, activeCardId]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const handleMoveCardStatus = async (cardId: string, newStatus: PlannerStatus) => {
    if (!cwd || !board) return;
    setBoard((prev) => {
      if (!prev) return null;
      const updatedCols = prev.columns.map((col) => {
        const filtered = col.cards.filter((c) => c.id !== cardId);
        if (col.key === newStatus) {
          const movedCard = prev.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
          if (movedCard) filtered.push({ ...movedCard, status: newStatus });
        }
        return { ...col, cards: filtered, count: filtered.length };
      });
      return { ...prev, columns: updatedCols };
    });

    try {
      await fetch("/api/planner/card", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, id: cardId, status: newStatus }),
      });
    } catch {
      void loadBoard();
    }
  };

  const handleCreateCard = async (status: PlannerStatus) => {
    if (!cwd) return;
    const title = prompt("Task title:");
    if (!title) return;
    try {
      const res = await fetch("/api/planner/card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, title, status, priority: "medium" }),
      });
      if (res.ok) {
        const data = (await res.json()) as { card: PlannerCard };
        setActiveCard(data.card);
      }
      void loadBoard();
    } catch {
      // safe ignore
    }
  };

  const handleSaveCard = async (updated: {
    id: string;
    title: string;
    status: PlannerStatus;
    priority: PlannerPriority;
    tags: string[];
    assignedAgent: string | null;
    content: string;
  }) => {
    if (!cwd) return;
    try {
      await fetch("/api/planner/card", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd, ...updated }),
      });
      setActiveCard(null);
      void loadBoard();
    } catch {
      // safe ignore
    }
  };

  const handleSyncTodo = async () => {
    if (!cwd) return;
    try {
      const res = await fetch("/api/planner/sync-todo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      if (res.ok) {
        const data = (await res.json()) as { importedCount: number };
        alert(`Imported ${data.importedCount} tasks from TODO.md / KANBAN.md.`);
        void loadBoard();
      }
    } catch {
      // safe ignore
    }
  };

  const filteredBoard = board
    ? {
        ...board,
        columns: board.columns.map((col) => {
          const filtered = col.cards.filter((c) => {
            const matchesSearch =
              !search ||
              c.title.toLowerCase().includes(search.toLowerCase()) ||
              c.content.toLowerCase().includes(search.toLowerCase());
            const matchesPriority = selectedPriority === "all" || c.priority === selectedPriority;
            const matchesTag = selectedTag === "all" || c.tags.includes(selectedTag);
            return matchesSearch && matchesPriority && matchesTag;
          });
          return { ...col, cards: filtered, count: filtered.length };
        }),
      }
    : null;

  return (
    <div className="flex flex-col flex-1 h-full p-6 space-y-4 min-h-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-border-subtle">
        <div>
          <h1 className="text-xl font-bold text-text-primary tracking-tight">Project planner</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Hermes-style Markdown Kanban execution board stored in .megasaver/planner/
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSyncTodo}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-subtle hover:bg-surface-elevated text-text-secondary transition-colors"
          >
            Sync TODO.md
          </button>
          <button
            type="button"
            onClick={() => handleCreateCard("backlog")}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors shadow-sm"
          >
            + New Task
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-surface/40 border border-border-subtle rounded-xl">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-xs rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-2xs text-text-muted font-medium">Priority:</span>
          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="px-2 py-1 text-xs rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none"
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {board && board.tags.length > 0 ? (
            <>
              <span className="text-2xs text-text-muted font-medium ml-2">Tag:</span>
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="px-2 py-1 text-xs rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none"
              >
                <option value="all">All Tags</option>
                {board.tags.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </div>

      {/* Kanban Grid */}
      {loading && !board ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
          Loading board...
        </div>
      ) : filteredBoard ? (
        <KanbanGrid
          board={filteredBoard}
          onSelectCard={(c) => setActiveCard(c)}
          onMoveCardStatus={handleMoveCardStatus}
          onAddCard={handleCreateCard}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
          Select a valid workspace to view planner board.
        </div>
      )}

      {activeCard ? (
        <CardDrawer card={activeCard} onClose={() => setActiveCard(null)} onSave={handleSaveCard} />
      ) : null}
    </div>
  );
}
