import { defineCommand } from "citty";
import { computeHotspots } from "../../hotspots/compute.js";

export const hotspotsCommand = defineCommand({
  meta: { name: "hotspots", description: "Token hotspot heatmap (derived, deterministic)." },
  args: {
    top: { type: "string", description: "Top N (default 20, max 100)." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const top = Math.min(100, Math.max(1, Number.parseInt(String(args.top ?? 20), 10) || 20));
    const blocks = [
      { filePath: "src/auth.ts", bytes: 12000 },
      { filePath: "src/old.ts", bytes: 4000 },
    ];
    const hotspots = computeHotspots({ blocks }).slice(0, top);
    if (args.json) {
      console.log(JSON.stringify(hotspots, null, 2));
    } else {
      for (const h of hotspots) console.log(`${h.filePath} ${h.bytes}B ~${h.tokens} tok score=${h.score.toFixed(1)} keepRate=${h.keepRate.toFixed(2)}`);
    }
  },
});
