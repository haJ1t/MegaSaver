import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { connectorCommand } from "./commands/connector/index.js";
import { doctorCommand } from "./commands/doctor.js";
import { mcpCommand } from "./commands/mcp/index.js";
import { memoryCommand } from "./commands/memory/index.js";
import { outputCommand } from "./commands/output/index.js";
import { projectCommand } from "./commands/project.js";
import { sessionCommand } from "./commands/session/index.js";

// Version source. Unbundled (dist/cli.js), this reads the package.json next to
// the build via createRequire. The standalone single-file bundle has no sibling
// package.json, so tsup.bundle.config.ts injects MEGA_CLI_VERSION at build time
// and esbuild's dead-code elimination drops the createRequire branch entirely —
// keeping the displayed version identical without a runtime file read.
const version =
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_CLI_VERSION"] ??
  (createRequire(import.meta.url)("../package.json") as { version: string }).version;

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {
    doctor: doctorCommand,
    project: projectCommand,
    session: sessionCommand,
    connector: connectorCommand,
    memory: memoryCommand,
    output: outputCommand,
    mcp: mcpCommand,
  },
});
