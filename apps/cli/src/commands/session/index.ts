import { defineCommand } from "citty";
import { sessionCreateCommand } from "./create.js";
import { sessionEndCommand } from "./end.js";
import { sessionListCommand } from "./list.js";
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
  },
});
