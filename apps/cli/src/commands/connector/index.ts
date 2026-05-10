import { defineCommand } from "citty";
import { connectorStatusCommand } from "./status.js";
import { connectorSyncCommand } from "./sync.js";

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
  },
});
