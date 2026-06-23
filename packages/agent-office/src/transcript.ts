import type { LauncherEvent } from "@megasaver/connectors-shared";
import { officeTranscriptIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const transcriptRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "tool_result",
  "result",
  "stderr",
]);
export type TranscriptRole = z.infer<typeof transcriptRoleSchema>;

export const transcriptEntrySchema = z
  .object({
    id: officeTranscriptIdSchema,
    seq: z.number().int().nonnegative(),
    ts: z.string().datetime({ offset: true }),
    role: transcriptRoleSchema,
    text: z.string().optional(),
    tool: z.string().optional(),
    summary: z.string().optional(),
  })
  .strict();
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

// The projected shape before the supervisor stamps id/seq/ts.
export type TranscriptEntryInput = {
  role: TranscriptRole;
  text?: string;
  tool?: string;
  summary?: string;
};

const MAX = 200;
// Assistant prose is the readable core of the feed, so it gets a far larger cap
// than tool summaries — but it is still bounded: an unbounded entry would be a
// disk/SSE DoS and persist arbitrarily large quoted content.
const ASSISTANT_MAX = 4000;
const truncate = (s: string, n = MAX): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const basename = (p: string): string => p.split("/").pop() ?? p;

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
};

function toolSummary(name: string, input: unknown): string | undefined {
  const obj = (input ?? {}) as { file_path?: unknown; command?: unknown };
  if (
    (name === "Edit" || name === "Write" || name === "Read") &&
    typeof obj.file_path === "string"
  ) {
    return basename(obj.file_path);
  }
  if (name === "Bash" && typeof obj.command === "string") return truncate(obj.command, 80);
  return undefined;
}

// Project a launcher event into a compact transcript entry. `payload` is
// external (claude stream-json) so it is narrowed defensively. Returns null for
// events that carry no user-facing signal (system/init, unrecognized shapes).
export function projectEvent(event: LauncherEvent): TranscriptEntryInput | null {
  if (event.kind === "stderr") {
    const s = event.text.trim();
    return s.length > 0 ? { role: "stderr", summary: truncate(s) } : null;
  }

  const p = event.payload as {
    type?: string;
    is_error?: boolean;
    message?: { content?: unknown };
  };
  if (!p || typeof p.type !== "string") return null;

  if (p.type === "result") {
    return { role: "result", summary: p.is_error ? "failed" : "done" };
  }

  if (p.type === "assistant" && Array.isArray(p.message?.content)) {
    for (const b of p.message.content as unknown[]) {
      if (typeof b !== "object" || b === null) continue;
      const block = b as ContentBlock;
      if (block.type === "text" && typeof block.text === "string") {
        return { role: "assistant", text: truncate(block.text, ASSISTANT_MAX) };
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        const summary = toolSummary(block.name, block.input);
        return summary !== undefined
          ? { role: "tool", tool: block.name, summary }
          : { role: "tool", tool: block.name };
      }
    }
    return null;
  }

  if (p.type === "user" && Array.isArray(p.message?.content)) {
    for (const b of p.message.content as unknown[]) {
      if (typeof b !== "object" || b === null) continue;
      const block = b as ContentBlock;
      if (block.type === "tool_result") {
        const c = block.content;
        const text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c
                  .map((x) =>
                    typeof x === "object" && x !== null
                      ? ((x as { text?: string }).text ?? "")
                      : "",
                  )
                  .join(" ")
              : "";
        return { role: "tool_result", summary: truncate(text.trim()) };
      }
    }
    return null;
  }

  return null;
}
