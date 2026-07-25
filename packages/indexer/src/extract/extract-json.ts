import { basename } from "node:path";
import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

// The key token is captured verbatim, unescaped: a key whose source form is
// escaped (`"a\"b"`, `"é"`) never matched the per-key regex this replaces
// either, and falls back to line 1 the same way.
const KEY_LINE = /^\s*"([^"]*)"\s*:/;

// Top-level keys become config blocks. package.json additionally expands each
// script into a `script:<name>` block. An unparseable or non-object JSON file
// yields no blocks (intentional skip — one malformed file must not abort a
// whole-repo index build; the file simply isn't represented).
export function extractJson(filePath: string, source: string): ExtractedBlock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const obj = parsed as Record<string, unknown>;
  const lines = source.split("\n");

  // Line of the first token that appears AS A KEY (`"key":`), anchored at the
  // line start so a matching string in a VALUE or a nested object doesn't win.
  // One pass for all keys: per-key regex + full scan made a flat dictionary
  // (locale file, config map, data dump) cost O(keys x lines).
  const keyLines = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const token = KEY_LINE.exec(line)?.[1];
    if (token !== undefined && !keyLines.has(token)) keyLines.set(token, index + 1);
  }
  const lineOf = (key: string): number => keyLines.get(key) ?? 1;

  const blocks: ExtractedBlock[] = [];
  const add = (name: string, line: number, text: string): void => {
    blocks.push({
      filePath,
      startLine: line,
      endLine: line,
      blockType: "config",
      name,
      contentHash: hashText(text),
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      keywords: tokenize(name),
    });
  };

  for (const key of Object.keys(obj)) {
    add(key, lineOf(key), JSON.stringify(obj[key]));
  }

  if (basename(filePath) === "package.json") {
    const scripts = (obj as { scripts?: unknown }).scripts;
    if (scripts !== null && typeof scripts === "object" && !Array.isArray(scripts)) {
      for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
        add(`script:${name}`, lineOf(name), String(command));
      }
    }
  }

  return blocks;
}
