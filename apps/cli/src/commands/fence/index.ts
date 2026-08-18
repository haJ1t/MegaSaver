import { defineCommand } from "citty";
import { fenceAllowCommand } from "./allow.js";
import { fenceCheckCommand } from "./check.js";
import { fenceInitCommand } from "./init.js";
import { fenceStatusCommand } from "./status.js";

export const fenceCommand = defineCommand({
  meta: {
    name: "fence",
    description: "Manage generated-file fence rules and configuration",
  },
  subCommands: {
    init: fenceInitCommand,
    allow: fenceAllowCommand,
    status: fenceStatusCommand,
    check: fenceCheckCommand,
  },
});
