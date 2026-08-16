export type McpHookEvidence = {
  servers: Map<string, Map<string, number>>;
};

export function parseMcpWireName(tool: string): { serverKey: string; toolName: string } | null {
  if (!tool.startsWith("mcp__")) return null;
  const rest = tool.slice(5);
  const sep = rest.indexOf("__");
  if (sep === -1) return null;
  const serverKey = rest.slice(0, sep);
  const toolName = rest.slice(sep + 2);
  if (serverKey.length === 0 || toolName.length === 0) return null;
  return { serverKey, toolName };
}

export function parseMcpHookLog(content: string): McpHookEvidence {
  const servers = new Map<string, Map<string, number>>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const tool = (parsed as Record<string, unknown>).tool;
    if (typeof tool !== "string") continue;
    const wire = parseMcpWireName(tool);
    if (wire === null) continue;
    if (wire.serverKey === "megasaver") continue;
    let tools = servers.get(wire.serverKey);
    if (tools === undefined) {
      tools = new Map<string, number>();
      servers.set(wire.serverKey, tools);
    }
    tools.set(wire.toolName, (tools.get(wire.toolName) ?? 0) + 1);
  }
  return { servers };
}
