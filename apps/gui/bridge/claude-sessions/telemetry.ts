import type { MessageUsage, ModelUsage, NormalizedMessage, SessionTelemetry } from "./types.js";

function addUsage(a: MessageUsage, b: MessageUsage): MessageUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

const ZERO: MessageUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

export function aggregateTelemetry(messages: NormalizedMessage[]): SessionTelemetry {
  let totals = ZERO;
  let assistantTurns = 0;
  let toolCallCount = 0;
  let gitBranch = "";
  let firstTs = "";
  let lastTs = "";
  const byModel = new Map<string, ModelUsage>();

  for (const m of messages) {
    // ts ordering follows array (read) position, not a sort: transcript lines are
    // appended in order, matching the snapshot the renderer already shows.
    if (m.ts) {
      if (!firstTs) firstTs = m.ts;
      lastTs = m.ts;
    }
    for (const b of m.blocks) if (b.kind === "tool_use") toolCallCount++;
    const meta = m.meta;
    if (!meta) continue;
    if (gitBranch === "" && meta.gitBranch) gitBranch = meta.gitBranch;
    if (m.role === "assistant" && (meta.model || meta.usage)) assistantTurns++;
    const usage = meta.usage ?? ZERO;
    totals = addUsage(totals, usage);
    if (meta.model) {
      const row = byModel.get(meta.model) ?? { model: meta.model, turns: 0, ...ZERO };
      const merged = addUsage(row, usage);
      byModel.set(meta.model, { model: meta.model, turns: row.turns + 1, ...merged });
    }
  }

  const durationMs = firstTs && lastTs ? Math.max(0, Date.parse(lastTs) - Date.parse(firstTs)) : 0;
  const models = [...byModel.values()].sort((a, b) => b.turns - a.turns);
  return {
    turnCount: messages.length,
    assistantTurns,
    toolCallCount,
    totals,
    models,
    firstTs,
    lastTs,
    durationMs,
    gitBranch,
  };
}
