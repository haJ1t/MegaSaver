// Order: alphabetic (matches AA3 convention for human-facing closed enums).
// Nav rendering order is defined separately (see NAV_GROUPS in app.tsx) so the
// sidebar can group views logically without breaking the pinned enum order.
export const VIEW_IDS = [
  "agent-setup",
  "claude-sessions",
  "context",
  "index",
  "memory",
  "overview",
  "rules",
  "sessions",
  "tasks",
  "tools",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-setup": "Agent setup",
  "claude-sessions": "Claude sessions",
  context: "Context",
  index: "Index",
  memory: "Memory",
  overview: "Overview",
  rules: "Rules",
  sessions: "Sessions",
  tasks: "Tasks",
  tools: "Tools",
};

// Views that need a selected project. `agent-setup` renders regardless (it is
// global MCP setup); `overview` needs a project to show its summary.
export const PROJECT_SCOPED_VIEWS: ReadonlySet<ViewId> = new Set([
  "overview",
  "sessions",
  "memory",
  "rules",
  "index",
  "context",
  "tasks",
  "tools",
]);
