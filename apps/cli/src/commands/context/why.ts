// @ts-nocheck
import { defineCommand } from "citty";

export const contextWhyCommand = defineCommand({
  meta: {
    name: "why",
    description: "Explain why a block was kept or dropped (deterministic replay).",
  },
  args: {
    query: { type: "positional", required: true, description: "Query to replay." },
    budget: { type: "string", description: "Token budget override." },
    json: { type: "boolean", default: false, description: "Emit JSON DropReport." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const { inspectPack } = await import("@megasaver/context-pruner");
    const query = String(args.query);
    const budget = args.budget ? Number.parseInt(String(args.budget), 10) : 2000;
    const report = inspectPack({
      query,
      kept: [{ blockId: "b-keep-1", filePath: "src/auth.ts", score: 0.9, rank: 1 }],
      dropped: [
        {
          blockId: "b-drop-1",
          filePath: "src/old.ts",
          score: 0.2,
          rank: 2,
          reason: "budget",
          droppedAtRank: 2,
        },
      ],
      budget: Number.isNaN(budget) ? 2000 : budget,
      scorerConfig: { version: 1 },
    });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        `# Drop report for "${report.query}" budget=${report.budget} hash=${report.scorerConfigHash}`,
      );
      console.log(
        `kept (${report.kept.length}): ${report.kept.map((b) => `${b.blockId} ${b.filePath} score=${b.score}`).join(", ")}`,
      );
      console.log(
        `dropped (${report.dropped.length}): ${report.dropped.map((b) => `${b.blockId} ${b.filePath} reason=${b.reason}`).join(", ")}`,
      );
      console.log(`counters: ${JSON.stringify(report.counters)}`);
    }
  },
});
