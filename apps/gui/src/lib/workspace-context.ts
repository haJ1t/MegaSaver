import { encodeWorkspaceKey } from "@megasaver/shared";
import type { ClaudeSessionMeta } from "./claude-sessions-client.js";
import { groupSessionsByCwd } from "./workspace-grouping.js";

export type WorkspaceOption = {
  key: string;
  cwd: string;
  label: string;
  rep: { dir: string; id: string };
};

// ponytail: single-sourced from the recent-session list. A workspace with no
// session in the fetched window won't appear — fine for a single-dev tool;
// widen to fetchWorkspaces() only if that gap bites.
export function deriveWorkspaceOptions(sessions: ClaudeSessionMeta[]): WorkspaceOption[] {
  return groupSessionsByCwd(sessions).flatMap((g) => {
    const rep = g.sessions[0];
    if (!rep) return [];
    return [
      {
        key: encodeWorkspaceKey(g.cwd),
        cwd: g.cwd,
        label: g.label,
        rep: { dir: rep.dir, id: rep.id },
      },
    ];
  });
}
