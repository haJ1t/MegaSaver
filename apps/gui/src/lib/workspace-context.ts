import { encodeWorkspaceKey, workspaceLabel } from "@megasaver/shared";
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

/** Manual selection: derive options directly from the user's chosen paths. Falls back to discovered sessions if no custom paths set. */
export function deriveWorkspaceOptionsFromPaths(
  paths: string[],
  sessions: ClaudeSessionMeta[] = [],
): WorkspaceOption[] {
  if (paths.length === 0) {
    return deriveWorkspaceOptions(sessions);
  }
  return paths.map((cwd) => {
    const key = encodeWorkspaceKey(cwd);
    const rep = sessions.find((s) => s.projectLabel === cwd || s.projectLabel?.startsWith(cwd));
    const dashDir = cwd.length > 0 ? `-${cwd.slice(1).replace(/\//g, "-")}` : "workspace";
    return {
      key,
      cwd,
      label: cwd.split("/").filter(Boolean).at(-1) ?? workspaceLabel(cwd),
      rep: rep ? { dir: rep.dir, id: rep.id } : { dir: dashDir, id: "_workspace" },
    };
  });
}
