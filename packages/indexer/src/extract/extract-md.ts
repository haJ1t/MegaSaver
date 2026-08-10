import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

// `#{1,6}` is bounded and `\s` matches exactly one character, so this pattern has
// NO unbounded quantifier and cannot backtrack at all. The name is taken by
// slicing rather than by a second quantifier — that is the whole point.
//
// Every earlier form paired `\s+` with a `(.+?)`/`(.+)` capture. Because both can
// match a space, a line that ultimately fails made the engine try every
// (whitespace-run x capture) split. Measured on `"#" + " "*W + "x"*W + "\r y"`:
// `\s+(.+?)\s*$` was CUBIC (1.2s/8.4s/67s at W=2k/4k/8k) and `\s+(.+)\r?$` was
// still QUADRATIC (1575 ms at W=32k). This form is 0.02 ms at W=32k.
const HEADING_RE = /^(#{1,6})\s/;

// `.` excludes line terminators, so every earlier regex form rejected a line with
// an interior \r / U+2028 / U+2029 as a side effect. Slicing has no such side
// effect, so the rejection is stated explicitly. A bare character class, so it
// stays linear.
const INTERIOR_LINE_TERMINATOR = /[\r\u2028\u2029]/;

// A docs block spans from its heading line to the line before the next heading
// (or end of file). A heading-less file yields no blocks. Content that appears
// BEFORE the first heading (intro / frontmatter) is captured as an "(intro)"
// block so it isn't silently dropped — but only when the file has headings.
export function extractMd(filePath: string, source: string): ExtractedBlock[] {
  const lines = source.split("\n");
  const headings: { line: number; name: string }[] = [];
  lines.forEach((line, index) => {
    const match = HEADING_RE.exec(line);
    if (match?.[1] === undefined) return;
    // trim() (not trimEnd()) also drops the rest of the leading whitespace run and
    // any trailing \r from a CRLF checkout, which is what the old `\s+ … \s*$`
    // pair did positionally.
    const name = line.slice(match[1].length).trim();
    if (name === "" || INTERIOR_LINE_TERMINATOR.test(name)) return;
    headings.push({ line: index + 1, name });
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
