import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

const FUNC_RE = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/;
const TYPE_RE = /^type\s+([A-Za-z_]\w*)/;
const GROUP_RE = /^(?:var|const)\s*\(/;

// ponytail: naive delimiter count ignores strings/comments; accepted ceiling per spec.
function delimDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{" || ch === "(") delta += 1;
    else if (ch === "}" || ch === ")") delta -= 1;
  }
  return delta;
}

function balancedEnd(lines: readonly string[], start: number): number {
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i += 1) {
    depth += delimDelta(lines[i] ?? "");
    if (depth > 0) opened = true;
    if (opened && depth <= 0) return i + 1;
  }
  return opened ? lines.length : start + 1;
}

// Heuristic Go extractor: top-level func/type/grouped var|const only (nested
// decls are out of scope; gap-fill covers them). func -> function; type and
// grouped var(/const( -> schema. Blocks brace/paren-balance to their closing
// delimiter, clamping to EOF if never closed. Pure + never throws —
// chunkBySemantic falls back to line chunking on null.
export function extractGo(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");

  const block = (
    startLine: number,
    endLine: number,
    blockType: "function" | "schema",
    name: string | undefined,
  ): ExtractedBlock => ({
    filePath,
    startLine,
    endLine,
    blockType,
    ...(name !== undefined ? { name } : {}),
    contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: tokenize(name ?? ""),
  });

  const blocks: ExtractedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fn = FUNC_RE.exec(line);
    const ty = TYPE_RE.exec(line);
    const grp = GROUP_RE.exec(line);
    if (fn === null && ty === null && grp === null) continue;
    const end = balancedEnd(lines, i);
    if (fn !== null) blocks.push(block(i + 1, end, "function", fn[1]));
    else if (ty !== null) blocks.push(block(i + 1, end, "schema", ty[1]));
    else blocks.push(block(i + 1, end, "schema", undefined));
    i = end - 1;
  }
  return blocks;
}
