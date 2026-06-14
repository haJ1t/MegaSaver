import { useState } from "react";
import { SessionCockpit } from "../cockpit/session-cockpit.js";
import type { ClaudeSessionMeta } from "../lib/claude-sessions-client.js";
import { WorkspaceSessionList } from "./workspace-session-list.js";

export function ClaudeSessionsView(): JSX.Element {
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);

  if (selected)
    return (
      <SessionCockpit
        dir={selected.dir}
        id={selected.id}
        cwd={selected.projectLabel}
        title={selected.title}
        onBack={() => setSelected(null)}
      />
    );
  return <WorkspaceSessionList onSelect={setSelected} />;
}
