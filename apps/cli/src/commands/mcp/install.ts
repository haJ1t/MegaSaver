import {
  DEFAULT_MCP_ARGS,
  DEFAULT_MCP_COMMAND,
  installMcp,
  knownAgentIdSchema,
} from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";
import { resolveHomeDir } from "../../store.js";

// Default launch entry now lives in @megasaver/mcp-bridge so the CLI and the
// GUI bridge share one source of truth; re-exported here to keep existing
// import sites (repair.ts, tests) stable.
export { DEFAULT_MCP_COMMAND, DEFAULT_MCP_ARGS };

export type RunMcpInstallInput = {
  targetFlag: string;
  home: string;
  command?: string;
  args?: string[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpInstall(input: RunMcpInstallInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.targetFlag)) {
    const cli = unknownTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  // MCP install is only available for agents with native MCP config support
  // (the narrower knownAgentIdSchema set). Connector-only agents (gemini/windsurf/continue)
  // do not have an MCP config location — surface an actionable error.
  const mcpAgentResult = knownAgentIdSchema.safeParse(input.targetFlag);
  if (!mcpAgentResult.success) {
    input.stderr(`error: MCP install is not supported for agent "${input.targetFlag}"`);
    return 1;
  }
  const command = input.command ?? DEFAULT_MCP_COMMAND;
  const args = input.args ?? [...DEFAULT_MCP_ARGS];
  const result = await installMcp({
    agentId: mcpAgentResult.data,
    home: input.home,
    command,
    args,
  });
  if (input.json) {
    input.stdout(
      JSON.stringify({
        target: input.targetFlag,
        changed: result.changed,
        configPath: result.configPath,
      }),
    );
  } else {
    input.stdout(
      result.changed
        ? `Installed Mega Saver MCP for ${input.targetFlag} at ${result.configPath}`
        : `Mega Saver MCP already installed for ${input.targetFlag} (no-op)`,
    );
  }
  return 0;
}

export const mcpInstallCommand = defineCommand({
  meta: { name: "install", description: "Install the Mega Saver MCP server into an agent config." },
  args: {
    target: { type: "string", required: true, description: "Agent id." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpInstall({
      targetFlag: typeof args.target === "string" ? args.target : "",
      home: resolveHomeDir(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
