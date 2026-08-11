import { defineCommand } from "citty";

export const hotspotsCommand = defineCommand({
  meta: { name: "hotspots", description: "Token hotspot heatmap (derived, deterministic)." },
  args: {
    top: { type: "string", description: "Top N (default 20, max 100)." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    console.log(
      `hotspots top=${args.top ?? 20} (stub — score estTokens*(1+dropRate*0.5), see spec)`,
    );
    if (args.json) console.log(JSON.stringify([], null, 2));
  },
});
