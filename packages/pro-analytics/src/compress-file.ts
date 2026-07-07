import { INPUT_PRICE_PER_MTOK_USD, tokensFromBytes } from "@megasaver/stats";

export interface CompressionReport {
  originalBytes: number;
  compressedBytes: number;
  bytesSaved: number;
  tokensOriginal: number;
  tokensCompressed: number;
  tokensSaved: number;
  dollarsSaved: number;
  paragraphsCollapsed: number;
  listItemsDropped: number;
  changed: boolean;
  compressed: string;
}

// These match the exact markers compressProse emits (singular for N=1). The
// counts are a display aid derived by scanning output; the byte/token/dollar
// figures below are exact and independent of this scan.
const PARA_MARKER = /… \[(\d+) paragraphs?\]/g;
const LIST_MARKER = /… \[(\d+) more items?\]/g;

function sumMarkers(text: string, re: RegExp): number {
  let total = 0;
  for (const m of text.matchAll(re)) total += Number(m[1]);
  return total;
}

export function composeCompressionReport(original: string, compressed: string): CompressionReport {
  const originalBytes = Buffer.byteLength(original, "utf8");
  const compressedBytes = Buffer.byteLength(compressed, "utf8");
  const tokensOriginal = tokensFromBytes(originalBytes);
  const tokensCompressed = tokensFromBytes(compressedBytes);
  const tokensSaved = Math.max(0, tokensOriginal - tokensCompressed);
  return {
    originalBytes,
    compressedBytes,
    bytesSaved: Math.max(0, originalBytes - compressedBytes),
    tokensOriginal,
    tokensCompressed,
    tokensSaved,
    dollarsSaved: (tokensSaved / 1_000_000) * INPUT_PRICE_PER_MTOK_USD,
    paragraphsCollapsed: sumMarkers(compressed, PARA_MARKER),
    listItemsDropped: sumMarkers(compressed, LIST_MARKER),
    changed: compressed !== original,
    compressed,
  };
}

export function renderCompressionSummary(report: CompressionReport): string {
  return [
    "Lossy compression (deterministic, no model):",
    `  ${report.paragraphsCollapsed} extra paragraph(s) collapse to "… [N paragraphs]" markers`,
    `  ${report.listItemsDropped} list item(s) beyond the first 3 collapse to "… [N more items]"`,
    "  headings, code blocks, blockquotes, and each section's first paragraph kept verbatim",
    `Savings: ${report.originalBytes}→${report.compressedBytes} bytes · ~${report.tokensSaved} tokens · ~$${report.dollarsSaved.toFixed(2)} (est.)`,
  ].join("\n");
}
