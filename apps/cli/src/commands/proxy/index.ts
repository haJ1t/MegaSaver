import { defineCommand } from "citty";
import {
  proxyServiceCommand,
  proxyStartCommand,
  proxyStatusCommand,
  proxyStopCommand,
} from "./commands.js";
import { proxySuperviseCommand } from "./supervise.js";

export const proxyCommand = defineCommand({
  meta: {
    name: "proxy",
    description: "Persistent local Anthropic-API proxy for token metering (opt-in).",
  },
  subCommands: {
    start: proxyStartCommand,
    stop: proxyStopCommand,
    status: proxyStatusCommand,
    service: proxyServiceCommand,
    supervise: proxySuperviseCommand,
  },
});
