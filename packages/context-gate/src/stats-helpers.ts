// Shared by run.ts and run-command.ts: stats-event plumbing helpers.

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The filter warning shape is "redacted N secret(s) before processing"; pull N
// back out for the stats event's secretsRedacted total.
export function redactedCount(warnings: readonly string[]): number {
  for (const w of warnings) {
    const m = /^redacted (\d+) secret/.exec(w);
    if (m?.[1] !== undefined) return Number(m[1]);
  }
  return 0;
}
