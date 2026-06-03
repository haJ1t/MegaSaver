// Order: alphabetic (matches AA3 convention for human-facing closed enums).
export const VIEW_IDS = ["agent-setup", "memory", "sessions"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-setup": "Agent setup",
  memory: "Memory entries",
  sessions: "Sessions",
};
