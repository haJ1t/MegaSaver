import { readBlocks, readManifest, resolveIndexPaths } from "@megasaver/indexer";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv } from "../../store.js";
import { type StoreEnv, loadProjectContext } from "./shared.js";

export type RunIndexStatusInput = StoreEnv & {
  projectName: string;
  jsonFlag: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runIndexStatus(input: RunIndexStatusInput): Promise<0 | 1> {
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;
  try {
    const paths = resolveIndexPaths(ctx.rootDir, ctx.project.id);
    const blocks = readBlocks(paths);
    const indexedFiles = Object.keys(readManifest(paths).files).length;

    const byType: Record<string, number> = {};
    for (const block of blocks) {
      byType[block.blockType] = (byType[block.blockType] ?? 0) + 1;
    }

    if (input.jsonFlag) {
      input.stdout(JSON.stringify({ total: blocks.length, indexedFiles, byType }));
      return 0;
    }
    if (blocks.length === 0) {
      input.stdout("no index — run `mega index build`");
      return 0;
    }
    for (const type of Object.keys(byType).sort()) {
      input.stdout(`${type}: ${byType[type]}`);
    }
    input.stdout(`total: ${blocks.length} blocks across ${indexedFiles} files`);
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

export const indexStatusCommand = defineCommand({
  meta: { name: "status", description: "Show index totals by block type for a project." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runIndexStatus({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
