import { defineCommand } from "citty";
import { guardModeCommand } from "./mode.js";
import { guardMuteCommand, guardUnmuteCommand } from "./mute.js";
import { guardStatusCommand } from "./status.js";

export const guardCommand = defineCommand({
  meta: { name: "guard", description: "Mistake Firewall: status, mode, mutes, events, and check." },
  subCommands: {
    status: guardStatusCommand,
    mode: guardModeCommand,
    mute: guardMuteCommand,
    unmute: guardUnmuteCommand,
  },
});
