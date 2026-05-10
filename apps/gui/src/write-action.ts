// Order: alphabetic (AA3 convention for human-facing closed enums).
// Identifies which write flow is currently active in the frontend form-state reducer.
export const WRITE_ACTION_IDS = [
  "create-memory",
  "create-session",
  "end-session",
  "update-session",
] as const;
export type WriteAction = (typeof WRITE_ACTION_IDS)[number];
