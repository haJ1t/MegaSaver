import type { PlannerCard, PlannerPriority, PlannerStatus } from "@megasaver/core";
import React, { useState } from "react";
import { AgentOfficeLaunchModal } from "./agent-office-launch-modal.js";

export function CardDrawer(props: {
  card: PlannerCard;
  cwd?: string;
  onClose: () => void;
  onSave: (updated: {
    id: string;
    title: string;
    status: PlannerStatus;
    priority: PlannerPriority;
    tags: string[];
    assignedAgent: string | null;
    content: string;
  }) => void;
}): JSX.Element {
  const { card, cwd = "", onClose, onSave } = props;

  const [title, setTitle] = useState(card.title);
  const [status, setStatus] = useState<PlannerStatus>(card.status);
  const [priority, setPriority] = useState<PlannerPriority>(card.priority);
  const [tagsStr, setTagsStr] = useState(card.tags.join(", "));
  const [assignedAgent, setAssignedAgent] = useState<string | null>(card.assignedAgent);
  const [content, setContent] = useState(card.content);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [launchModalOpen, setLaunchModalOpen] = useState(false);

  const handleSave = () => {
    const tags = tagsStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSave({
      id: card.id,
      title,
      status,
      priority,
      tags,
      assignedAgent,
      content,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="flex flex-col w-full max-w-2xl h-full bg-surface-elevated border-l border-border-subtle shadow-2xl p-6 overflow-y-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-accent-soft text-accent">
              {card.id}
            </span>
            <span className="text-xs text-text-muted">in {card.filePath}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-surface text-text-muted hover:text-text-primary transition-colors text-base"
          >
            ✕
          </button>
        </div>

        {/* Title Input */}
        <div>
          <label
            htmlFor="card-title-input"
            className="block text-2xs font-semibold text-text-muted uppercase mb-1"
          >
            Title
          </label>
          <input
            id="card-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-base font-semibold rounded-lg bg-surface border border-border-subtle text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        {/* Metadata Controls */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-surface/50 border border-border-subtle rounded-xl text-xs">
          <div>
            <label
              htmlFor="card-status-select"
              className="block text-3xs font-semibold text-text-muted uppercase mb-1"
            >
              Status
            </label>
            <select
              id="card-status-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as PlannerStatus)}
              className="w-full px-2 py-1.5 rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none"
            >
              <option value="backlog">Backlog</option>
              <option value="todo">To Do</option>
              <option value="in-progress">In Progress</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="card-priority-select"
              className="block text-3xs font-semibold text-text-muted uppercase mb-1"
            >
              Priority
            </label>
            <select
              id="card-priority-select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as PlannerPriority)}
              className="w-full px-2 py-1.5 rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="card-agent-input"
              className="block text-3xs font-semibold text-text-muted uppercase mb-1"
            >
              Assigned Agent
            </label>
            <input
              id="card-agent-input"
              type="text"
              placeholder="e.g. builder"
              value={assignedAgent ?? ""}
              onChange={(e) => setAssignedAgent(e.target.value || null)}
              className="w-full px-2 py-1.5 rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="card-tags-input"
              className="block text-3xs font-semibold text-text-muted uppercase mb-1"
            >
              Tags
            </label>
            <input
              id="card-tags-input"
              type="text"
              placeholder="gui, feature"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-surface-elevated border border-border-subtle text-text-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Content Editor / Preview */}
        <div className="flex flex-col flex-1 min-h-0 space-y-2">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab("edit")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                  tab === "edit"
                    ? "bg-accent-soft text-accent"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                Edit Markdown
              </button>
              <button
                type="button"
                onClick={() => setTab("preview")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                  tab === "preview"
                    ? "bg-accent-soft text-accent"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                Preview
              </button>
            </div>

            {status === "in-progress" ? (
              <button
                type="button"
                onClick={() => setLaunchModalOpen(true)}
                className="px-3 py-1 text-xs font-medium rounded-lg bg-emerald-950/50 text-emerald-400 border border-emerald-800/50 hover:bg-emerald-900/50 transition-colors"
              >
                ⚡ Launch Agent Task
              </button>
            ) : null}
          </div>

          {tab === "edit" ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 w-full p-3 text-xs font-mono rounded-lg bg-surface border border-border-subtle text-text-primary focus:outline-none focus:border-accent resize-none min-h-[250px]"
            />
          ) : (
            <div className="flex-1 p-3 text-xs rounded-lg bg-surface border border-border-subtle text-text-primary whitespace-pre-wrap font-mono min-h-[250px] overflow-y-auto">
              {content || "(empty description)"}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border-subtle">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-border-subtle hover:bg-surface text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors shadow-sm"
          >
            Save Changes
          </button>
        </div>
      </div>

      {launchModalOpen ? (
        <AgentOfficeLaunchModal
          card={card}
          cwd={cwd}
          onClose={() => setLaunchModalOpen(false)}
          onLaunched={() => {
            setLaunchModalOpen(false);
            alert("Task launched in Agent Office.");
          }}
        />
      ) : null}
    </div>
  );
}
