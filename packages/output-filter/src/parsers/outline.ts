import type { ExtractedBlock } from "@megasaver/indexer";
import type { Chunk } from "../rank.js";
import { loadExtractors, partitionFile } from "./semantic.js";

// Skeleton signature is verbatim source truncated at the body opener. A longer
// signature is shown clipped; the full body is one mega_fetch_chunk away, so the
// file-level read stays lossless.
// ponytail: 6-line cap + naive opener scan. Upgrade to the real body-opener
// (balanced brackets) only if wrapped signatures prove unreadable.
const SIGNATURE_MAX_LINES = 6;

type MetaExtractor = (filePath: string, source: string) => ExtractedBlock[];

// ponytail: mirrors extractorFor in semantic.ts (different return type — full ExtractedBlock vs span-only). Keep the extension set in sync when adding languages.
function extractorFor(
  path: string,
  mod: typeof import("@megasaver/indexer"),
): MetaExtractor | undefined {
  if (/\.(mts|cts|tsx|jsx|ts|js|mjs|cjs)$/.test(path)) return mod.extractTs;
  if (path.endsWith(".py")) return mod.extractPy;
  if (path.endsWith(".go")) return mod.extractGo;
  if (path.endsWith(".rs")) return mod.extractRs;
  if (path.endsWith(".md")) return mod.extractMd;
  if (path.endsWith(".json")) return mod.extractJson;
  return undefined;
}

export function renderSignature(
  lines: readonly string[],
  start: number,
  end: number,
  path: string,
): string {
  const first = (lines[start - 1] ?? "").trim();
  // md/json: heading/key line carries no meaningful indent — return it fully trimmed.
  if (path.endsWith(".md") || path.endsWith(".json")) return first;

  const opener = path.endsWith(".py") ? ":" : "{";
  const max = Math.min(end, start + SIGNATURE_MAX_LINES - 1);
  const out: string[] = [];
  for (let ln = start; ln <= max; ln++) {
    const line = lines[ln - 1] ?? "";
    out.push(line);
    if (line.includes(opener)) break;
  }
  let sig = out.join("\n").trimEnd();
  if (sig.endsWith("{")) sig = sig.slice(0, -1).trimEnd();
  return sig;
}

function uniqueImports(blocks: readonly ExtractedBlock[]): string[] {
  const seen = new Set<string>();
  for (const b of blocks) for (const imp of b.imports) seen.add(imp);
  return [...seen];
}

// Returns null (never throws) to signal "fall back to a normal read":
// unsupported extension, parse failure, or zero extracted blocks — identical
// fallback contract to chunkBySemantic. Async only because the indexer (and its
// typescript dep) loads lazily.
export async function outlineFile(
  text: string,
  path: string,
): Promise<{ skeleton: string; chunks: Chunk[] } | null> {
  if (text === "") return null;
  const extractor = extractorFor(path, await loadExtractors());
  if (extractor === undefined) return null;

  let blocks: ExtractedBlock[];
  try {
    blocks = extractor(path, text);
  } catch {
    return null;
  }
  if (blocks.length === 0) return null;

  const chunks = partitionFile(text, blocks, Number.POSITIVE_INFINITY);
  // ponytail: last-writer-wins on duplicate spans. Pre-1.0 extractors don't emit true duplicates; if they did, the block is omitted from the skeleton (its lines still ride in a covering chunk, so the read stays lossless).
  const idBySpan = new Map<string, number>();
  chunks.forEach((c, i) => idBySpan.set(`${c.startLine}:${c.endLine}`, i));

  const lines = text.split("\n");
  const lastLine = lines.length;
  const sorted = [...blocks]
    .map((b) => ({
      ...b,
      startLine: Math.max(1, b.startLine),
      endLine: Math.min(lastLine, b.endLine),
    }))
    .filter((b) => b.endLine >= b.startLine)
    .sort((a, b) => a.startLine - b.startLine);

  const declLines: string[] = [];
  const seenIds = new Set<number>();
  for (const b of sorted) {
    const id = idBySpan.get(`${b.startLine}:${b.endLine}`);
    // A block with no own chunk was folded by partitionFile's overlap guard;
    // its lines are still in a covering chunk (lossless), just not listed.
    if (id === undefined) continue;
    // Co-located declarations (multiple decls on one line, e.g. minified JSON)
    // share a single chunk; emit one skeleton entry per chunk so #ids stay
    // unique and the count is honest. The shared signature line already shows
    // every declaration on that line, and fetching the id returns them all.
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const sig = renderSignature(lines, b.startLine, b.endLine, path);
    declLines.push(`#${id}  L${b.startLine}-${b.endLine}  ${sig}`);
  }

  const imports = uniqueImports(blocks);
  const header = `outline: ${declLines.length} declaration(s), ${lastLine} line(s). Expand a body: mega_fetch_chunk(chunkSetId, <id>).`;
  const importLine = imports.length > 0 ? `imports: ${imports.join(", ")}` : "imports: (none)";
  const skeleton = [header, importLine, "", ...declLines].join("\n");

  return { skeleton, chunks };
}

// Public polyglot per-file extraction (code-truth anchor capture, i6). Wraps
// the private dispatch above: undefined = unsupported extension, so the
// caller falls back to file-level anchors. Async only because the indexer
// (and its typescript dep) loads lazily — never import it eagerly here.
export async function extractBlocksForFile(
  path: string,
  source: string,
): Promise<ExtractedBlock[] | undefined> {
  const extractor = extractorFor(path, await loadExtractors());
  if (extractor === undefined) return undefined;
  return extractor(path, source);
}
