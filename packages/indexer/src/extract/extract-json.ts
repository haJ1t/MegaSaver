import { basename } from "node:path";
import type { ExtractedBlock } from "../code-block.js";
import { hashText, tokenize } from "./helpers.js";

// Top-level keys become config blocks. package.json additionally expands each
// script into a `script:<name>` block. Invalid JSON yields no blocks.
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

  const lineOf = (key: string): number => {
    const needle = `"${key}"`;
    const index = lines.findIndex((line) => line.includes(needle));
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
