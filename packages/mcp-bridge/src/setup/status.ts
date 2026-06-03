import { type KnownAgentId, knownAgentIdSchema } from "./agent-ids.js";
import { isMcpInstalled } from "./install.js";
import { restartHint } from "./restart-hint.js";

// F4: per-agent snapshot consumed by the CLI `mega mcp status` and the GUI
// AgentSetupDoctor (BB11) — exactly the five fields BB11's row pins. agentId
// is a KnownAgentId: MCP install targets the four agents with a config slot
// (generic-cli has none), so the whole status surface is KnownAgentId-typed.
export type McpAgentStatus = {
  agentId: KnownAgentId;
  mcpInstalled: boolean;
  connectorSynced: boolean;
  restartRequired: boolean;
  restartHint: string;
};

export type McpStatusResult = { agents: readonly McpAgentStatus[] };

// Injected so mcp-bridge does not import the CLI or connectors-shared
// (AA1 §3 dependency arrow; §2c DI). The CLI/GUI pass a resolver
// that reads the connector file and runs parseBlock.
export type ConnectorSyncedResolver = (agentId: KnownAgentId) => Promise<boolean>;

const ALL_AGENTS = knownAgentIdSchema.options;

export async function aggregateMcpStatus(input: {
  home: string;
  connectorSyncedResolver: ConnectorSyncedResolver;
}): Promise<McpStatusResult> {
  const agents: McpAgentStatus[] = [];
  for (const agentId of ALL_AGENTS) {
    const mcpInstalled = await isMcpInstalled({ agentId, home: input.home });
    const connectorSynced = await input.connectorSyncedResolver(agentId);
    agents.push({
      agentId,
      mcpInstalled,
      connectorSynced,
      // restartRequired mirrors mcpInstalled in v0.5: a present
      // config requires the agent to restart to pick it up
      // (AA1 §5c, §20c). BB11 derives row state from this.
      restartRequired: mcpInstalled,
      restartHint: restartHint(agentId),
    });
  }
  return { agents };
}
