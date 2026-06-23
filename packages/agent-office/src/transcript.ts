import type { LauncherEvent } from "@megasaver/connectors-shared";
import { officeTranscriptIdSchema } from "@megasaver/shared";
import { z } from "zod";

export const transcriptRoleSchema = z.enum([
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
    for (const b of p.message.content as ContentBlock[]) {
      if (b.type === "text" && typeof b.text === "string") {
        return { role: "assistant", text: b.text };
      }
      if (b.type === "tool_use" && typeof b.name === "string") {
        const summary = toolSummary(b.name, b.input);
        return summary !== undefined
          ? { role: "tool", tool: b.name, summary }
          : { role: "tool", tool: b.name };
      }
    }
    return null;
  }

  if (p.type === "user" && Array.isArray(p.message?.content)) {
    for (const b of p.message.content as ContentBlock[]) {
      if (b.type === "tool_result") {
        const c = b.content;
        const text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.map((x) => (x as { text?: string }).text ?? "").join(" ")
              : "";
        return { role: "tool_result", summary: truncate(text.trim()) };
      }
    }
    return null;
  }

  return null;
}
