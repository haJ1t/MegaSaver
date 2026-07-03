import { defineCommand } from "citty";
import { sessionSaverDefaultCommand } from "./default.js";
import { sessionSaverDisableCommand } from "./disable.js";
import { sessionSaverEnableCommand } from "./enable.js";
import { sessionSaverResolveCommand } from "./resolve.js";
import { sessionSaverStatsCommand } from "./stats.js";
import { sessionSaverStatusCommand } from "./status.js";
import { sessionSaverWorkspaceCommand } from "./workspace.js";

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
  type RunSessionSaverDefaultEnableInput,
  type RunSessionSaverDefaultDisableInput,
  runSessionSaverDefaultEnable,
  runSessionSaverDefaultDisable,
  sessionSaverDefaultCommand,
} from "./default.js";
export {
  type RunSessionSaverResolveInput,
  runSessionSaverResolve,
  sessionSaverResolveCommand,
} from "./resolve.js";
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
export {
  type RunSessionSaverWorkspaceDisableInput,
  type RunSessionSaverWorkspaceEnableInput,
  runSessionSaverWorkspaceDisable,
  runSessionSaverWorkspaceEnable,
  sessionSaverWorkspaceCommand,
} from "./workspace.js";

export const sessionSaverCommand = defineCommand({
  meta: { name: "saver", description: "Manage Mega Saver Mode on a session." },
  subCommands: {
    enable: sessionSaverEnableCommand,
    disable: sessionSaverDisableCommand,
    status: sessionSaverStatusCommand,
    stats: sessionSaverStatsCommand,
    workspace: sessionSaverWorkspaceCommand,
    default: sessionSaverDefaultCommand,
    resolve: sessionSaverResolveCommand,
  },
});
