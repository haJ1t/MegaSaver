import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/;

// A docs block spans from its heading line to the line before the next heading
// (or end of file). A heading-less file yields no blocks. Content that appears
// BEFORE the first heading (intro / frontmatter) is captured as an "(intro)"
// block so it isn't silently dropped — but only when the file has headings.
export function extractMd(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");
  const headings: { line: number; name: string }[] = [];
  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line);
    if (match?.[1] !== undefined) {
      headings.push({ line: index + 1, name: match[1] });
    }
  });

  const block = (startLine: number, endLine: number, name: string): ExtractedBlock => ({
    filePath,
    startLine,
    endLine,
    blockType: "docs",
    name,
    contentHash: hashText(lines.slice(startLine - 1, endLine).join("\n")),
    imports: [],
    exports: [],
    calls: [],
    calledBy: [],
    keywords: tokenize(name),
  });

  const blocks: ExtractedBlock[] = [];
  const firstHeading = headings[0];
  if (firstHeading && firstHeading.line > 1) {
    const introEnd = firstHeading.line - 1;
    if (lines.slice(0, introEnd).join("\n").trim().length > 0) {
      blocks.push(block(1, introEnd, "(intro)"));
    }
  }
  headings.forEach((heading, index) => {
    const next = headings[index + 1];
    blocks.push(block(heading.line, next ? next.line - 1 : lines.length, heading.name));
  });
  return blocks;
}
