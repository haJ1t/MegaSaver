import { defineCommand } from "citty";
import { sessionSaverDisableCommand } from "./disable.js";
import { sessionSaverEnableCommand } from "./enable.js";
import { sessionSaverStatsCommand } from "./stats.js";
import { sessionSaverStatusCommand } from "./status.js";

export {
  type RunSessionSaverDisableInput,
  runSessionSaverDisable,
  sessionSaverDisableCommand,
} from "./disable.js";
export {
  type RunSessionSaverEnableInput,
  runSessionSaverEnable,
  sessionSaverEnableCommand,
} from "./enable.js";
export {
  type RunSessionSaverStatsInput,
  runSessionSaverStats,
  sessionSaverStatsCommand,
} from "./stats.js";
export {
  type RunSessionSaverStatusInput,
  runSessionSaverStatus,
  sessionSaverStatusCommand,
} from "./status.js";

export const sessionSaverCommand = defineCommand({
  meta: { name: "saver", description: "Manage Mega Saver Mode on a session." },
  subCommands: {
    enable: sessionSaverEnableCommand,
    disable: sessionSaverDisableCommand,
    status: sessionSaverStatusCommand,
    stats: sessionSaverStatsCommand,
  },
});
