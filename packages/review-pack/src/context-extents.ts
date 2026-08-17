import type { LineRange } from "./git.js";
import { overlaps } from "./semantic-diff.js";

export type ContextExtent = {
  path: string;
  startLine: number;
  endLine: number;
  name?: string;
  blockType?: string;
  text: string;
};

export const FALLBACK_WINDOW = 20;

let indexerPromise: Promise<typeof import("@megasaver/indexer")> | null = null;
function getIndexer(): Promise<typeof import("@megasaver/indexer")> {
  if (!indexerPromise) {
    indexerPromise = import("@megasaver/indexer");
  }
  return indexerPromise;
}

const TS_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
]);

function getExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [];
  let curr = sorted[0];
  if (!curr) return [];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (!next) continue;
    if (next.start <= curr.end + 1) {
      curr = { start: curr.start, end: Math.max(curr.end, next.end) };
    } else {
      merged.push(curr);
      curr = next;
    }
  }
  merged.push(curr);
  return merged;
}

export async function enclosingExtents(input: {
  path: string;
  headText: string;
  ranges: readonly LineRange[];
}): Promise<ContextExtent[]> {
  const ext = getExtension(input.path);
  const lines = input.headText.split("\n");
  const totalLines = lines.length;

  if (input.ranges.length === 0) return [];

  let rawBlocks: Array<{
    startLine: number;
    endLine: number;
    name?: string;
    blockType?: string;
  }> = [];

  try {
    const indexer = await getIndexer();
    if (TS_EXTENSIONS.has(ext)) {
      rawBlocks = indexer.extractTs(input.path, input.headText);
    } else if (ext === ".md") {
      rawBlocks = indexer.extractMd(input.path, input.headText);
    } else if (ext === ".json") {
      rawBlocks = indexer.extractJson(input.path, input.headText);
    }
  } catch {
    rawBlocks = [];
  }

  const matchingBlocks = rawBlocks.filter((b) => overlaps(b, input.ranges));

  if (matchingBlocks.length > 0) {
    // Sort and deduplicate
    matchingBlocks.sort((a, b) => a.startLine - b.startLine);
    const seen = new Set<string>();
    const extents: ContextExtent[] = [];
    for (const b of matchingBlocks) {
      const key = `${b.startLine}:${b.endLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = lines.slice(b.startLine - 1, b.endLine).join("\n");
      extents.push({
        path: input.path,
        startLine: b.startLine,
        endLine: b.endLine,
        ...(b.name ? { name: b.name } : {}),
        ...(b.blockType ? { blockType: b.blockType } : {}),
        text,
      });
    }
    return extents;
  }

  // Fallback: window around each range
  const fallbackRanges: LineRange[] = input.ranges.map((r) => ({
    start: Math.max(1, r.start - FALLBACK_WINDOW),
    end: Math.min(totalLines, r.end + FALLBACK_WINDOW),
  }));

  const merged = mergeRanges(fallbackRanges);
  return merged.map((r) => ({
    path: input.path,
    startLine: r.start,
    endLine: r.end,
    text: lines.slice(r.start - 1, r.end).join("\n"),
  }));
}
