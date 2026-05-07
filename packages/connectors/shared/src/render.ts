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
  return context.memoryEntries.map((entry) => {
    const target = `${entry.scope}:${entry.id}`;
    const [firstLine = "", ...continuationLines] = entry.content.split("\n");
    const renderedContinuation = continuationLines.map((line) => `  ${line}`).join("\n");
    if (renderedContinuation.length === 0) {
      return `- [${target}] ${firstLine}`;
    }
    return `- [${target}] ${firstLine}\n${renderedContinuation}`;
  });
}
