import { defineCommand } from "citty";
import { contextArgs, contextRequestFromArgs } from "./build.js";
import { type ContextRequest, loadPack } from "./shared.js";

export type RunContextExplainInput = ContextRequest & {
  jsonFlag: boolean;
  stdout: (line: string) => void;
};

export async function runContextExplain(input: RunContextExplainInput): Promise<0 | 1> {
  const loaded = await loadPack(input);
  if (!loaded) return 1;
  const { pack } = loaded;
  if (input.jsonFlag) {
    input.stdout(
      JSON.stringify(pack.included.map((b) => ({ blockId: b.blockId, factors: b.factors }))),
    );
    return 0;
  }
  for (const block of pack.included) {
    input.stdout(
      `${block.filePath}:${block.startLine}  ${block.name ?? "-"}  (score ${block.score.toFixed(2)})`,
    );
    for (const [factor, value] of Object.entries(block.factors)) {
      if (value !== 0) input.stdout(`   ${factor}: ${value}`);
    }
  }
  return 0;
}

export const contextExplainCommand = defineCommand({
  meta: { name: "explain", description: "Explain the per-factor scoring of each included block." },
  args: contextArgs,
  async run({ args }) {
    const code = await runContextExplain({
      ...contextRequestFromArgs(args),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
