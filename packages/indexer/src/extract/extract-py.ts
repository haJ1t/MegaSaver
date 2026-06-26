import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

const DECL_RE = /^(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;

// Heuristic Python extractor: top-level def/class only (nested methods are
// out of scope; gap-fill covers them). A block spans from its col-0 decl line
// to the line before the next col-0 non-blank line (indentation END), or EOF.
// Pure + never throws — chunkBySemantic falls back to line chunking on null.
export function extractPy(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");

  const block = (
    startLine: number,
    endLine: number,
    name: string,
    kind: string,
  ): ExtractedBlock => ({
    filePath,
    startLine,
    endLine,
    blockType: kind === "class" ? "class" : "function",
    name,
    contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: tokenize(name),
  });

  const isTopLevel = (line: string): boolean => line.length > 0 && !/^\s/.test(line);

  const blocks: ExtractedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = DECL_RE.exec(line);
    if (match === null) {
      continue;
    }
    // \w+ capture guarantees a non-empty name, so no conditional spread needed.
    const name = match[2] ?? "";
    const kind = match[1] ?? "def";
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isTopLevel(lines[j] ?? "")) {
        end = j;
        break;
      }
    }
    blocks.push(block(i + 1, end, name, kind));
    i = end - 1;
  }
  return blocks;
}
