import { defineCommand } from "citty";
import { connectorDoctorCommand } from "./doctor.js";
import { connectorListCommand } from "./list.js";
import { connectorStatusCommand } from "./status.js";
import { connectorSyncCommand } from "./sync.js";

export {
  type RunConnectorDoctorInput,
  runConnectorDoctor,
  connectorDoctorCommand,
} from "./doctor.js";
export {
  type RunConnectorListInput,
  runConnectorList,
  connectorListCommand,
} from "./list.js";
export {
  type RunConnectorStatusInput,
  runConnectorStatus,
  connectorStatusCommand,
} from "./status.js";
export {
  type RunConnectorSyncInput,
  runConnectorSync,
  connectorSyncCommand,
} from "./sync.js";

export const connectorCommand = defineCommand({
  meta: { name: "connector", description: "Manage Mega Saver connector targets." },
  subCommands: {
    sync: connectorSyncCommand,
    status: connectorStatusCommand,
    list: connectorListCommand,
    doctor: connectorDoctorCommand,
  },
});
