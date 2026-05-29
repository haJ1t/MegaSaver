import { defineCommand } from "citty";
import { sessionCreateCommand } from "./create.js";
import { sessionEndCommand } from "./end.js";
import { sessionListCommand } from "./list.js";
import { sessionSaverCommand } from "./saver/index.js";
import { sessionShowCommand } from "./show.js";
import { sessionUpdateCommand } from "./update.js";

export {
  type RunSessionCreateInput,
  runSessionCreate,
  sessionCreateCommand,
} from "./create.js";
export {
  type RunSessionEndInput,
  runSessionEnd,
  sessionEndCommand,
} from "./end.js";
export {
  type RunSessionListInput,
  runSessionList,
  sessionListCommand,
} from "./list.js";
export {
  type RunSessionShowInput,
  runSessionShow,
  sessionShowCommand,
} from "./show.js";
export {
  type RunSessionSaverDisableInput,
  type RunSessionSaverEnableInput,
  type RunSessionSaverStatsInput,
  type RunSessionSaverStatusInput,
  runSessionSaverDisable,
  runSessionSaverEnable,
  runSessionSaverStats,
  runSessionSaverStatus,
  sessionSaverCommand,
} from "./saver/index.js";
export {
  type RunSessionUpdateInput,
  runSessionUpdate,
  sessionUpdateCommand,
} from "./update.js";

export const sessionCommand = defineCommand({
  meta: { name: "session", description: "Manage Mega Saver sessions." },
  subCommands: {
    create: sessionCreateCommand,
    list: sessionListCommand,
    show: sessionShowCommand,
    end: sessionEndCommand,
    update: sessionUpdateCommand,
    saver: sessionSaverCommand,
  },
});
