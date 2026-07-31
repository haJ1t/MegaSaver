import { useState } from "react";
import { HandoffCard } from "../components/handoff-card.js";
import { SkillPacksCard } from "../components/skill-packs-card.js";
import type { WorkspaceOption } from "../lib/workspace-context.js";
import { WorkspaceContextPanel } from "./cockpit/workspace-context-panel.js";
import { WorkspaceIndexPanel } from "./cockpit/workspace-index-panel.js";
import { WorkspacePermissionsPanel } from "./cockpit/workspace-permissions-panel.js";
import { WorkspaceRulesPanel } from "./cockpit/workspace-rules-panel.js";
import { WorkspaceToolsPanel } from "./cockpit/workspace-tools-panel.js";

const TABS = ["Index", "Context", "Rules", "Tools", "Permissions"] as const;
type Tab = (typeof TABS)[number];

export function WorkspacePage({
  options,
  activeKey,
}: {
  options: WorkspaceOption[];
  activeKey: string | null;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>("Index");
  const key = activeKey ?? options[0]?.key ?? null;
  const active = options.find((o) => o.key === key) ?? null;

  return (
    <div className="max-w-[1000px] flex flex-col gap-4 px-5 py-7">
      <div>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Workspace</h1>
        <p className="mt-1 mb-0 text-text-secondary">
          What the agent can read, must obey, and is allowed to run
          {active ? (
            <>
              {" "}
              in <span className="font-mono text-sm">{active.cwd}</span>
            </>
          ) : null}
          .
        </p>
      </div>

      {key === null ? (
        <p className="text-sm text-text-muted">Select a workspace to inspect.</p>
      ) : (
        <>
          <HandoffCard workspaceKey={key} />

          <div
            role="tablist"
            aria-label="Workspace facets"
            className="flex gap-5 border-b border-border"
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`ws-tab-${t}`}
                aria-controls="ws-tabpanel"
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                onKeyDown={(e) => {
                  const i = TABS.indexOf(t);
                  const next =
                    e.key === "ArrowRight"
                      ? TABS[(i + 1) % TABS.length]
                      : e.key === "ArrowLeft"
                        ? TABS[(i - 1 + TABS.length) % TABS.length]
                        : undefined;
                  if (!next) return;
                  e.preventDefault();
                  setTab(next);
                  document.getElementById(`ws-tab-${next}`)?.focus();
                }}
                onClick={() => setTab(t)}
                className={[
                  "px-0.5 py-2.5 text-sm border-b-2 cursor-pointer transition-colors",
                  tab === t
                    ? "border-accent text-text-primary font-semibold"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                ].join(" ")}
              >
                {t}
              </button>
            ))}
          </div>

          <section
            role="tabpanel"
            id="ws-tabpanel"
            aria-labelledby={`ws-tab-${tab}`}
            className="px-5 py-4 rounded-xl border border-border bg-surface"
          >
            {tab === "Index" ? <WorkspaceIndexPanel workspaceKey={key} /> : null}
            {tab === "Context" ? <WorkspaceContextPanel workspaceKey={key} /> : null}
            {tab === "Rules" ? <WorkspaceRulesPanel workspaceKey={key} /> : null}
            {tab === "Tools" ? <WorkspaceToolsPanel workspaceKey={key} /> : null}
            {tab === "Permissions" ? <WorkspacePermissionsPanel workspaceKey={key} /> : null}
          </section>

          <SkillPacksCard />
        </>
      )}
    </div>
  );
}
