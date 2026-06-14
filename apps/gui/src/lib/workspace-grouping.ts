import type { ClaudeSessionMeta, ClaudeWorkspaceGroup } from "./claude-sessions-client.js";

function labelFor(cwd: string): string {
  const segments = cwd.split("/").filter((p) => p.length > 0);
  return segments.at(-1) ?? cwd;
}

export function groupSessionsByCwd(sessions: ClaudeSessionMeta[]): ClaudeWorkspaceGroup[] {
  const byCwd = new Map<string, ClaudeSessionMeta[]>();
  for (const s of sessions) {
    const cwd = s.projectLabel || "(unknown)";
    const list = byCwd.get(cwd) ?? [];
    list.push(s);
    byCwd.set(cwd, list);
  }
  const groups = [...byCwd.entries()].map(([cwd, list]) => {
    list.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { cwd, label: labelFor(cwd), sessions: list };
  });
  groups.sort((a, b) => (b.sessions[0]?.mtimeMs ?? 0) - (a.sessions[0]?.mtimeMs ?? 0));
  return groups;
}
