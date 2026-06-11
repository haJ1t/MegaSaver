import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/;

// A docs block spans from its heading line to the line before the next heading
// (or end of file). Heading-less files yield no blocks.
export function extractMd(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");
  const headings: { line: number; name: string }[] = [];
  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line);
    if (match?.[1] !== undefined) {
      headings.push({ line: index + 1, name: match[1] });
    }
  });

  return headings.map((heading, index) => {
    const startLine = heading.line;
    const next = headings[index + 1];
    const endLine = next ? next.line - 1 : lines.length;
    const text = lines.slice(startLine - 1, endLine).join("\n");
    return {
      filePath,
      startLine,
      endLine,
      blockType: "docs",
      name: heading.name,
      contentHash: hashText(text),
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      keywords: tokenize(heading.name),
    };
  });
}
