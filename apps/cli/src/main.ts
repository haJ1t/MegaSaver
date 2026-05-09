import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { connectorCommand } from "./commands/connector.js";
import { doctorCommand } from "./commands/doctor.js";
import { memoryCommand } from "./commands/memory/index.js";
import { projectCommand } from "./commands/project.js";
import { sessionCommand } from "./commands/session/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version: pkg.version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {
    doctor: doctorCommand,
    project: projectCommand,
    session: sessionCommand,
    connector: connectorCommand,
    memory: memoryCommand,
  },
});
