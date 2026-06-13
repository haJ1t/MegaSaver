import { auditPack } from "@megasaver/context-pruner";
import { defineCommand } from "citty";
import { contextArgs, contextRequestFromArgs } from "./build.js";
import { type ContextRequest, loadPack } from "./shared.js";

export type RunContextAuditInput = ContextRequest & {
  jsonFlag: boolean;
  stdout: (line: string) => void;
};

export async function runContextAudit(input: RunContextAuditInput): Promise<0 | 1> {
  const loaded = await loadPack(input);
  if (!loaded) return 1;
  const audit = auditPack(loaded.pack);
  if (input.jsonFlag) {
    input.stdout(JSON.stringify(audit));
    return 0;
  }
  input.stdout(`files:  ${audit.filesIncluded}/${audit.filesConsidered} included`);
  input.stdout(`blocks: ${audit.blocksIncluded}/${audit.blocksConsidered} included`);
  input.stdout(`tokens: ${audit.tokensBefore} → ${audit.tokensAfter}`);
  input.stdout(`saved:  ${audit.percentSaved}%`);
  return 0;
}

export const contextAuditCommand = defineCommand({
  meta: { name: "audit", description: "Report context-pack token savings for a task." },
  args: contextArgs,
  async run({ args }) {
    const code = await runContextAudit({
      ...contextRequestFromArgs(args),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
