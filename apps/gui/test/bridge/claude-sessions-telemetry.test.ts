import { describe, expect, it } from "vitest";
import { aggregateTelemetry } from "../../bridge/claude-sessions/telemetry.js";
import type { NormalizedMessage } from "../../bridge/claude-sessions/types.js";

const ZERO = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

function asst(
  ts: string,
  model: string,
  usage: { in: number; out: number; cc: number; cr: number },
  opts?: { gitBranch?: string; tools?: number },
): NormalizedMessage {
  const blocks: NormalizedMessage["blocks"] = [{ kind: "text", text: "reply" }];
  for (let i = 0; i < (opts?.tools ?? 0); i++) {
    blocks.push({ kind: "tool_use", text: "Bash({})" });
  }
  return {
    role: "assistant",
    ts,
    blocks,
    meta: {
      model,
      usage: {
        inputTokens: usage.in,
        outputTokens: usage.out,
        cacheCreationInputTokens: usage.cc,
        cacheReadInputTokens: usage.cr,
      },
      ...(opts?.gitBranch ? { gitBranch: opts.gitBranch } : {}),
    },
  };
}

function user(ts: string): NormalizedMessage {
  return { role: "user", ts, blocks: [{ kind: "text", text: "hi" }] };
}

describe("aggregateTelemetry", () => {
  it("returns a zeroed aggregate for an empty transcript", () => {
    expect(aggregateTelemetry([])).toEqual({
      turnCount: 0,
      assistantTurns: 0,
      toolCallCount: 0,
      totals: ZERO,
      models: [],
      firstTs: "",
      lastTs: "",
      durationMs: 0,
      gitBranch: "",
    });
  });

  it("sums usage and merges turns for a single model", () => {
    const t = aggregateTelemetry([
      asst("2026-06-14T11:00:00.000Z", "claude-haiku-4-5", { in: 3, out: 2, cc: 100, cr: 50 }),
      asst("2026-06-14T11:00:01.000Z", "claude-haiku-4-5", { in: 1, out: 4, cc: 7, cr: 9 }),
    ]);
    expect(t.totals).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      cacheCreationInputTokens: 107,
      cacheReadInputTokens: 59,
    });
    expect(t.models).toEqual([
      {
        model: "claude-haiku-4-5",
        turns: 2,
        inputTokens: 4,
        outputTokens: 6,
        cacheCreationInputTokens: 107,
        cacheReadInputTokens: 59,
      },
    ]);
    expect(t.assistantTurns).toBe(2);
  });

  it("sorts model mix by turns descending", () => {
    const t = aggregateTelemetry([
      asst("2026-06-14T11:00:00.000Z", "haiku", { in: 1, out: 1, cc: 0, cr: 0 }),
      asst("2026-06-14T11:00:01.000Z", "sonnet", { in: 1, out: 1, cc: 0, cr: 0 }),
      asst("2026-06-14T11:00:02.000Z", "sonnet", { in: 1, out: 1, cc: 0, cr: 0 }),
    ]);
    expect(t.models.map((m) => m.model)).toEqual(["sonnet", "haiku"]);
    expect(t.models[0]?.turns).toBe(2);
    expect(t.models[1]?.turns).toBe(1);
  });

  it("counts tool_use blocks across turns", () => {
    const t = aggregateTelemetry([
      asst("2026-06-14T11:00:00.000Z", "haiku", { in: 1, out: 1, cc: 0, cr: 0 }, { tools: 2 }),
    ]);
    expect(t.toolCallCount).toBe(2);
  });

  it("counts user turns in turnCount but they contribute nothing to totals/models", () => {
    const t = aggregateTelemetry([
      user("2026-06-14T11:00:00.000Z"),
      asst("2026-06-14T11:00:01.000Z", "haiku", { in: 5, out: 6, cc: 0, cr: 0 }),
    ]);
    expect(t.turnCount).toBe(2);
    expect(t.assistantTurns).toBe(1);
    expect(t.totals.inputTokens).toBe(5);
    expect(t.models).toHaveLength(1);
  });

  it("derives durationMs from first/last ts and gitBranch from first non-empty", () => {
    const t = aggregateTelemetry([
      asst("2026-06-14T11:00:00.000Z", "haiku", { in: 1, out: 1, cc: 0, cr: 0 }),
      asst(
        "2026-06-14T11:00:01.000Z",
        "haiku",
        { in: 1, out: 1, cc: 0, cr: 0 },
        {
          gitBranch: "main",
        },
      ),
    ]);
    expect(t.firstTs).toBe("2026-06-14T11:00:00.000Z");
    expect(t.lastTs).toBe("2026-06-14T11:00:01.000Z");
    expect(t.durationMs).toBe(1000);
    expect(t.gitBranch).toBe("main");
  });
});
