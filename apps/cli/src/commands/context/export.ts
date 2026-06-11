import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScoredBlock } from "@megasaver/context-pruner";
import { defineCommand } from "citty";
import { contextArgs, contextRequestFromArgs } from "./build.js";
import { type ContextRequest, loadPack } from "./shared.js";

function sourceSlice(rootPath: string, block: ScoredBlock): string {
  try {
    const lines = readFileSync(join(rootPath, block.filePath), "utf8").split("\n");
    return lines.slice(block.startLine - 1, block.endLine).join("\n");
  } catch {
    return "(source unavailable)";
  }
}

function langOf(filePath: string): string {
  const ext = filePath.includes(".") ? (filePath.split(".").pop() ?? "") : "";
  return ext.toLowerCase();
}

export type RunContextExportInput = ContextRequest & {
  stdout: (line: string) => void;
};

export async function runContextExport(input: RunContextExportInput): Promise<0 | 1> {
  const loaded = await loadPack(input);
  if (!loaded) return 1;
  const { pack, rootPath } = loaded;
  const out: string[] = [`# Context pack: ${pack.task}`, ""];
  for (const block of pack.included) {
    out.push(`## ${block.filePath}:${block.startLine}-${block.endLine} — ${block.name ?? "block"}`);
    out.push(`> ${block.reasons.join(", ")}`);
    out.push("");
    out.push(`\`\`\`${langOf(block.filePath)}`);
    out.push(sourceSlice(rootPath, block));
    out.push("```");
    out.push("");
  }
  input.stdout(out.join("\n"));
  return 0;
}

export const contextExportCommand = defineCommand({
  meta: { name: "export", description: "Export the context pack as a markdown document." },
  args: {
    ...contextArgs,
    format: { type: "string", default: "markdown", description: "Output format (markdown)." },
  },
  async run({ args }) {
    const code = await runContextExport({
      ...contextRequestFromArgs(args),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
