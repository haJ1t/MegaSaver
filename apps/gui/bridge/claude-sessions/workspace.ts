import { createHash } from "node:crypto";
import type { ClaudeSessionMeta, Workspace } from "./types.js";

const WORKSPACE_KEY_HEX_LEN = 16;

export function encodeWorkspaceKey(cwd: string): string {
  return createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, WORKSPACE_KEY_HEX_LEN);
}

export function groupSessionsByWorkspace(sessions: ClaudeSessionMeta[]): Workspace[] {
  const byCwd = new Map<string, { label: string; count: number; lastActivityMs: number }>();
  for (const s of sessions) {
    const cwd = s.projectLabel;
    if (cwd.length === 0) continue;
    const key = encodeWorkspaceKey(cwd);
    const existing = byCwd.get(key);
    if (existing) {
      existing.count += 1;
      if (s.mtimeMs > existing.lastActivityMs) existing.lastActivityMs = s.mtimeMs;
    } else {
      byCwd.set(key, { label: cwd, count: 1, lastActivityMs: s.mtimeMs });
    }
  }
  return [...byCwd]
    .map(([key, v]) => ({
      key,
      label: v.label,
      sessionCount: v.count,
      lastActivityMs: v.lastActivityMs,
    }))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
}
