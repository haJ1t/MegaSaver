import { aggregateMcpStatus } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { resolveHomeDir } from "../../store.js";
import { makeConnectorSyncedResolver } from "./connector-synced.js";

export type RunMcpStatusInput = {
  home: string;
  projectRoot: string | undefined; // when known, enables connectorSynced
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json: boolean;
};

export async function runMcpStatus(input: RunMcpStatusInput): Promise<0 | 1> {
  const connectorSyncedResolver =
    input.projectRoot === undefined
      ? async () => false
      : makeConnectorSyncedResolver(input.projectRoot);

  const result = await aggregateMcpStatus({
    home: input.home,
    connectorSyncedResolver,
  });

  if (input.json) {
    input.stdout(JSON.stringify(result.agents));
  } else {
    for (const a of result.agents) {
      input.stdout(
        `${a.agentId}: mcp=${a.mcpInstalled ? "installed" : "missing"} connectorSynced=${a.connectorSynced} restartRequired=${a.restartRequired}`,
      );
    }
  }
  return 0;
}

export const mcpStatusCommand = defineCommand({
  meta: { name: "status", description: "Report per-agent Mega Saver MCP install state." },
  args: {
    project: { type: "string", description: "Project name; enables the connectorSynced check." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    // projectRoot is left undefined here: `mega mcp status` reports
    // the install bit (which is project-agnostic). The GUI route
    // (Task 8b) supplies a resolved root so the doctor's
    // connectorSynced reflects the real block. `--project`/`--store`
    // are accepted for forward use by the resolver.
    const code = await runMcpStatus({
      home: resolveHomeDir(),
      projectRoot: undefined,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
