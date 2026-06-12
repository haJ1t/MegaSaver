import { knownAgentIdSchema, repairMcp } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { unknownTargetMessage } from "../../errors.js";
import { isKnownTargetId } from "../../known-targets.js";
import { readStoreEnv } from "../../store.js";
import { runConnectorSync } from "../connector/sync.js";
import { DEFAULT_MCP_ARGS, DEFAULT_MCP_COMMAND } from "./install.js";

export type RunMcpRepairInput = {
  targetFlag: string;
  projectName: string;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  command?: string;
  args?: string[];
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpRepair(input: RunMcpRepairInput): Promise<0 | 1> {
  if (!isKnownTargetId(input.targetFlag)) {
    const cli = unknownTargetMessage(input.targetFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  // MCP repair is only available for agents with native MCP config support.
  const mcpAgentResult = knownAgentIdSchema.safeParse(input.targetFlag);
  if (!mcpAgentResult.success) {
    input.stderr(`error: MCP repair is not supported for agent "${input.targetFlag}"`);
    return 1;
  }
  const command = input.command ?? DEFAULT_MCP_COMMAND;
  const args = input.args ?? [...DEFAULT_MCP_ARGS];
  const repaired = await repairMcp({
    agentId: mcpAgentResult.data,
    home: input.home,
    command,
    args,
  });

  // AA1 §5c: repair = install + connector sync for the same agent.
  const syncCode = await runConnectorSync({
    projectName: input.projectName,
    targetFlag: input.targetFlag,
    storeFlag: input.storeFlag,
    cwd: input.cwd,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
    platform: input.platform,
    localAppData: input.localAppData,
    stdout: input.stdout,
    stderr: input.stderr,
    json: input.json,
  });

  if (input.json) {
    input.stdout(
      JSON.stringify({
        target: input.targetFlag,
        changed: repaired.install.changed,
        connectorSync: syncCode === 0,
      }),
    );
  } else {
    input.stdout(
      `Repaired Mega Saver MCP for ${input.targetFlag} (connector sync exit ${syncCode})`,
    );
  }
  return syncCode === 0 ? 0 : 1;
}

export const mcpRepairCommand = defineCommand({
  meta: { name: "repair", description: "Install MCP config and re-sync the connector block." },
  args: {
    target: { type: "string", required: true, description: "Agent id." },
    project: { type: "string", required: true, description: "Project name (for connector sync)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMcpRepair({
      targetFlag: typeof args.target === "string" ? args.target : "",
      projectName: typeof args.project === "string" ? args.project : "",
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
