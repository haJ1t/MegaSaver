import { join } from "node:path";
import type { KnownAgentId } from "./agent-ids.js";

export type DetectedAgent = {
  agentId: KnownAgentId;
  configPath: string;
  serverKey: "megasaver";
};

// Per-agent MCP config location under the user's home. stdio
// servers register a launch command (AA1 §20d: each agent spawns
// its own bridge). Paths follow each agent's documented config.
export function detectAgent(input: { agentId: KnownAgentId; home: string }): DetectedAgent {
  const { agentId, home } = input;
  const configPath = ((): string => {
    switch (agentId) {
      case "claude-code":
        return join(home, ".config", "claude", "mcp.json");
      case "cursor":
        return join(home, ".cursor", "mcp.json");
      case "codex":
        return join(home, ".codex", "mcp.json");
      case "aider":
        return join(home, ".aider", "mcp.json");
    }
  })();
  return { agentId, configPath, serverKey: "megasaver" };
}
