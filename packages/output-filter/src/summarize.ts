import type { TokenSaverMode } from "@megasaver/shared";
import type { RankedChunk } from "./rank.js";

const ERROR_LINE = /^.*\b(?:error|failed|failure|exception)\b.*$/im;

function topErrorLine(kept: readonly RankedChunk[]): string | undefined {
  for (const chunk of kept) {
    const match = chunk.text.match(ERROR_LINE);
    if (match) return match[0].trim();
  }
  return undefined;
}

export function summarize(
  mode: TokenSaverMode,
  kept: readonly RankedChunk[],
  droppedCount: number,
): string {
  const counts = `${kept.length} kept, ${droppedCount} dropped`;
  const error = topErrorLine(kept);

  if (mode === "aggressive") {
    return counts;
  }
  if (mode === "balanced") {
    return error ? `${counts}; top error: ${error}` : counts;
  }
  return error
    ? `Output filtered: ${counts} chunk(s). Top error line: ${error}`
    : `Output filtered: ${counts} chunk(s).`;
}
