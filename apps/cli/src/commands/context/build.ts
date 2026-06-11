import type { ScoredBlock } from "@megasaver/context-pruner";
import { defineCommand } from "citty";
import { readStoreEnv } from "../../store.js";
import { type ContextRequest, loadPack, toStringArray } from "./shared.js";

function line(index: number, block: ScoredBlock): string[] {
  return [
    `${index}. ${block.filePath}:${block.startLine}-${block.endLine}  ${block.name ?? "-"}  [${block.blockType}]`,
    `   reasons: ${block.reasons.join(", ")}`,
    `   score: ${block.score.toFixed(2)}`,
  ];
}

export type RunContextBuildInput = ContextRequest & {
  jsonFlag: boolean;
  stdout: (line: string) => void;
};

export async function runContextBuild(input: RunContextBuildInput): Promise<0 | 1> {
  const loaded = await loadPack(input);
  if (!loaded) return 1;
  const { pack } = loaded;
  if (input.jsonFlag) {
    input.stdout(JSON.stringify(pack));
    return 0;
  }
  input.stdout(`Task: ${pack.task}`);
  input.stdout("");
  input.stdout("Included:");
  pack.included.forEach((block, i) => {
    for (const l of line(i + 1, block)) input.stdout(l);
  });
  input.stdout("");
  input.stdout("Excluded:");
  pack.excluded.forEach((block, i) => {
    for (const l of line(i + 1, block)) input.stdout(l);
  });
  return 0;
}

// Shared arg schema for all `mega context` subcommands.
export const contextArgs = {
  projectName: { type: "positional", required: true, description: "Project name." },
  task: { type: "string", required: true, description: "Task description to select context for." },
  "changed-file": { type: "string", description: "A changed file path (repeatable)." },
  "failing-test": { type: "string", description: "A failing test file path (repeatable)." },
  limit: { type: "string", description: "Max included blocks (default 8)." },
  "max-tokens": { type: "string", description: "Token budget for the pack." },
  store: { type: "string", description: "Override store directory." },
  json: { type: "boolean", default: false, description: "Emit JSON output." },
} as const;

// biome-ignore lint/suspicious/noExplicitAny: citty args bag
export function contextRequestFromArgs(args: any): Omit<ContextRequest, "stderr"> & {
  jsonFlag: boolean;
} {
  const limit = typeof args.limit === "string" ? Number.parseInt(args.limit, 10) : undefined;
  const maxTokens =
    typeof args["max-tokens"] === "string" ? Number.parseInt(args["max-tokens"], 10) : undefined;
  return {
    ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    projectName: typeof args.projectName === "string" ? args.projectName : "",
    task: typeof args.task === "string" ? args.task : "",
    changedFiles: toStringArray(args["changed-file"]),
    failingTests: toStringArray(args["failing-test"]),
    limitFlag: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
    maxTokensFlag: maxTokens !== undefined && Number.isFinite(maxTokens) ? maxTokens : undefined,
    jsonFlag: args.json === true,
  };
}

export const contextBuildCommand = defineCommand({
  meta: { name: "build", description: "Build a task-aware context pack from the index." },
  args: contextArgs,
  async run({ args }) {
    const code = await runContextBuild({
      ...contextRequestFromArgs(args),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
