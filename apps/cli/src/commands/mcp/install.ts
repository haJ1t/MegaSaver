import { installMcp } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";

// Default launch entry: the real `mega` bin + the `mcp serve`
// subcommand, so the written config is actually runnable. (The old
// "mega-mcp" default named a binary that does not exist.) Overridable
// via the command/args fields.
export const DEFAULT_MCP_COMMAND = "mega";
export const DEFAULT_MCP_ARGS: readonly string[] = ["mcp", "serve"];

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
  const command = input.command ?? DEFAULT_MCP_COMMAND;
  const args = input.args ?? [...DEFAULT_MCP_ARGS];
  const result = await installMcp({ agentId: input.targetFlag, home: input.home, command, args });
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
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
