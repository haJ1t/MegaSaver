import { defineCommand } from "citty";
import { proxyStartCommand } from "./start.js";

export const proxyCommand = defineCommand({
  meta: { name: "proxy", description: "Local Anthropic-API proxy for token metering (opt-in)." },
  subCommands: {
    start: proxyStartCommand,
  },
});
