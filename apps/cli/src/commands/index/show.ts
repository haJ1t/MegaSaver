import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type CodeBlock, readBlocks, resolveIndexPaths } from "@megasaver/indexer";
import { codeBlockIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv } from "../../store.js";
import { type StoreEnv, loadProjectContext } from "./shared.js";

export type RunIndexShowInput = StoreEnv & {
  projectName: string;
  blockId: string;
  jsonFlag: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function sourceSlice(rootPath: string, block: CodeBlock): string | null {
  try {
    const lines = readFileSync(join(rootPath, block.filePath), "utf8").split("\n");
    return lines.slice(block.startLine - 1, block.endLine).join("\n");
  } catch {
    return null;
  }
}

export async function runIndexShow(input: RunIndexShowInput): Promise<0 | 1> {
  let parsedId: string;
  try {
    parsedId = codeBlockIdSchema.parse(input.blockId);
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err, { kind: "blockId", value: input.blockId }).message);
    return 1;
  }

  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;
  try {
    const paths = resolveIndexPaths(ctx.rootDir, ctx.project.id);
    const block = readBlocks(paths).find((candidate) => candidate.id === parsedId);
    if (!block) {
      input.stderr(`error: block "${parsedId}" not found`);
      return 1;
    }
    const slice = sourceSlice(ctx.project.rootPath, block);
    if (input.jsonFlag) {
      input.stdout(JSON.stringify({ ...block, source: slice }));
      return 0;
    }
    input.stdout(`id        ${block.id}`);
    input.stdout(`type      ${block.blockType}`);
    input.stdout(`name      ${block.name ?? "-"}`);
    input.stdout(`file      ${block.filePath}:${block.startLine}-${block.endLine}`);
    input.stdout(`hash      ${block.contentHash}`);
    input.stdout(`imports   ${block.imports.join(", ") || "-"}`);
    input.stdout(`exports   ${block.exports.join(", ") || "-"}`);
    input.stdout(`calls     ${block.calls.join(", ") || "-"}`);
    input.stdout(`keywords  ${block.keywords.join(", ") || "-"}`);
    input.stdout("---");
    input.stdout(slice ?? "(source unavailable)");
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

export const indexShowCommand = defineCommand({
  meta: { name: "show", description: "Show a code block's metadata and source slice." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    blockId: { type: "positional", required: true, description: "Code block id (UUID)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runIndexShow({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      blockId: typeof args.blockId === "string" ? args.blockId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
