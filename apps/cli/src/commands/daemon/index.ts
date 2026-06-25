import { defineCommand } from "citty";
import { daemonServeCommand } from "./serve.js";

export const daemonCommand = defineCommand({
  meta: {
    name: "daemon",
    description: "Local Mega Saver context daemon (intent excerpts + memory).",
  },
  subCommands: {
    serve: daemonServeCommand,
  },
});
