let processEntryAtMs: number | undefined;

export function recordTaskKickoffProcessEntry(): void {
  processEntryAtMs = Date.now();
}

export function taskKickoffDeadlineAtMs(deadlineMs: number, now: () => number = Date.now): number {
  return (processEntryAtMs ?? now()) + deadlineMs;
}
