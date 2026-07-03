// Order: alphabetic (AA3 convention for human-facing closed enums).
// Nav display order lives in NAV_ORDER (components/sidebar.tsx), decoupled
// from this pinned tuple.
export const VIEW_IDS = [
  "agent-office",
  "agent-setup",
  "memory",
  "sessions",
  "token-saver",
  "workspace",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-office": "Agent office",
  "agent-setup": "Agent setup",
  memory: "Memory",
  sessions: "Sessions",
  "token-saver": "Token saver",
  workspace: "Workspace",
};
