import type { MemoryEntry } from "./memory-entry.js";

export type PrMemoryCommentOptions = {
  projectName: string;
  task?: string;
  heading?: string;
};

const DEFAULT_HEADING = "Mega Saver — relevant project memory";

// Markdown-escape a single-line field so a memory's content cannot break the
// rendered comment (backticks open code spans; pipes break tables; the renderer
// boundary is a real corruption risk — escape defensively here).
function escapeField(value: string): string {
  return value.replace(/[\\`|]/g, (ch) => `\\${ch}`);
}

export function buildPrMemoryComment(
  memories: readonly MemoryEntry[],
  opts: PrMemoryCommentOptions,
): string {
  const lines: string[] = [`## ${opts.heading ?? DEFAULT_HEADING}`, ""];
  lines.push(`Project: \`${escapeField(opts.projectName)}\``);
  if (opts.task !== undefined && opts.task.trim().length > 0) {
    lines.push(`Task: ${escapeField(opts.task)}`);
  }
  lines.push("");
  if (memories.length === 0) {
    lines.push("No relevant approved project memory.");
    return `${lines.join("\n")}\n`;
  }
  for (const m of memories) {
    lines.push(
      `- **${escapeField(m.type)}** (${escapeField(m.confidence)}): ${escapeField(m.title)}`,
    );
    lines.push(`  ${escapeField(m.content)}`);
    if (m.relatedFiles !== undefined && m.relatedFiles.length > 0) {
      lines.push(`  files: ${m.relatedFiles.map((f) => `\`${escapeField(f)}\``).join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
