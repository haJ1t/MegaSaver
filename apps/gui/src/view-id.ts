// Order: alphabetic (matches AA3 convention for human-facing closed enums).
// Nav rendering order is defined separately (see NAV_VIEWS in app.tsx) so the
// header can order destinations logically without breaking the pinned enum.
export const VIEW_IDS = ["agent-setup", "claude-sessions"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-setup": "Agent setup",
  "claude-sessions": "Claude sessions",
};
