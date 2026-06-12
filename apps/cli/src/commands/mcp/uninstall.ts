import { knownAgentIdSchema, uninstallMcp } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";
import { resolveHomeDir } from "../../store.js";

export type RunMcpUninstallInput = {
  targetFlag: string;
  home: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpUninstall(input: RunMcpUninstallInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.targetFlag)) {
    const cli = unknownTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  // MCP uninstall is only available for agents with native MCP config support.
  const mcpAgentResult = knownAgentIdSchema.safeParse(input.targetFlag);
  if (!mcpAgentResult.success) {
    input.stderr(`error: MCP uninstall is not supported for agent "${input.targetFlag}"`);
    return 1;
  }
  const result = await uninstallMcp({ agentId: mcpAgentResult.data, home: input.home });
  if (input.json) {
    input.stdout(JSON.stringify({ target: input.targetFlag, changed: result.changed }));
  } else {
    input.stdout(
      result.changed
        ? `Removed Mega Saver MCP for ${input.targetFlag}`
        : `Mega Saver MCP not installed for ${input.targetFlag} (no-op)`,
    );
  }
  return 0;
}

export const mcpUninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: "Remove the Mega Saver MCP server from an agent config.",
  },
  args: {
    target: { type: "string", required: true, description: "Agent id." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpUninstall({
      targetFlag: typeof args.target === "string" ? args.target : "",
      home: resolveHomeDir(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
