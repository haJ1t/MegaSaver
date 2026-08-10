// Order: alphabetic (AA3 convention for human-facing closed enums).
// Nav display order and grouping live in NAV_GROUPS (components/sidebar.tsx),
// decoupled from this pinned tuple.
export const VIEW_IDS = [
  "agent-office",
  "agent-setup",
  "memory",
  "overview",
  "planner",
  "sessions",
  "token-saver",
  "workspace",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-office": "Agent office",
  "agent-setup": "Setup",
  memory: "Memory",
  overview: "Overview",
  planner: "Project planner",
  sessions: "Sessions",
  "token-saver": "Token saver",
  workspace: "Workspace",
};
