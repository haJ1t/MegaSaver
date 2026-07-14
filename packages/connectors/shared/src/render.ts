import { MEGA_SAVER_BLOCK_END, MEGA_SAVER_BLOCK_START } from "./constants.js";
import { type ConnectorContext, assertConnectorContext } from "./context.js";

export function renderBlock(input: ConnectorContext): string {
  const context = assertConnectorContext(input);
  const sessionLabel = context.session?.title ?? context.session?.id ?? "none";
  const riskLevel = context.session?.riskLevel ?? "none";

  return [
    MEGA_SAVER_BLOCK_START,
    "# Mega Saver Context",
    "",
    `Agent: ${context.agentId}`,
    `Project: ${context.project.name} (${context.project.id})`,
    `Session: ${sessionLabel}`,
    `Risk: ${riskLevel}`,
    "",
    "## Memory",
    "",
    ...renderMemoryEntries(context),
    MEGA_SAVER_BLOCK_END,
    "",
  ].join("\n");
}

function renderMemoryEntries(context: ConnectorContext): string[] {
  if (context.memoryEntries.length === 0) {
    return ["- none"];
  }
  // contentSchema rejects newlines, so entry.content is always single-line here.
  return context.memoryEntries.map((entry) => {
    const base = `- [${entry.scope}:${entry.id}] ${entry.content}`;
    const changedFrom = context.memoryChangedFrom?.[entry.id];
    if (changedFrom === undefined) return base;
    const closedDate = changedFrom.closedAt.slice(0, 10);
    return `${base} (changed from "${changedFrom.title}", closed ${closedDate})`;
  });
}
