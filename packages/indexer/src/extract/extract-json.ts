import { basename } from "node:path";
import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

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

  // Locate the line where `key` appears AS A KEY (`"key":`), anchored at the
  // line start so a matching string in a VALUE or a nested object doesn't win.
  const lineOf = (key: string): number => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const keyRe = new RegExp(`^\\s*"${escaped}"\\s*:`);
    const index = lines.findIndex((line) => keyRe.test(line));
    return index >= 0 ? index + 1 : 1;
  };

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
