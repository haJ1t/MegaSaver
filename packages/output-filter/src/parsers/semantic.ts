import { chunkByLines } from "../chunk.js";
import type { Chunk } from "../rank.js";

type Extractor = (
  filePath: string,
  source: string,
) => ReadonlyArray<{
  startLine: number;
  endLine: number;
}>;

// @megasaver/indexer statically imports the multi-MB `typescript` compiler.
// Loading it lazily keeps it out of output-filter's eager import graph so a
// plain `import("@megasaver/output-filter")` (and thus every per-tool-call
// hook / daemon / CLI start) never pays the compiler load — only an actual
// semantic chunk of a supported source file does.
let indexerMod: typeof import("@megasaver/indexer") | undefined;
async function loadExtractors(): Promise<typeof import("@megasaver/indexer")> {
  if (indexerMod === undefined) indexerMod = await import("@megasaver/indexer");
  return indexerMod;
}

const TS_EXT = /\.(mts|cts|tsx|jsx|ts|js|mjs|cjs)$/;
const PY_EXT = /\.py$/;
const GO_EXT = /\.go$/;
const RS_EXT = /\.rs$/;

function extractorFor(
  path: string,
  extractors: typeof import("@megasaver/indexer"),
): Extractor | undefined {
  if (TS_EXT.test(path)) return extractors.extractTs;
  if (PY_EXT.test(path)) return extractors.extractPy;
  if (GO_EXT.test(path)) return extractors.extractGo;
  if (RS_EXT.test(path)) return extractors.extractRs;
  if (path.endsWith(".md")) return extractors.extractMd;
  if (path.endsWith(".json")) return extractors.extractJson;
  return undefined;
}

// A semantic block longer than this is sub-split into line windows so its
// parts can be ranked/fit individually instead of dropped whole by fitBudget.
// ponytail: line cap, not budget — the chunker has no mode/budget in scope.
const OVERSIZE_BLOCK_LINES = 80;

// Line windows for [start, end] (1-indexed inclusive), with chunkByLines'
// 1-based output remapped to begin at `start`. A span whose text is empty (a
// lone trailing blank line) still emits one chunk so block sub-splitting stays
// exhaustive; gap-fill drops the all-whitespace ones (see gapChunks).
function lineChunksFor(lines: readonly string[], start: number, end: number): Chunk[] {
  const text = lines.slice(start - 1, end).join("\n");
  if (text === "") return [{ text, startLine: start, endLine: end }];
  return chunkByLines(text, OVERSIZE_BLOCK_LINES).map((c) => ({
    text: c.text,
    startLine: c.startLine + (start - 1),
    endLine: c.endLine + (start - 1),
  }));
}

// Gap-fill for an uncovered range, with pure-whitespace chunks dropped. Blank
// separators between blocks carry no rankable content; emitting them pollutes
// the excerpt list with empty chunks. Block content is never routed here.
function gapChunks(lines: readonly string[], start: number, end: number): Chunk[] {
  return lineChunksFor(lines, start, end).filter((c) => c.text.trim() !== "");
}

export function partitionFile(
  text: string,
  blocks: ReadonlyArray<{ startLine: number; endLine: number }>,
  oversizeLines: number = OVERSIZE_BLOCK_LINES,
): Chunk[] {
  if (text === "") return [];
  const lines = text.split("\n");
  const lastLine = lines.length;
  const spans = [...blocks]
    .map((b) => ({
      startLine: Math.max(1, b.startLine),
      endLine: Math.min(lastLine, b.endLine),
    }))
    .filter((b) => b.endLine >= b.startLine)
    .sort((a, b) => a.startLine - b.startLine);

  const chunks: Chunk[] = [];
  let cursor = 1;
  for (const span of spans) {
    if (span.startLine < cursor) continue; // already covered (defensive)
    if (span.startLine > cursor) {
      chunks.push(...gapChunks(lines, cursor, span.startLine - 1));
    }
    const blockLineCount = span.endLine - span.startLine + 1;
    if (blockLineCount > oversizeLines) {
      chunks.push(...lineChunksFor(lines, span.startLine, span.endLine));
    } else {
      chunks.push({
        text: lines.slice(span.startLine - 1, span.endLine).join("\n"),
        startLine: span.startLine,
        endLine: span.endLine,
      });
    }
    cursor = span.endLine + 1;
  }
  if (cursor <= lastLine) {
    chunks.push(...gapChunks(lines, cursor, lastLine));
  }
  return chunks;
}

function isSupportedSource(path: string): boolean {
  return (
    TS_EXT.test(path) ||
    PY_EXT.test(path) ||
    GO_EXT.test(path) ||
    RS_EXT.test(path) ||
    path.endsWith(".md") ||
    path.endsWith(".json")
  );
}

// Returns null (never throws) to signal "use line chunking": unsupported
// extension, parse failure, or zero extracted blocks all collapse to one
// fallback path for the gate and the caller. Async only because the indexer
// (and its `typescript` dep) is loaded lazily — the extension precheck avoids
// that load entirely for unsupported sources.
export async function chunkBySemantic(text: string, path: string): Promise<Chunk[] | null> {
  if (!isSupportedSource(path)) return null;
  const extractor = extractorFor(path, await loadExtractors());
  if (extractor === undefined) return null;
  let blocks: ReadonlyArray<{ startLine: number; endLine: number }>;
  try {
    blocks = extractor(path, text);
  } catch {
    return null;
  }
  if (blocks.length === 0) return null;
  return partitionFile(text, blocks, OVERSIZE_BLOCK_LINES);
}
