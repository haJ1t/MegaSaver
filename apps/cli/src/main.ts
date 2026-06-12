import { createRequire } from "node:module";
import { defineCommand } from "citty";
import { connectorCommand } from "./commands/connector/index.js";
import { failCommand } from "./commands/fail/index.js";
import { learnCommand } from "./commands/learn.js";
import { rulesCommand } from "./commands/rules/index.js";
import { contextCommand } from "./commands/context/index.js";
import { doctorCommand } from "./commands/doctor.js";
import { indexCommand } from "./commands/index/index.js";
import { mcpCommand } from "./commands/mcp/index.js";
import { memoryCommand } from "./commands/memory/index.js";
import { outputCommand } from "./commands/output/index.js";
import { packCommand } from "./commands/pack/index.js";
import { projectCommand } from "./commands/project.js";
import { scanCommand } from "./commands/scan.js";
import { sessionCommand } from "./commands/session/index.js";

// Version source. The standalone single-file bundle has no sibling package.json
// to require at runtime, so tsup.bundle.config.ts defines __MEGA_CLI_VERSION__ as
// a build-time string literal; esbuild inlines it and dead-code-eliminates the
// createRequire branch. The unbundled dist/cli.js has no such define, so the
// literal is `undefined` and the version is read from the sibling package.json.
// No environment variable is consulted in either build.
declare const __MEGA_CLI_VERSION__: string | undefined;
const version =
  typeof __MEGA_CLI_VERSION__ !== "undefined"
    ? __MEGA_CLI_VERSION__
    : (createRequire(import.meta.url)("../package.json") as { version: string }).version;

export const mainCommand = defineCommand({
  meta: {
    name: "mega",
    version,
    description: "Mega Saver - ContextOps platform CLI.",
  },
  subCommands: {
    doctor: doctorCommand,
    fail: failCommand,
    learn: learnCommand,
    project: projectCommand,
    rules: rulesCommand,
    session: sessionCommand,
    connector: connectorCommand,
    memory: memoryCommand,
    output: outputCommand,
    mcp: mcpCommand,
    pack: packCommand,
    scan: scanCommand,
    index: indexCommand,
    context: contextCommand,
  },
});
