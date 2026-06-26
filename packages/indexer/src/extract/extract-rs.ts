import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

const FN_RE = /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/;
const TYPE_RE = /^(?:pub\s+)?(struct|enum|trait|mod|impl)\b\s*([A-Za-z_]\w*)?/;

// ponytail: naive brace count ignores strings/comments/char literals; accepted ceiling per spec.
function braceDelta(line: string): number {
  let delta = 0;
  for (const ch of line) {
    if (ch === "{") delta += 1;
    else if (ch === "}") delta -= 1;
  }
  return delta;
}

function balancedEnd(lines: readonly string[], start: number): number {
  // ;-terminated decls (e.g. `struct Unit;`) open no brace on their start line
  // and span exactly 1 line — without this guard the scan would run on into the
  // next decl's braces.
  if (!(lines[start] ?? "").includes("{")) return start + 1;
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i += 1) {
    depth += braceDelta(lines[i] ?? "");
    if (depth > 0) opened = true;
    if (opened && depth <= 0) return i + 1;
  }
  return opened ? lines.length : start + 1;
}

// Heuristic Rust extractor: top-level fn / struct / enum / trait / mod / impl
// only (nested decls are out of scope; gap-fill covers them). fn -> function;
// the rest -> class. Blocks brace-balance to their closing brace, clamping to
// EOF if never closed; a ;-terminated decl (e.g. struct Unit;) opens no brace
// and spans 1 line. Pure + never throws — chunkBySemantic falls back to line
// chunking on null.
export function extractRs(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");

  const block = (
    startLine: number,
    endLine: number,
    blockType: "function" | "class",
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
    const fn = FN_RE.exec(line);
    const ty = TYPE_RE.exec(line);
    if (fn === null && ty === null) continue;
    const end = balancedEnd(lines, i);
    if (fn !== null) blocks.push(block(i + 1, end, "function", fn[1]));
    else if (ty !== null) blocks.push(block(i + 1, end, "class", ty[2]));
    i = end - 1;
  }
  return blocks;
}
