import { ConventionsError } from "./errors.ts";

export type ParsedBlock = {
  readonly id: string;
  readonly source: string;
  readonly fragment: string | undefined;
  readonly startLine: number;
  readonly endLine: number;
  readonly headerLine: string;
  readonly footerLine: string;
  readonly body: string;
};

export type ParsedFile = {
  readonly blocks: readonly ParsedBlock[];
  readonly lines: readonly string[];
};

const START_RE =
  /^<!--\s*conventions:start\s+id="([^"]+)"\s+source="([^"]+)"(?:\s+fragment="([^"]+)")?\s*-->\s*$/;
const END_RE = /^<!--\s*conventions:end\s+id="([^"]+)"\s*-->\s*$/;
const ANY_START = /<!--\s*conventions:start\b/;
const ANY_END = /<!--\s*conventions:end\b/;

export function parseFile(text: string): ParsedFile {
  const lines = text.split("\n");
  const blocks: ParsedBlock[] = [];
  const seen = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (ANY_START.test(line)) {
      const startMatch = START_RE.exec(line);
      if (!startMatch) {
        throw new ConventionsError("block-malformed", `malformed start sentinel at line ${i + 1}`);
      }
      const id = startMatch[1] as string;
      const source = startMatch[2] as string;
      const fragment = startMatch[3];
      if (seen.has(id)) {
        throw new ConventionsError(
          "block-duplicate-id",
          `duplicate block id "${id}" at line ${i + 1}`,
        );
      }
      seen.add(id);

      const startLine = i;
      let j = i + 1;
      let bodyEnd = -1;
      while (j < lines.length) {
        const inner = lines[j] ?? "";
        if (ANY_START.test(inner)) {
          throw new ConventionsError(
            "block-nested",
            `nested start sentinel inside block "${id}" at line ${j + 1}`,
          );
        }
        if (ANY_END.test(inner)) {
          const endMatch = END_RE.exec(inner);
          if (!endMatch) {
            throw new ConventionsError(
              "block-malformed",
              `malformed end sentinel at line ${j + 1}`,
            );
          }
          if (endMatch[1] !== id) {
            throw new ConventionsError(
              "block-orphan-end",
              `end sentinel id "${endMatch[1]}" does not match open block "${id}" at line ${j + 1}`,
            );
          }
          bodyEnd = j;
          break;
        }
        j += 1;
      }
      if (bodyEnd === -1) {
        throw new ConventionsError(
          "block-unclosed",
          `block "${id}" opened at line ${startLine + 1} is never closed`,
        );
      }
      const bodyLines = lines.slice(startLine + 1, bodyEnd);
      blocks.push({
        id,
        source,
        fragment,
        startLine,
        endLine: bodyEnd,
        headerLine: line,
        footerLine: lines[bodyEnd] ?? "",
        body: bodyLines.join("\n"),
      });
      i = bodyEnd + 1;
      continue;
    }
    if (ANY_END.test(line)) {
      throw new ConventionsError(
        "block-orphan-end",
        `end sentinel without matching start at line ${i + 1}`,
      );
    }
    i += 1;
  }

  return { blocks, lines };
}
