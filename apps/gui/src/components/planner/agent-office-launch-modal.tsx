import type { PlannerCard } from "@megasaver/core";
import React, { useState } from "react";

export function AgentOfficeLaunchModal(props: {
  card: PlannerCard;
  cwd: string;
  onClose: () => void;
  onLaunched: () => void;
}): JSX.Element {
  const { card, cwd, onClose, onLaunched } = props;
  const [roleId, setRoleId] = useState(card.assignedAgent || "builder");
  const [loading, setLoading] = useState(false);

  const handleLaunch = async () => {
    setLoading(true);
    try {
      const prompt = `Task: ${card.title}\n\n${card.content}`;
      const res = await fetch(
        `/api/office/${encodeURIComponent(cwd)}/agents/${encodeURIComponent(roleId)}/tasks`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: card.title, prompt }),
        },
      );
      if (res.ok) {
        onLaunched();
      } else {
        alert("Failed to launch task in Agent Office.");
      }
    } catch {
      alert("Error launching task.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-lg bg-surface-elevated border border-border-subtle rounded-xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border-subtle">
          <h2 className="text-base font-bold text-text-primary">Launch Agent Office Task</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-sm"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 text-xs">
          <div>
            <span className="font-semibold text-text-muted">Task:</span>
            <div className="font-medium text-text-primary mt-0.5">{card.title}</div>
          </div>

          <div>
            <label
              htmlFor="agent-role-select"
              className="block font-semibold text-text-muted uppercase text-3xs mb-1"
            >
              Select Agent Role
            </label>
            <select
              id="agent-role-select"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface border border-border-subtle text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="builder">builder (Feature & Code Builder)</option>
              <option value="claude-code">claude-code (Claude Code Agent)</option>
              <option value="architect">architect (System Architect)</option>
              <option value="reviewer">reviewer (Code Reviewer)</option>
            </select>
          </div>

          <div className="p-3 rounded-lg bg-surface/50 border border-border-subtle text-2xs text-text-muted">
            Launching will create an autonomous task in Agent Office using this card's description
            as context.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-subtle">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-subtle hover:bg-surface text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleLaunch}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-contrast hover:bg-accent-hover transition-colors shadow-sm disabled:opacity-50"
          >
            {loading ? "Launching..." : "Launch Task"}
          </button>
        </div>
      </div>
    </div>
  );
}
