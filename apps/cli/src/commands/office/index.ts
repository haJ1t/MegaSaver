import { defineCommand } from "citty";
import { officeAgentCommand } from "./agent.js";
import { officeAssignCommand } from "./assign.js";
import { officePauseCommand, officeResumeCommand, officeStopCommand } from "./control.js";
import { officeLogsCommand } from "./logs.js";
import { officeRoleCommand } from "./role.js";
import { officeRunCommand } from "./run.js";
import { officeStatusCommand } from "./status.js";

export {
  type RunOfficeAgentListInput,
  type RunOfficeAgentCreateInput,
  type RunOfficeAgentRmInput,
  runOfficeAgentList,
  runOfficeAgentCreate,
  runOfficeAgentRm,
  officeAgentCommand,
} from "./agent.js";

export {
  type RunOfficeAssignInput,
  runOfficeAssign,
  officeAssignCommand,
} from "./assign.js";

export {
  type ControlAction,
  type RunOfficeControlInput,
  runOfficeControl,
  officePauseCommand,
  officeResumeCommand,
  officeStopCommand,
} from "./control.js";

export {
  type RunOfficeLogsInput,
  runOfficeLogs,
  officeLogsCommand,
} from "./logs.js";

export {
  type RoleStoreEnvInput,
  type RunOfficeRoleListInput,
  type RunOfficeRoleCreateInput,
  type RunOfficeRoleRmInput,
  runOfficeRoleList,
  runOfficeRoleCreate,
  runOfficeRoleRm,
  officeRoleCommand,
} from "./role.js";

export {
  type RunOfficeRunInput,
  runOfficeRun,
  officeRunCommand,
} from "./run.js";

export {
  type RunOfficeStatusInput,
  runOfficeStatus,
  officeStatusCommand,
} from "./status.js";

export const officeCommand = defineCommand({
  meta: { name: "office", description: "Agent Office — manage roles, agents, and tasks." },
  subCommands: {
    role: officeRoleCommand,
    agent: officeAgentCommand,
    assign: officeAssignCommand,
    run: officeRunCommand,
    status: officeStatusCommand,
    logs: officeLogsCommand,
    pause: officePauseCommand,
    resume: officeResumeCommand,
    stop: officeStopCommand,
  },
});
