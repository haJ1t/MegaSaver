import { buildIndex } from "@megasaver/indexer";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../../errors.js";
import { readStoreEnv } from "../../store.js";
import { type StoreEnv, loadProjectContext } from "./shared.js";

export type RunIndexBuildInput = StoreEnv & {
  projectName: string;
  jsonFlag: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runIndexBuild(input: RunIndexBuildInput): Promise<0 | 1> {
  const ctx = await loadProjectContext(input.projectName, input, input.stderr);
  if (!ctx) return 1;
  try {
    const result = buildIndex({
      rootDir: ctx.project.rootPath,
      storeDir: ctx.rootDir,
      projectId: ctx.project.id,
    });
    if (input.jsonFlag) {
      input.stdout(JSON.stringify(result));
    } else {
      input.stdout(
        `added=${result.added} updated=${result.updated} removed=${result.removed} unchanged=${result.unchanged} blocks=${result.blockCount}`,
      );
    }
    return 0;
  } catch (err) {
    input.stderr(mapErrorToCliMessage(err).message);
    return 1;
  }
}

export const indexBuildCommand = defineCommand({
  meta: { name: "build", description: "Build/refresh the semantic index for a project." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runIndexBuild({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
