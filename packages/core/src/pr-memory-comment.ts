import type { MemoryEntry } from "./memory-entry.js";

export type PrMemoryCommentOptions = {
  projectName: string;
  task?: string;
  heading?: string;
};

const DEFAULT_HEADING = "Mega Saver — relevant project memory";

// Neutralize a memory field so it cannot break the rendered comment or inject
// markup. This is a teammate-facing surface posted into GitHub/Slack/email/CI
// scrapers, so escape defensively:
//   1. Collapse ALL line breaks to a single space — a newline followed by
//      `## ` would inject a real heading and shatter the list structure.
//   2. HTML-encode `& < >` (`&` FIRST) so content can't smuggle `<script>` or
//      raw HTML into renderers that don't sanitize. In markdown these entities
//      still display as the literal characters (`a < b` reads correctly).
//   3. Backslash-escape `\ ` `` ` `` `|` — backticks open code spans, pipes
//      break tables, backslash is the markdown escape char itself.
function escapeField(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`|]/g, (ch) => `\\${ch}`);
}

export function buildPrMemoryComment(
  memories: readonly MemoryEntry[],
  opts: PrMemoryCommentOptions,
): string {
  const lines: string[] = [`## ${escapeField(opts.heading ?? DEFAULT_HEADING)}`, ""];
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
