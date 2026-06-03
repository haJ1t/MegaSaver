import type { KnownAgentId } from "./agent-ids.js";

// F6 (critic-locked): BB8 OWNS the per-agent restartHint; BB11
// surfaces it, never hard-codes it. claude-code + cursor strings
// are confident; codex + aider mechanics are unverified against
// current agent docs — see NOTE below; confirm at execution.
export function restartHint(agentId: KnownAgentId): string {
  switch (agentId) {
    case "claude-code":
      return "Restart Claude Code (quit and reopen) to load the Mega Saver MCP server.";
    case "cursor":
      return "Reload the Cursor window (Cmd/Ctrl+Shift+P → Reload Window) to pick up the MCP server.";
    case "codex":
      return "Restart Codex to load the Mega Saver MCP server.";
    case "aider":
      return "Restart Aider to load the Mega Saver MCP server.";
  }
}
