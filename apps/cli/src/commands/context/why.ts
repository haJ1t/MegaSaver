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
    console.log(
      `context why: query="${args.query}" (stub — deterministic replay via inspectPack, see spec 2026-08-11-context-drop-inspector)`,
    );
    if (args.json)
      console.log(
        JSON.stringify(
          { version: 1, query: args.query, kept: [], dropped: [], counters: { totalBlocks: 0 } },
          null,
          2,
        ),
      );
  },
});
