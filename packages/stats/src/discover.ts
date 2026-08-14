import { z } from "zod";

// Reader for the PreToolUse telemetry log written by the CLI hook
// (apps/cli/src/hooks/logger.ts). Same lenient JSONL discipline as
// ingestHookLog: a corrupt or partially-written line is skipped, never fatal.
// `agent` is carried, not gated — the log is single-agent in practice.
export const hookLogRowSchema = z.object({
  timestamp: z.string(),
  tool: z.string(),
  category: z.string(),
  agent: z.string().optional(),
  filePath: z.string().optional(),
  sessionId: z.string().optional(),
});

export type HookLogRow = z.infer<typeof hookLogRowSchema>;

export function parseHookLogRows(content: string): HookLogRow[] {
  const rows: HookLogRow[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = hookLogRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}
