import { defineCommand } from "citty";

export const auditionCommand = defineCommand({
  meta: {
    name: "audition",
    description: "Sandboxed three-fixture audition (honest byte counters).",
  },
  args: {
    keep: { type: "boolean", default: false, description: "Keep sandbox dir." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    console.log(`audition keep=${args.keep} (stub — 3 fixtures via runOutputPipeline, see spec)`);
    if (args.json) console.log(JSON.stringify({ version: 1, fixtures: [] }, null, 2));
  },
});
